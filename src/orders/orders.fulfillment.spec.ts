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
  const realtime: any = { publishOrderCreated: jest.fn(), publishOrderStatusChanged: jest.fn(), publishTrackingRevoked: jest.fn() };
  const users: any = { findActiveById: async () => null };
  const tracking: any = { revokeAllForOrder: jest.fn().mockResolvedValue(0), issueTrackingLink: jest.fn(), urlFor: (t: string) => `https://shop.test/track/${t}` };
  return { svc: new OrdersService(model, menu, config, realtime, users, tracking), created, calls, realtime, tracking };
}

const lineIn = { menuItemId: oid().toHexString(), quantity: 1 };
const SHOP = { lat: 11.8745, lng: 75.3704 };
const addr = { line1: '12 Main Rd', latitude: SHOP.lat, longitude: SHOP.lng };
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
    expect(created[0]).toMatchObject({ fulfillment: 'delivery', subtotalPaise: 20000, deliveryFeePaise: 3000, totalPaise: 23000, deliveryAddress: { line1: '12 Main Rd', location: { type: 'Point', coordinates: [SHOP.lng, SHOP.lat] } } });
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

describe('create: delivery area (GPS is the source of truth)', () => {
  const AREA = { RESTAURANT_LAT: SHOP.lat, RESTAURANT_LNG: SHOP.lng, DELIVERY_RADIUS_METERS: 5000 };
  const at = (latitude: number, longitude: number) => ({ ...base, deliveryAddress: { ...addr, latitude, longitude } });

  it('accepts a pin inside the radius and stores [lng, lat] plus the door details', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(20000));
    const { svc, created } = setup(AREA);
    await svc.create(customer, 'key-12345678', { ...at(SHOP.lat + 0.01, SHOP.lng), deliveryAddress: { ...addr, latitude: SHOP.lat + 0.01, longitude: SHOP.lng, houseName: ' Rose Villa ', buildingName: 'Sea View', floor: '3', formattedAddress: '12 Main Rd, Kannur', locationSource: 'pin' } });
    expect(created[0].deliveryAddress).toMatchObject({
      location: { type: 'Point', coordinates: [SHOP.lng, SHOP.lat + 0.01] },
      houseName: 'Rose Villa',
      buildingName: 'Sea View',
      floor: '3',
      formattedAddress: '12 Main Rd, Kannur',
      locationSource: 'pin',
    });
  });

  it('rejects a pin outside the radius, even though the address text says it is local', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(20000));
    const { svc, created } = setup(AREA);
    await expect(svc.create(customer, 'key-12345678', at(SHOP.lat + 0.2, SHOP.lng))).rejects.toThrow(/outside our delivery area/);
    expect(created).toHaveLength(0);
  });

  it('pickup is never area-checked', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(20000));
    const { svc } = setup(AREA);
    await expect(svc.create(customer, 'key-12345678', { ...base, fulfillment: Fulfillment.Pickup })).resolves.toBeDefined();
  });

  it('no area configured = no restriction', async () => {
    (priceLines as jest.Mock).mockReturnValue(priced(20000));
    const { svc } = setup({});
    await expect(svc.create(customer, 'key-12345678', at(28.6, 77.2))).resolves.toBeDefined();
  });

  it('exposes the area for the checkout map', () => {
    expect(setup({}).svc.deliveryArea()).toBeUndefined();
    expect(setup(AREA).svc.deliveryArea()).toEqual({ center: SHOP, radiusMeters: 5000 });
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

describe('transition: rider checkpoints (accepted, picked up, out for delivery)', () => {
  const onRoad = (status: OrderStatus) => ({ status, fulfillment: 'delivery', paymentMethod: 'cod', paymentStatus: PaymentStatus.CodPending, totalPaise: 23000 });

  it.each([
    [OrderStatus.Assigned, OrderStatus.RiderAccepted],
    [OrderStatus.RiderAccepted, OrderStatus.PickedUp],
    [OrderStatus.PickedUp, OrderStatus.OutForDelivery],
    [OrderStatus.Assigned, OrderStatus.PickedUp], // skipping stays legal
  ])('rider: %s -> %s needs no cash', async (from, to) => {
    const { svc, calls } = setup({}, onRoad(from));
    const o = await svc.transition(rider, 'o1', { status: to });
    expect(o.status).toBe(to);
    expect(calls[0].update.$set.cashCollectedPaise).toBeUndefined();
  });

  it('cash is only asked at the last step: out_for_delivery -> delivered', async () => {
    const a = setup({}, onRoad(OrderStatus.OutForDelivery));
    await expect(a.svc.transition(rider, 'o1', { status: OrderStatus.Delivered })).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({}, onRoad(OrderStatus.OutForDelivery));
    await b.svc.transition(rider, 'o1', { status: OrderStatus.Delivered, cashCollectedPaise: 23000 });
    expect(b.calls[0].update.$set).toMatchObject({ status: OrderStatus.Delivered, paymentStatus: PaymentStatus.CodCollected, cashCollectedPaise: 23000 });
  });

  it('only the rider (or admin) moves these: the kitchen cannot accept for the rider', async () => {
    const { svc } = setup({}, onRoad(OrderStatus.Assigned));
    await expect(svc.transition(kitchen, 'o1', { status: OrderStatus.RiderAccepted })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no going back', async () => {
    const { svc } = setup({}, onRoad(OrderStatus.OutForDelivery));
    await expect(svc.transition(rider, 'o1', { status: OrderStatus.PickedUp })).rejects.toThrow(/Illegal transition/);
  });

  it('every checkpoint is written to the status log with the rider as actor', async () => {
    const { svc, calls } = setup({}, onRoad(OrderStatus.Assigned));
    await svc.transition(rider, 'o1', { status: OrderStatus.RiderAccepted });
    expect(calls[0].update.$push.statusLog).toMatchObject({ from: OrderStatus.Assigned, to: OrderStatus.RiderAccepted, byRole: Role.Rider });
  });
});
