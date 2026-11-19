import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Fulfillment, OrderStatus, PaymentStatus, Role } from '../common/enums';
import { OrdersService } from './orders.service';
import { priceLines } from './pricing';

jest.mock('./pricing', () => ({ priceLines: jest.fn() }));

const oid = () => new Types.ObjectId();
const customer = { id: oid().toHexString(), role: Role.Customer };
const kitchen = { id: oid().toHexString(), role: Role.Kitchen };
const rider = { id: oid().toHexString(), role: Role.Rider };

const priced = (subtotal: number) => ({
  lines: [{ menuItemId: oid(), name: 'Paneer Wrap', isVeg: true, unitPricePaise: subtotal, options: [{ optionId: oid(), groupName: 'Add-ons', name: 'Cheese', priceDeltaPaise: 0 }], quantity: 1, lineTotalPaise: subtotal }],
  totalPaise: subtotal,
});

function setup(env: Record<string, number> = {}, order: Record<string, unknown> | null = null) {
  const created: any[] = [];
  const calls: { filter: any; update: any }[] = [];
  const model: any = {
    findOne: async () => order,
    create: async (doc: any) => { created.push(doc); return { ...doc, id: 'new' }; },
    findOneAndUpdate: async (filter: any, update: any) => { calls.push({ filter, update }); return { ...order, ...update.$set }; },
  };
  const menu: any = { findItemsByIds: async () => [] };
  const config: any = { get: (k: string) => env[k] };
  const realtime: any = { publishOrderCreated: jest.fn(), publishOrderStatusChanged: jest.fn() };
  const users: any = { findActiveById: async () => null };
  return { svc: new OrdersService(model, menu, config, realtime, users), created, calls, realtime };
}

const lineIn = { menuItemId: oid().toHexString(), quantity: 1 };
const addr = { line1: '12 Main Rd' };
const base = { lines: [lineIn], paymentMethod: 'cod' as const, contactName: 'Asha', contactPhone: '9876500000' };

beforeEach(() => (priceLines as jest.Mock).mockReset());

describe('quote', () => {
  it('adds the delivery fee for delivery and none for pickup', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(20000));
    const { svc } = setup({ DELIVERY_FEE_PAISE: 3000 });
    const d = await svc.quote({ lines: [lineIn], fulfillment: Fulfillment.Delivery });
    expect(d).toMatchObject({ subtotalPaise: 20000, deliveryFeePaise: 3000, totalPaise: 23000, fulfillment: 'delivery' });
    const p = await svc.quote({ lines: [lineIn], fulfillment: Fulfillment.Pickup });
    expect(p).toMatchObject({ deliveryFeePaise: 0, totalPaise: 20000 });
  });

  it('defaults to delivery, stringifies ids, reports the limits', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(10000));
    const { svc } = setup({ DELIVERY_FEE_PAISE: 3000, FREE_DELIVERY_ABOVE_PAISE: 40000, MIN_ORDER_PAISE: 9900, MAX_COD_PAISE: 200000 });
    const q = await svc.quote({ lines: [lineIn] });
    expect(q.fulfillment).toBe('delivery');
    expect(typeof q.lines[0].menuItemId).toBe('string');
    expect(typeof q.lines[0].options[0].optionId).toBe('string');
    expect(q).toMatchObject({ minOrderPaise: 9900, freeDeliveryAbovePaise: 40000, maxCodPaise: 200000 });
  });

  it('env values that arrive as strings still work', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(10000));
    const { svc } = setup({ DELIVERY_FEE_PAISE: '3000' as unknown as number });
    expect((await svc.quote({ lines: [lineIn] })).totalPaise).toBe(13000);
  });
});

