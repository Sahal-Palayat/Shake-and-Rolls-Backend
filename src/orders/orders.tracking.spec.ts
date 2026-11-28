import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { Fulfillment, OrderStatus, PaymentStatus, Role } from '../common/enums';
import { AccessTokenKind, RevokeReason } from '../tracking/tracking.constants';
import { SubmitReviewDto } from '../tracking/dto/tracking.dto';
import { OrdersService } from './orders.service';

const oid = () => new Types.ObjectId();
const admin = { id: oid().toHexString(), role: Role.Admin };
const kitchen = { id: oid().toHexString(), role: Role.Kitchen };
const rider = { id: oid().toHexString(), role: Role.Rider };

function setup(order: Record<string, unknown> | null) {
  const model: any = {
    // honours the rider scope the way MongoDB would
    findOne: async (f: any) => (order && (!f.riderId || String(f.riderId) === String(order.riderId)) ? order : null),
    findOneAndUpdate: async (_f: any, u: any) => ({ id: 'ord1', orderNumber: 'SR-TEST22', ...order, ...u.$set }),
  };
  const realtime: any = { publishOrderStatusChanged: jest.fn(), publishTrackingRevoked: jest.fn() };
  const tracking: any = {
    issueTrackingLink: jest.fn().mockResolvedValue({ token: 'TOKEN', expiresAt: new Date('2026-01-02T10:00:00Z') }),
    urlFor: (t: string) => `https://yourdomain.com/track/${t}`,
    revokeAllForOrder: jest.fn().mockResolvedValue(2),
  };
  const users: any = { findActiveById: async () => null };
  return { svc: new OrdersService(model, {} as any, {} as any, realtime, users, tracking), realtime, tracking };
}
const order = (status: OrderStatus, extra: Record<string, unknown> = {}) => ({
  status, fulfillment: Fulfillment.Delivery, paymentMethod: 'cod', paymentStatus: PaymentStatus.CodPending, totalPaise: 10000, riderId: undefined, ...extra,
});

describe('createTrackingLink', () => {
  it('returns the URL and expiry, and records who made it', async () => {
    const { svc, tracking } = setup(order(OrderStatus.OutForDelivery));
    const id = oid().toHexString();
    const r = await svc.createTrackingLink(admin, id);
    expect(r).toEqual({ url: 'https://yourdomain.com/track/TOKEN', expiresAt: '2026-01-02T10:00:00.000Z' });
    expect(tracking.issueTrackingLink).toHaveBeenCalledWith(id, admin.id);
    expect(r.url).not.toContain(id);
  });

  it('is for delivery orders only', async () => {
    const { svc, tracking } = setup(order(OrderStatus.Ready, { fulfillment: Fulfillment.Pickup }));
    await expect(svc.createTrackingLink(admin, oid().toHexString())).rejects.toBeInstanceOf(BadRequestException);
    expect(tracking.issueTrackingLink).not.toHaveBeenCalled();
  });

  it('is refused for cancelled / rejected orders', async () => {
    for (const s of [OrderStatus.Cancelled, OrderStatus.Rejected]) {
      const { svc, tracking } = setup(order(s));
      await expect(svc.createTrackingLink(admin, oid().toHexString())).rejects.toBeInstanceOf(ConflictException);
      expect(tracking.issueTrackingLink).not.toHaveBeenCalled();
    }
  });

  it('a rider can do it only for their OWN order (404 otherwise, nothing issued)', async () => {
    const mine = setup(order(OrderStatus.OutForDelivery, { riderId: new Types.ObjectId(rider.id) }));
    await expect(mine.svc.createTrackingLink(rider, oid().toHexString())).resolves.toHaveProperty('url');
    const other = setup(order(OrderStatus.OutForDelivery, { riderId: oid() }));
    await expect(other.svc.createTrackingLink(rider, oid().toHexString())).rejects.toMatchObject({ status: 404 });
    expect(other.tracking.issueTrackingLink).not.toHaveBeenCalled();
  });
});

