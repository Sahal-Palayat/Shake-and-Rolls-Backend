import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderStatus, PaymentStatus, Role } from '../common/enums';
import { OrdersService } from './orders.service';

const oid = () => new Types.ObjectId();
const admin = { id: oid().toHexString(), role: Role.Admin };

function setup(order: Record<string, unknown>, riders: Record<string, Role> = {}) {
  const calls: { filter: any; update: any }[] = [];
  const model: any = {
    findOne: async () => order,
    findOneAndUpdate: async (filter: any, update: any) => {
      calls.push({ filter, update });
      return { ...order, ...update.$set };
    },
  };
  const users: any = { findActiveById: async (id: string) => (riders[id] ? { id, role: riders[id] } : null) };
  const realtime: any = { publishOrderStatusChanged: jest.fn() };
  const svc = new OrdersService(model, {} as any, {} as any, realtime, users);
  return { svc, calls, realtime };
}
const base = (status: OrderStatus, extra: Record<string, unknown> = {}) => ({
  status, paymentMethod: 'cod', paymentStatus: PaymentStatus.CodPending, ...extra,
});

describe('OrdersService.override', () => {
  it('is admin only', async () => {
    const { svc } = setup(base(OrderStatus.Placed));
    await expect(svc.override({ id: oid().toHexString(), role: Role.Kitchen }, 'x', { status: OrderStatus.Ready, reason: 'because' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('jumps an illegal path, logs the reason, compare-and-sets on the old status, emits', async () => {
    const { svc, calls, realtime } = setup(base(OrderStatus.Placed));
    await svc.override(admin, 'o1', { status: OrderStatus.Ready, reason: 'kitchen forgot to tap' });
    expect(calls[0].filter.status).toBe(OrderStatus.Placed);
    expect(calls[0].update.$push.statusLog).toMatchObject({ from: 'placed', to: 'ready', byRole: Role.Admin, reason: '[override] kitchen forgot to tap' });
    expect(realtime.publishOrderStatusChanged).toHaveBeenCalledTimes(1);
  });

  it('same status = 409', async () => {
    const { svc } = setup(base(OrderStatus.Ready));
    await expect(svc.override(admin, 'o', { status: OrderStatus.Ready, reason: 'abc' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('assigned needs an active RIDER (not kitchen, not unknown)', async () => {
    const kitchenId = oid().toHexString();
    const { svc } = setup(base(OrderStatus.Ready), { [kitchenId]: Role.Kitchen });
    await expect(svc.override(admin, 'o', { status: OrderStatus.Assigned, reason: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.override(admin, 'o', { status: OrderStatus.Assigned, reason: 'abc', riderId: kitchenId })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.override(admin, 'o', { status: OrderStatus.Assigned, reason: 'abc', riderId: oid().toHexString() })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('assigns a valid rider', async () => {
    const r = oid().toHexString();
    const { svc, calls } = setup(base(OrderStatus.Ready), { [r]: Role.Rider });
    await svc.override(admin, 'o', { status: OrderStatus.Assigned, reason: 'abc', riderId: r });
    expect(String(calls[0].update.$set.riderId)).toBe(r);
  });

  it('moving back / cancelling clears the rider; riderId in the body is rejected', async () => {
    const rider = oid();
    const { svc, calls } = setup(base(OrderStatus.Assigned, { riderId: rider }));
    await expect(svc.override(admin, 'o', { status: OrderStatus.Cancelled, reason: 'abc', riderId: rider.toHexString() })).rejects.toBeInstanceOf(BadRequestException);
    await svc.override(admin, 'o', { status: OrderStatus.Cancelled, reason: 'customer called' });
    expect(calls[0].update.$unset).toEqual({ riderId: 1 });
  });

  it('delivered (COD) marks cash collected; un-delivering reverts it', async () => {
    const rider = oid();
    const a = setup(base(OrderStatus.PickedUp, { riderId: rider }));
    await a.svc.override(admin, 'o', { status: OrderStatus.Delivered, reason: 'rider phone died' });
    expect(a.calls[0].update.$set.paymentStatus).toBe(PaymentStatus.CodCollected);

    const b = setup(base(OrderStatus.Delivered, { riderId: rider, paymentStatus: PaymentStatus.CodCollected }));
    await b.svc.override(admin, 'o', { status: OrderStatus.PickedUp, reason: 'tapped by mistake' });
    expect(b.calls[0].update.$set.paymentStatus).toBe(PaymentStatus.CodPending);
  });
});