describe('create', () => {
  it('delivery: stores the fee, subtotal and total; goes to the kitchen', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(20000));
    const { svc, created, realtime } = setup({ DELIVERY_FEE_PAISE: 3000 });
    await svc.create(customer, 'key-12345678', { ...base, deliveryAddress: addr });
    expect(created[0]).toMatchObject({ fulfillment: 'delivery', subtotalPaise: 20000, deliveryFeePaise: 3000, totalPaise: 23000, deliveryAddress: { line1: '12 Main Rd' } });
    expect(realtime.publishOrderCreated).toHaveBeenCalled();
  });

  it('pickup: no address needed, none stored, no fee', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(20000));
    const { svc, created } = setup({ DELIVERY_FEE_PAISE: 3000 });
    await svc.create(customer, 'key-12345678', { ...base, fulfillment: Fulfillment.Pickup });
    expect(created[0].fulfillment).toBe('pickup');
    expect(created[0].deliveryFeePaise).toBe(0);
    expect(created[0].totalPaise).toBe(20000);
    expect('deliveryAddress' in created[0]).toBe(false);
  });

  it('delivery without an address is rejected', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(20000));
    const { svc } = setup();
    await expect(svc.create(customer, 'key-12345678', { ...base })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('below the minimum order is rejected; the fee does not count towards it', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(9000));
    const { svc } = setup({ MIN_ORDER_PAISE: 10000, DELIVERY_FEE_PAISE: 3000 });
    await expect(svc.create(customer, 'key-12345678', { ...base, deliveryAddress: addr })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('the COD limit applies to subtotal + fee', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(199000));
    const { svc } = setup({ MAX_COD_PAISE: 200000, DELIVERY_FEE_PAISE: 3000 });
    await expect(svc.create(customer, 'key-12345678', { ...base, deliveryAddress: addr })).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(svc.create(customer, 'key-12345678', { ...base, fulfillment: Fulfillment.Pickup })).resolves.toBeDefined();
  });
});

describe('transition: pickup handover', () => {
  const pickup = (status: OrderStatus) => ({ status, fulfillment: 'pickup', paymentMethod: 'cod', paymentStatus: PaymentStatus.CodPending });

  it('kitchen can hand over a ready pickup order; COD cash is marked collected', async () => {
    const { svc, calls, realtime } = setup({}, pickup(OrderStatus.Ready));
    await svc.transition(kitchen, 'o1', { status: OrderStatus.Delivered });
    expect(calls[0].filter.status).toBe(OrderStatus.Ready);
    expect(calls[0].update.$set).toMatchObject({ status: 'delivered', paymentStatus: 'cod_collected' });
    expect(realtime.publishOrderStatusChanged).toHaveBeenCalled();
  });

  it('a rider cannot', async () => {
    const { svc } = setup({}, pickup(OrderStatus.Ready));
    await expect(svc.transition(rider, 'o1', { status: OrderStatus.Delivered })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only from ready: a preparing pickup order cannot jump to delivered', async () => {
    const { svc } = setup({}, pickup(OrderStatus.Preparing));
    await expect(svc.transition(kitchen, 'o1', { status: OrderStatus.Delivered })).rejects.toThrow(/Illegal transition/);
  });

  it('pickup orders cannot be assigned a rider', async () => {
    const { svc } = setup({}, pickup(OrderStatus.Ready));
    await expect(svc.transition(kitchen, 'o1', { status: OrderStatus.Assigned, riderId: oid().toHexString() })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a DELIVERY order still cannot skip the rider', async () => {
    const { svc } = setup({}, { ...pickup(OrderStatus.Ready), fulfillment: 'delivery' });
    await expect(svc.transition(kitchen, 'o1', { status: OrderStatus.Delivered })).rejects.toThrow(/Illegal transition/);
  });

  it('old orders with no fulfillment field behave as delivery', async () => {
    const { svc } = setup({}, { status: OrderStatus.Ready, paymentMethod: 'cod', paymentStatus: PaymentStatus.CodPending });
    await expect(svc.transition(kitchen, 'o1', { status: OrderStatus.Delivered })).rejects.toThrow(/Illegal transition/);
  });
});
