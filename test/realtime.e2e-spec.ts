import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection } from 'mongoose';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SmsService } from '../src/auth/sms.service';

type M = 'get' | 'post' | 'patch';

describe('Realtime (e2e)', () => {
  let app: INestApplication;
  let url: string;
  const sentOtps: Record<string, string> = {};
  const sockets: Socket[] = [];
  let adminToken: string, kitchenToken: string, riderToken: string, rider2Token: string, custA: string, custB: string;
  let riderId: string, wrapId: string;
  let keyN = 0;
  const newKey = () => `rt-key-${Date.now()}-${keyN++}`;

  const api = () => request(app.getHttpServer());
  const as = (t: string, m: M, p: string) => api()[m](`/api${p}`).set('Authorization', `Bearer ${t}`);
  const subOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub as string;
  const customerLogin = async (phone: string) => {
    await api().post('/api/auth/customer/otp/request').send({ phone }).expect(200);
    return (await api().post('/api/auth/customer/otp/verify').send({ phone, code: sentOtps[`+91${phone}`] }).expect(200)).body.accessToken as string;
  };
  const staffLogin = async (username: string, secret: string) =>
    (await api().post('/api/auth/staff/login').send({ username, secret })).body.accessToken as string;

  const orderBody = () => ({
    lines: [{ menuItemId: wrapId, quantity: 1 }],
    paymentMethod: 'cod',
    contactName: 'Asha',
    contactPhone: '9876500000',
    deliveryAddress: { line1: 'House 4, Temple Rd', area: 'Kannur', pincode: '670001' },
  });
  const place = (token: string, key = newKey()) => as(token, 'post', '/orders').set('Idempotency-Key', key).send(orderBody());
  const move = (token: string, id: string, status: string, extra: object = {}) => as(token, 'patch', `/orders/${id}/status`).send({ status, ...extra });

  const connect = (token?: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = io(url, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  const collect = (s: Socket, ev: string) => {
    const got: any[] = [];
    s.on(ev, (p) => got.push(p));
    return got;
  };
  const waitFor = async (arr: unknown[], n = 1, ms = 2000) => {
    const end = Date.now() + ms;
    while (arr.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  };
  const settle = () => new Promise((r) => setTimeout(r, 200));
  const join = (s: Socket, orderId: string) => new Promise<{ ok: boolean; error?: string }>((r) => s.emit('order:join', { orderId }, r));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsService)
      .useValue({ sendOtp: (phone: string, code: string) => void (sentOtps[phone] = code) })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    adminToken = await staffLogin('boss', 'correct-horse-battery');
    const mk = (name: string, username: string, role: string, secret: string) =>
      as(adminToken, 'post', '/admin/staff').send({ name, username, role, secretType: 'pin', secret }).expect(201);
    await mk('Kit', 'rtkitchen', 'kitchen', '4821');
    await mk('Rid', 'rtrider1', 'rider', '5931');
    await mk('Rid2', 'rtrider2', 'rider', '6042');
    kitchenToken = await staffLogin('rtkitchen', '4821');
    riderToken = await staffLogin('rtrider1', '5931');
    rider2Token = await staffLogin('rtrider2', '6042');
    riderId = subOf(riderToken);
    custA = await customerLogin('9876500011');
    custB = await customerLogin('9876500012');

    const cat = (await as(adminToken, 'post', '/menu/categories').send({ name: 'RT cat' }).expect(201)).body.id;
    wrapId = (await as(adminToken, 'post', '/menu/items').send({ categoryId: cat, name: 'Paneer Wrap', pricePaise: 14900, isVeg: true }).expect(201)).body.id;
  });

  afterEach(() => sockets.splice(0).forEach((s) => s.close()));
  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  it('rejects sockets without a valid token', async () => {
    await expect(connect()).rejects.toMatchObject({ message: 'unauthorized' });
    await expect(connect('nope')).rejects.toMatchObject({ message: 'unauthorized' });
  });

  it('kitchen socket receives order:created when a customer places an order; replay emits nothing', async () => {
    const kitchen = await connect(kitchenToken);
    const cust = await connect(custA);
    const created = collect(kitchen, 'order:created');
    const custCreated = collect(cust, 'order:created');
    const key = newKey();

    const res = await place(custA, key).expect(201);
    await waitFor(created);
    expect(created).toHaveLength(1);
    expect(created[0].order).toMatchObject({ id: res.body.id, status: 'placed', paymentStatus: 'cod_pending', orderNumber: res.body.orderNumber });

    await place(custA, key).expect(200); // idempotent replay
    await settle();
    expect(created).toHaveLength(1);
    expect(custCreated).toHaveLength(0);
  });

  it('emits on every status change to kitchen, the owning customer and the assigned rider only', async () => {
    const kitchen = await connect(kitchenToken);
    const owner = await connect(custA);
    const stranger = await connect(custB);
    const rider = await connect(riderToken);
    const otherRider = await connect(rider2Token);

    const o = (await place(custA).expect(201)).body as { id: string };
    expect(await join(owner, o.id)).toEqual({ ok: true });
    expect(await join(stranger, o.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await join(otherRider, o.id)).toEqual({ ok: false, error: 'not_found' });

    const ev = 'order:status_changed';
    const [k, own, str, rd, rd2] = [kitchen, owner, stranger, rider, otherRider].map((s) => collect(s, ev));

    await move(kitchenToken, o.id, 'accepted').expect(200);
    await move(kitchenToken, o.id, 'preparing').expect(200);
    await move(kitchenToken, o.id, 'ready').expect(200);
    await move(kitchenToken, o.id, 'assigned', { riderId }).expect(200);
    await move(riderToken, o.id, 'picked_up').expect(200);
    await move(riderToken, o.id, 'delivered').expect(200);
    await waitFor(k, 6);
    await settle();

    const path = ['placed>accepted', 'accepted>preparing', 'preparing>ready', 'ready>assigned', 'assigned>picked_up', 'picked_up>delivered'];
    expect(k.map((e) => `${e.from}>${e.to}`)).toEqual(path);
    expect(own.map((e) => `${e.from}>${e.to}`)).toEqual(path);
    expect(own[0].order.statusLog[0].byUserId).toBeUndefined(); // customer view
    expect(k[0].order.statusLog[0].byUserId).toBeDefined(); // staff view
    expect(rd.map((e) => e.to)).toEqual(['assigned', 'picked_up', 'delivered']); // rider room only after assignment
    expect(rd2).toHaveLength(0);
    expect(str).toHaveLength(0);
    expect(k[5].order.paymentStatus).toBe('cod_collected');
  });

  it('a failed (illegal) transition emits nothing', async () => {
    const kitchen = await connect(kitchenToken);
    const o = (await place(custA).expect(201)).body as { id: string };
    await waitFor(collect(kitchen, 'order:created')); // drain
    const ev = collect(kitchen, 'order:status_changed');
    await move(kitchenToken, o.id, 'ready').expect(409);
    await settle();
    expect(ev).toHaveLength(0);
  });
});