describe('revokeTrackingLinks (security invalidation)', () => {
  it('revokes tracking AND review access for the order and drops open pages', async () => {
    const { svc, tracking, realtime } = setup(order(OrderStatus.OutForDelivery));
    const id = oid().toHexString();
    await expect(svc.revokeTrackingLinks(kitchen, id)).resolves.toEqual({ revoked: 2 });
    expect(tracking.revokeAllForOrder).toHaveBeenCalledWith(id, RevokeReason.Security, [AccessTokenKind.Tracking, AccessTokenKind.Review]);
    expect(realtime.publishTrackingRevoked).toHaveBeenCalledWith(id);
  });
});

describe('cancel / reject close tracking', () => {
  it.each([
    [OrderStatus.Placed, OrderStatus.Cancelled, RevokeReason.Cancelled, { id: kitchen.id, role: Role.Kitchen }],
    [OrderStatus.Placed, OrderStatus.Rejected, RevokeReason.Rejected, { id: kitchen.id, role: Role.Kitchen }],
  ])('%s -> %s revokes the links and closes open pages', async (from, to, reason, user) => {
    const { svc, tracking, realtime } = setup(order(from));
    await svc.transition(user, oid().toHexString(), { status: to } as any);
    expect(tracking.revokeAllForOrder).toHaveBeenCalledWith('ord1', reason, [AccessTokenKind.Tracking, AccessTokenKind.Review]);
    expect(realtime.publishTrackingRevoked).toHaveBeenCalledWith('ord1');
  });

  it('a customer cancelling their own order does it too', async () => {
    const customer = { id: oid().toHexString(), role: Role.Customer };
    const { svc, tracking, realtime } = setup(order(OrderStatus.Placed));
    (svc as any).orders.findOne = async () => order(OrderStatus.Placed);
    await svc.transition(customer, oid().toHexString(), { status: OrderStatus.Cancelled } as any);
    expect(tracking.revokeAllForOrder).toHaveBeenCalledTimes(1);
    expect(realtime.publishTrackingRevoked).toHaveBeenCalledTimes(1);
  });

  it('admin override to cancelled does it too', async () => {
    const { svc, tracking } = setup(order(OrderStatus.OutForDelivery, { riderId: oid() }));
    await svc.override(admin, oid().toHexString(), { status: OrderStatus.Cancelled, reason: 'customer called' });
    expect(tracking.revokeAllForOrder).toHaveBeenCalledTimes(1);
  });

  it('normal progress (and delivery) leaves the links alone', async () => {
    const { svc, tracking, realtime } = setup(order(OrderStatus.Placed));
    await svc.transition(kitchen, oid().toHexString(), { status: OrderStatus.Accepted } as any);
    expect(tracking.revokeAllForOrder).not.toHaveBeenCalled();
    expect(realtime.publishTrackingRevoked).not.toHaveBeenCalled();
  });

  it('if the revoke write fails the cancellation still goes through and open pages are still closed', async () => {
    const { svc, tracking, realtime } = setup(order(OrderStatus.Placed));
    tracking.revokeAllForOrder.mockRejectedValue(new Error('mongo down'));
    const updated = await svc.transition(kitchen, oid().toHexString(), { status: OrderStatus.Cancelled } as any);
    expect(updated.status).toBe(OrderStatus.Cancelled);
    expect(realtime.publishTrackingRevoked).toHaveBeenCalled();
    // (and TrackingTokensService.authorizeTracking denies a cancelled order regardless: see tracking.flow.spec.ts)
  });
});

describe('SubmitReviewDto', () => {
  const check = async (body: unknown) => (await validate(plainToInstance(SubmitReviewDto, body), { whitelist: true, forbidNonWhitelisted: true })).length;
  it('accepts 1..5 whole stars, with or without a comment', async () => {
    for (const rating of [1, 2, 3, 4, 5]) expect(await check({ rating })).toBe(0);
    expect(await check({ rating: 5, comment: 'Great' })).toBe(0);
  });
  it('rejects 0, 6, halves, text, missing, and unknown fields (no smuggling an order id)', async () => {
    for (const body of [{ rating: 0 }, { rating: 6 }, { rating: 3.5 }, { rating: '5' }, { rating: null }, {}, { rating: 5, orderId: 'x' }, { rating: 5, comment: 42 }, { rating: 5, comment: 'x'.repeat(2000) }]) {
      expect(await check(body)).toBeGreaterThan(0);
    }
  });
});
