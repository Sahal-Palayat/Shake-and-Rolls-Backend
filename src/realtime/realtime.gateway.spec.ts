import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { Types } from 'mongoose';
import { io, Socket } from 'socket.io-client';
import { OrderStatus, PaymentStatus, Role } from '../common/enums';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { RealtimeGateway } from './realtime.gateway';
import { ClientEvent, ServerEvent } from './realtime.events';
import { RealtimeService } from './realtime.service';
import { TrackingTokensService } from '../tracking/tracking-tokens.service';
import { WsAuthService } from './ws-auth.service';

const SECRET = 'test-secret';
const OrderModel = mongoose.model('SpecOrder', OrderSchema);

describe('Realtime gateway (no DB)', () => {
  let app: INestApplication;
  let url: string;
  let jwt: JwtService;
  let realtime: RealtimeService;
  const sockets: Socket[] = [];
  const ids = { kitchen: new Types.ObjectId().toHexString(), rider: new Types.ObjectId().toHexString(), rider2: new Types.ObjectId().toHexString(), custA: new Types.ObjectId().toHexString(), custB: new Types.ObjectId().toHexString() };
  let stored: { _id: string; customerId: string; riderId?: string; status: string; fulfillment: string }[] = [];

  const tok = (sub: string, role: Role, expiresIn: number | string = '1h') => jwt.sign({ sub, role }, { expiresIn: expiresIn as never });
  const connect = (token?: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = io(url, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', (e) => reject(e));
    });
  const emitAck = <T>(s: Socket, ev: string, body: unknown) => new Promise<T>((r) => s.emit(ev, body, r));
  const collect = (s: Socket, ev: string) => {
    const got: any[] = [];
    s.on(ev, (p) => got.push(p));
    return got;
  };
  const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (arr: unknown[], n = 1) => { for (let i = 0; i < 40 && arr.length < n; i++) await tick(25); };

  const makeOrder = (customerId: string, riderId?: string, status = OrderStatus.Placed) => {
    const _id = new Types.ObjectId();
    stored.push({ _id: _id.toHexString(), customerId, riderId, status, fulfillment: 'delivery' });
    return new OrderModel({
      _id, orderNumber: 'SR-TEST22', customerId: new Types.ObjectId(customerId), status, paymentStatus: PaymentStatus.CodPending, paymentMethod: 'cod',
      lines: [{ menuItemId: new Types.ObjectId(), name: 'Wrap', isVeg: true, unitPricePaise: 14900, options: [], quantity: 1, lineTotalPaise: 14900 }],
      totalPaise: 14900, contactName: 'A', contactPhone: '+919876500000', deliveryAddress: { line1: 'x' },
      riderId: riderId ? new Types.ObjectId(riderId) : undefined, statusLog: [{ from: null, to: status, byUserId: new Types.ObjectId(ids.custA), byRole: Role.Customer, at: new Date() }],
      idempotencyKey: 'k', requestHash: 'h', createdAt: new Date(), updatedAt: new Date(),
    }) as any;
  };

  beforeAll(async () => {
    const fakeModel = {
      exists: async (f: any) =>
        stored.find(
          (o) =>
            o._id === String(f._id) &&
            (!f.customerId || String(f.customerId) === o.customerId) &&
            (!f.riderId || String(f.riderId) === o.riderId) &&
            (!f.status || f.status.$in.includes(o.status)) &&
            (!f.fulfillment || f.fulfillment === o.fulfillment),
        )
          ? { _id: f._id }
          : null,
    };
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), JwtModule.register({ secret: SECRET })],
      providers: [RealtimeGateway, RealtimeService, WsAuthService, { provide: TrackingTokensService, useValue: { authorizeTracking: async () => ({ ok: false, code: 'invalid' }) } }, { provide: getModelToken(Order.name), useValue: fakeModel }],
    }).compile();
    app = mod.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    jwt = mod.get(JwtService);
    realtime = mod.get(RealtimeService);
  });
  afterEach(() => { sockets.splice(0).forEach((s) => s.close()); stored = []; });
  afterAll(() => app.close());

  it('rejects missing, garbage, wrong-secret and bad-role tokens', async () => {
    await expect(connect()).rejects.toMatchObject({ message: 'unauthorized' });
    await expect(connect('garbage')).rejects.toMatchObject({ message: 'unauthorized' });
    const forged = new JwtService({ secret: 'other' }).sign({ sub: ids.kitchen, role: Role.Kitchen });
    await expect(connect(forged)).rejects.toMatchObject({ message: 'unauthorized' });
    await expect(connect(jwt.sign({ sub: ids.kitchen, role: 'god' }))).rejects.toMatchObject({ message: 'unauthorized' });
    await expect(connect(jwt.sign({ sub: 'nope', role: Role.Kitchen }))).rejects.toMatchObject({ message: 'unauthorized' });
  });

  it('kitchen socket receives order:created; customer and rider sockets do not', async () => {
    const kitchen = await connect(tok(ids.kitchen, Role.Kitchen));
    const admin = await connect(tok(ids.kitchen, Role.Admin));
    const cust = await connect(tok(ids.custA, Role.Customer));
    const rider = await connect(tok(ids.rider, Role.Rider));
    const [k, a, c, r] = [kitchen, admin, cust, rider].map((s) => collect(s, ServerEvent.OrderCreated));
    const order = makeOrder(ids.custA);
    realtime.publishOrderCreated(order);
    await waitFor(k); await tick();
    expect(k).toHaveLength(1);
    expect(a).toHaveLength(1);
    expect(k[0].order).toMatchObject({ id: order.id, status: 'placed', orderNumber: 'SR-TEST22' });
    expect(k[0].order.statusLog[0].byUserId).toBeDefined(); // staff view
    expect(c).toHaveLength(0);
    expect(r).toHaveLength(0);
  });

  it('order:join enforces ownership; customer gets the customer view, no duplicate for staff', async () => {
    const order = makeOrder(ids.custA);
    const a = await connect(tok(ids.custA, Role.Customer));
    const b = await connect(tok(ids.custB, Role.Customer));
    const kitchen = await connect(tok(ids.kitchen, Role.Kitchen));
    expect(await emitAck(a, ClientEvent.JoinOrder, { orderId: order.id })).toEqual({ ok: true });
    expect(await emitAck(b, ClientEvent.JoinOrder, { orderId: order.id })).toEqual({ ok: false, error: 'not_found' });
    expect(await emitAck(a, ClientEvent.JoinOrder, { orderId: 'zzz' })).toEqual({ ok: false, error: 'invalid_order_id' });
    expect(await emitAck(a, ClientEvent.JoinOrder, null)).toEqual({ ok: false, error: 'invalid_order_id' });
    expect(await emitAck(kitchen, ClientEvent.JoinOrder, { orderId: order.id })).toEqual({ ok: true }); // staff may follow any order

    const [ea, eb, ek] = [a, b, kitchen].map((s) => collect(s, ServerEvent.OrderStatusChanged));
    order.status = OrderStatus.Accepted;
    realtime.publishOrderStatusChanged(order, OrderStatus.Placed);
    await waitFor(ea); await tick();
    expect(ea).toHaveLength(1);
    expect(ea[0]).toMatchObject({ orderId: order.id, from: 'placed', to: 'accepted' });
    expect(ea[0].order.statusLog[0].byUserId).toBeUndefined(); // customers never see actor ids
    expect(eb).toHaveLength(0);
    expect(ek).toHaveLength(1); // kitchen room + order room => exactly one, staff view
    expect(ek[0].order.statusLog[0].byUserId).toBeDefined();
  });

  it('assigned order reaches only its rider', async () => {
    const order = makeOrder(ids.custA, ids.rider, OrderStatus.Assigned);
    const r1 = await connect(tok(ids.rider, Role.Rider));
    const r2 = await connect(tok(ids.rider2, Role.Rider));
    const [e1, e2] = [r1, r2].map((s) => collect(s, ServerEvent.OrderStatusChanged));
    realtime.publishOrderStatusChanged(order, OrderStatus.Ready);
    await waitFor(e1); await tick();
    expect(e1).toHaveLength(1);
    expect(e2).toHaveLength(0);
    // rider cannot follow an order that is not theirs
    const other = makeOrder(ids.custA, ids.rider2, OrderStatus.Assigned);
    expect(await emitAck(r1, ClientEvent.JoinOrder, { orderId: other.id })).toEqual({ ok: false, error: 'not_found' });
  });

  it('order:leave stops delivery', async () => {
    const order = makeOrder(ids.custA);
    const a = await connect(tok(ids.custA, Role.Customer));
    await emitAck(a, ClientEvent.JoinOrder, { orderId: order.id });
    await emitAck(a, ClientEvent.LeaveOrder, { orderId: order.id });
    const ea = collect(a, ServerEvent.OrderStatusChanged);
    realtime.publishOrderStatusChanged(order, OrderStatus.Placed);
    await tick();
    expect(ea).toHaveLength(0);
  });

  it('disconnects the socket when its JWT expires', async () => {
    const s = await connect(tok(ids.custA, Role.Customer, 1));
    const expired = new Promise<void>((r) => s.on(ServerEvent.AuthExpired, () => r()));
    const closed = new Promise<void>((r) => s.on('disconnect', () => r()));
    await Promise.all([expired, closed]);
  }, 5000);

  describe('live rider location', () => {
    const fix = (orderId: string, over: Record<string, unknown> = {}) => ({ orderId, latitude: 11.8745, longitude: 75.3704, heading: 90, accuracy: 12, timestamp: Date.now(), ...over });
    const setStatus = (id: string, status: OrderStatus) => { const o = stored.find((x) => x._id === id)!; o.status = status; };

    it('rider -> customer: validated position reaches only the owning customer, with the full event', async () => {
      const order = makeOrder(ids.custA, ids.rider, OrderStatus.OutForDelivery);
      const rider = await connect(tok(ids.rider, Role.Rider));
      const custA = await connect(tok(ids.custA, Role.Customer));
      const custB = await connect(tok(ids.custB, Role.Customer));
      expect(await emitAck(custA, ClientEvent.JoinOrder, { orderId: order.id })).toEqual({ ok: true });
      expect(await emitAck(custB, ClientEvent.JoinOrder, { orderId: order.id })).toEqual({ ok: false, error: 'not_found' });
      const [a, b, r] = [custA, custB, rider].map((s) => collect(s, ServerEvent.RiderLocation));

      const sent = fix(order.id);
      expect(await emitAck(rider, ClientEvent.RiderLocation, sent)).toEqual({ ok: true });
      await waitFor(a); await tick();
      expect(a).toHaveLength(1);
      expect(a[0]).toEqual({ orderId: order.id, latitude: 11.8745, longitude: 75.3704, heading: 90, accuracy: 12, timestamp: sent.timestamp });
      expect(b).toHaveLength(0);
      expect(r).toHaveLength(0); // the rider is not echoed their own position
    });

    it('only a rider socket may send; customers and kitchen get forbidden', async () => {
      const order = makeOrder(ids.custA, ids.rider, OrderStatus.OutForDelivery);
      for (const [id, role] of [[ids.custA, Role.Customer], [ids.kitchen, Role.Kitchen], [ids.kitchen, Role.Admin]] as const) {
        const s = await connect(tok(id, role));
        expect(await emitAck(s, ClientEvent.RiderLocation, fix(order.id))).toEqual({ ok: false, error: 'forbidden' });
      }
    });

    it("rejects another rider's order and any order that is not in a trackable status", async () => {
      const mine = makeOrder(ids.custA, ids.rider, OrderStatus.OutForDelivery);
      const rider2 = await connect(tok(ids.rider2, Role.Rider));
      expect(await emitAck(rider2, ClientEvent.RiderLocation, fix(mine.id))).toEqual({ ok: false, error: 'not_active' });
      expect(await emitAck(rider2, ClientEvent.RiderLocation, fix(new Types.ObjectId().toHexString()))).toEqual({ ok: false, error: 'not_active' });

      const rider = await connect(tok(ids.rider, Role.Rider));
      for (const st of [OrderStatus.Assigned, OrderStatus.Delivered, OrderStatus.Cancelled, OrderStatus.Ready]) {
        setStatus(mine.id, st);
        expect(await emitAck(rider, ClientEvent.RiderLocation, fix(mine.id))).toEqual({ ok: false, error: 'not_active' });
      }
      for (const st of [OrderStatus.RiderAccepted, OrderStatus.PickedUp, OrderStatus.OutForDelivery]) {
        setStatus(mine.id, st);
        const fresh = await connect(tok(ids.rider, Role.Rider));
        expect(await emitAck(fresh, ClientEvent.RiderLocation, fix(mine.id))).toEqual({ ok: true });
      }
    });

    it('drops malformed payloads', async () => {
      const order = makeOrder(ids.custA, ids.rider, OrderStatus.OutForDelivery);
      const rider = await connect(tok(ids.rider, Role.Rider));
      const bad = [null, 'x', {}, fix(order.id, { latitude: 91 }), fix(order.id, { longitude: 'a' }), fix(order.id, { accuracy: -1 }), fix(order.id, { timestamp: Date.now() + 10 * 60_000 }), fix('nope')];
      for (const b of bad) expect(await emitAck(rider, ClientEvent.RiderLocation, b)).toEqual({ ok: false, error: 'invalid_payload' });
    });

    it('throttles a flooding client per order, then lets the next update through', async () => {
      const order = makeOrder(ids.custA, ids.rider, OrderStatus.OutForDelivery);
      const cust = await connect(tok(ids.custA, Role.Customer));
      await emitAck(cust, ClientEvent.JoinOrder, { orderId: order.id });
      const got = collect(cust, ServerEvent.RiderLocation);
      const rider = await connect(tok(ids.rider, Role.Rider));
      expect(await emitAck(rider, ClientEvent.RiderLocation, fix(order.id))).toEqual({ ok: true });
      expect(await emitAck(rider, ClientEvent.RiderLocation, fix(order.id))).toEqual({ ok: false, error: 'rate_limited' });
      await tick(2100);
      expect(await emitAck(rider, ClientEvent.RiderLocation, fix(order.id))).toEqual({ ok: true });
      await waitFor(got, 2);
      expect(got).toHaveLength(2);
    }, 8000);

    it('a customer who joins late immediately gets the last known position; none after the order closes', async () => {
      const order = makeOrder(ids.custA, ids.rider, OrderStatus.OutForDelivery);
      const rider = await connect(tok(ids.rider, Role.Rider));
      await emitAck(rider, ClientEvent.RiderLocation, fix(order.id, { latitude: 11.9 }));

      const late = await connect(tok(ids.custA, Role.Customer));
      const got = collect(late, ServerEvent.RiderLocation);
      await emitAck(late, ClientEvent.JoinOrder, { orderId: order.id });
      await waitFor(got); await tick();
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ orderId: order.id, latitude: 11.9 });

      order.status = OrderStatus.Delivered;
      realtime.publishOrderStatusChanged(order, OrderStatus.OutForDelivery);
      const later = await connect(tok(ids.custA, Role.Customer));
      const none = collect(later, ServerEvent.RiderLocation);
      await emitAck(later, ClientEvent.JoinOrder, { orderId: order.id });
      await tick();
      expect(none).toHaveLength(0);
    });

    it('never moves the rider backwards in time (out-of-order packet)', () => {
      const svc = new RealtimeService();
      const id = new Types.ObjectId().toHexString();
      const ev = (timestamp: number, latitude: number) => ({ orderId: id, latitude, longitude: 75, heading: null, accuracy: 5, timestamp });
      svc.publishRiderLocation(ev(2000, 11.2));
      svc.publishRiderLocation(ev(1000, 11.1));
      expect(svc.getLastLocation(id)?.latitude).toBe(11.2);
    });
  });

  it('publish is a safe no-op / never throws', () => {
    expect(() => new RealtimeService().publishOrderCreated(makeOrder(ids.custA))).not.toThrow();
    expect(() => new RealtimeService().publishOrderStatusChanged({} as never, OrderStatus.Placed)).not.toThrow();
  });
});
