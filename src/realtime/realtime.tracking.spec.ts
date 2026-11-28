import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { Types } from 'mongoose';
import { io, Socket } from 'socket.io-client';
import { OrderStatus, PaymentStatus, Role } from '../common/enums';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { TrackingTokensService } from '../tracking/tracking-tokens.service';
import { ClientEvent, ServerEvent } from './realtime.events';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { WsAuthService } from './ws-auth.service';

const OrderModel = mongoose.model('SpecTrackingOrder', OrderSchema);
const oid = () => new Types.ObjectId().toHexString();

describe('Realtime gateway: anonymous tracking sessions (no DB)', () => {
  let app: INestApplication;
  let url: string;
  let jwt: JwtService;
  let realtime: RealtimeService;
  const sockets: Socket[] = [];

  const orderA = oid();
  const orderB = oid();
  /** token -> what the (fake) TrackingTokensService answers for it */
  const links = new Map<string, { orderId: string; expiresAt: Date; fail?: 'expired' | 'revoked' | 'cancelled' }>();
  const fakeTracking = {
    authorizeTracking: async (token: string) => {
      const l = links.get(token);
      if (!l) return { ok: false, code: 'invalid' };
      if (l.fail) return { ok: false, code: l.fail };
      return { ok: true, link: { expiresAt: l.expiresAt }, order: { id: l.orderId } };
    },
  };

  const track = (token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = io(url, { auth: { trackingToken: token }, transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', (e) => reject(e));
    });
  const asUser = (sub: string, role: Role): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const s = io(url, { auth: { token: jwt.sign({ sub, role }) }, transports: ['websocket'], forceNew: true, reconnection: false });
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
  const waitFor = async (arr: unknown[], n = 1) => { for (let i = 0; i < 60 && arr.length < n; i++) await tick(25); };
  const hour = () => new Date(Date.now() + 3_600_000);

  const fix = (orderId: string, lat = 11.87) => ({ orderId, latitude: lat, longitude: 75.37, heading: 90, accuracy: 5, timestamp: Date.now() });
  const orderDoc = (id: string, status: OrderStatus) =>
    new OrderModel({
      _id: new Types.ObjectId(id), orderNumber: 'SR-TEST22', customerId: new Types.ObjectId(), status, paymentStatus: PaymentStatus.CodPending, paymentMethod: 'cod',
      lines: [{ menuItemId: new Types.ObjectId(), name: 'Wrap', isVeg: true, unitPricePaise: 14900, options: [], quantity: 1, lineTotalPaise: 14900 }],
      totalPaise: 14900, contactName: 'Asha Menon', contactPhone: '+919876500000', deliveryAddress: { line1: '12 Rose Villa', location: { type: 'Point', coordinates: [75.37, 11.87] } },
      riderId: new Types.ObjectId(), statusLog: [{ from: null, to: status, byUserId: new Types.ObjectId(), byRole: Role.Customer, at: new Date() }],
      idempotencyKey: 'k', requestHash: 'h', createdAt: new Date(), updatedAt: new Date(),
    }) as any;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), JwtModule.register({ secret: 'test-secret' })],
      providers: [RealtimeGateway, RealtimeService, WsAuthService, { provide: TrackingTokensService, useValue: fakeTracking }, { provide: getModelToken(Order.name), useValue: { exists: async () => ({ _id: 1 }) } }],
    }).compile();
    app = mod.createNestApplication();
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    jwt = mod.get(JwtService);
    realtime = mod.get(RealtimeService);
  });
  beforeEach(() => {
    links.clear();
    links.set('tok-A', { orderId: orderA, expiresAt: hour() });
    links.set('tok-B', { orderId: orderB, expiresAt: hour() });
  });
  afterEach(() => sockets.splice(0).forEach((s) => s.close()));
  afterAll(() => app.close());

  it('accepts a valid link; refuses unknown, expired, revoked and cancelled ones', async () => {
    await expect(track('tok-A')).resolves.toBeTruthy();
    await expect(track('nope')).rejects.toMatchObject({ message: 'unauthorized' });
    links.set('old', { orderId: orderA, expiresAt: new Date(Date.now() - 1000), fail: 'expired' });
    links.set('off', { orderId: orderA, expiresAt: hour(), fail: 'revoked' });
    links.set('void', { orderId: orderA, expiresAt: hour(), fail: 'cancelled' });
    for (const t of ['old', 'off', 'void']) await expect(track(t)).rejects.toMatchObject({ message: 'unauthorized' });
  });

  it('a tracking token is not a JWT and a JWT is not a tracking token', async () => {
    const s = io(url, { auth: { trackingToken: jwt.sign({ sub: oid(), role: Role.Admin }) }, transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(s);
    await expect(new Promise((_, rej) => s.on('connect_error', rej))).rejects.toMatchObject({ message: 'unauthorized' });
  });

  it('only gets its OWN order\'s live location, and the payload has no order id', async () => {
    const a = await track('tok-A');
    const b = await track('tok-B');
    const gotA = collect(a, ServerEvent.TrackingLocation);
    const gotB = collect(b, ServerEvent.TrackingLocation);
    realtime.publishRiderLocation(fix(orderA, 11.1));
    realtime.publishRiderLocation(fix(orderB, 22.2));
    await waitFor(gotA); await waitFor(gotB); await tick();
    expect(gotA).toHaveLength(1);
    expect(gotA[0]).toMatchObject({ latitude: 11.1, longitude: 75.37, heading: 90 });
    expect(gotB).toHaveLength(1);
    expect(gotB[0].latitude).toBe(22.2);
    for (const p of [...gotA, ...gotB]) {
      expect(p).not.toHaveProperty('orderId');
      expect(JSON.stringify(p)).not.toContain(orderA);
      expect(JSON.stringify(p)).not.toContain(orderB);
    }
  });

  it('never receives the staff / signed-in events (full order, orderId in location)', async () => {
    const a = await track('tok-A');
    const full = collect(a, ServerEvent.RiderLocation);
    const fullStatus = collect(a, ServerEvent.OrderStatusChanged);
    const created = collect(a, ServerEvent.OrderCreated);
    realtime.publishRiderLocation(fix(orderA));
    realtime.publishOrderStatusChanged(orderDoc(orderA, OrderStatus.OutForDelivery), OrderStatus.PickedUp);
    realtime.publishOrderCreated(orderDoc(orderA, OrderStatus.Placed));
    await tick(300);
    expect(full).toHaveLength(0);
    expect(fullStatus).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('status pushes are the redacted snapshot: no phone, name, address text, price or ids', async () => {
    const a = await track('tok-A');
    const b = await track('tok-B');
    const gotA = collect(a, ServerEvent.TrackingStatus);
    const gotB = collect(b, ServerEvent.TrackingStatus);
    realtime.publishOrderStatusChanged(orderDoc(orderA, OrderStatus.OutForDelivery), OrderStatus.PickedUp);
    await waitFor(gotA); await tick();
    expect(gotA).toHaveLength(1);
    expect(gotB).toHaveLength(0);
    expect(gotA[0].order.status).toBe(OrderStatus.OutForDelivery);
    const json = JSON.stringify(gotA[0]);
    for (const secret of [orderA, 'Asha', '9876500000', 'Rose Villa', '14900', 'idempotency', 'riderId']) expect(json).not.toContain(secret);
  });

  it('a late joiner is handed the last known rider position at once', async () => {
    realtime.publishRiderLocation(fix(orderA, 33.3));
    const a = await (async () => {
      const s = io(url, { auth: { trackingToken: 'tok-A' }, transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(s);
      (s as any).early = collect(s, ServerEvent.TrackingLocation);
      await new Promise<void>((r) => s.on('connect', () => r()));
      return s;
    })();
    await waitFor((a as any).early);
    expect((a as any).early[0].latitude).toBe(33.3);
  });

  it('cannot join any room, leave one, or send rider locations', async () => {
    const a = await track('tok-A');
    expect(await emitAck(a, ClientEvent.JoinOrder, { orderId: orderA })).toEqual({ ok: false, error: 'forbidden' });
    expect(await emitAck(a, ClientEvent.JoinOrder, { orderId: orderB })).toEqual({ ok: false, error: 'forbidden' });
    expect(await emitAck(a, ClientEvent.LeaveOrder, { orderId: orderA })).toEqual({ ok: false, error: 'forbidden' });
    expect(await emitAck(a, ClientEvent.RiderLocation, fix(orderA))).toEqual({ ok: false, error: 'forbidden' });
    // ...and trying B still leaves B's traffic out
    const got = collect(a, ServerEvent.TrackingLocation);
    realtime.publishRiderLocation(fix(orderB));
    await tick(250);
    expect(got).toHaveLength(0);
  });

  it('revocation: the page is told, the socket is closed, other orders are untouched', async () => {
    const a = await track('tok-A');
    const b = await track('tok-B');
    const revoked = collect(a, ServerEvent.TrackingRevoked);
    const closed = new Promise<string>((r) => a.on('disconnect', r));
    realtime.publishTrackingRevoked(orderA);
    await waitFor(revoked);
    expect(revoked).toHaveLength(1);
    await expect(closed).resolves.toBeTruthy();
    expect(a.connected).toBe(false);
    expect(b.connected).toBe(true);
  });

  it('cancelling an order tells the page the new status, then closes it', async () => {
    const a = await track('tok-A');
    const status = collect(a, ServerEvent.TrackingStatus);
    const revoked = collect(a, ServerEvent.TrackingRevoked);
    realtime.publishOrderStatusChanged(orderDoc(orderA, OrderStatus.Cancelled), OrderStatus.Accepted);
    realtime.publishTrackingRevoked(orderA);
    await waitFor(revoked); await tick();
    expect(status[0]?.order.status).toBe(OrderStatus.Cancelled);
    expect(revoked).toHaveLength(1);
  });

  it('the 24 h expiry is enforced on the OPEN socket too', async () => {
    links.set('short', { orderId: orderA, expiresAt: new Date(Date.now() + 1200) });
    const s = await track('short');
    const expired = collect(s, ServerEvent.TrackingExpired);
    const closed = new Promise((r) => s.on('disconnect', r));
    await waitFor(expired, 1);
    expect(expired).toHaveLength(1);
    await closed;
    expect(s.connected).toBe(false);
  });

  it('staff are unaffected: a rider still sends, the kitchen still hears it', async () => {
    const kitchen = await asUser(oid(), Role.Kitchen);
    const a = await track('tok-A');
    const kitchenEvents = collect(kitchen, ServerEvent.OrderStatusChanged);
    const trackingEvents = collect(a, ServerEvent.TrackingStatus);
    realtime.publishOrderStatusChanged(orderDoc(orderA, OrderStatus.OutForDelivery), OrderStatus.PickedUp);
    await waitFor(kitchenEvents); await waitFor(trackingEvents);
    expect(kitchenEvents[0].order.contactPhone).toBe('+919876500000'); // staff keep the full view
    expect(trackingEvents[0].order).not.toHaveProperty('contactPhone');
  });
});
