import { Types } from 'mongoose';
import { OrderStatus, Role } from '../common/enums';
import { toPublicLocation, toPublicTrackingOrder } from './tracking.mapper';

const customerId = new Types.ObjectId();
const orderId = new Types.ObjectId();
const riderId = new Types.ObjectId();
const staffId = new Types.ObjectId();

const order = (status: OrderStatus, extra: Record<string, unknown> = {}): any => ({
  _id: orderId,
  id: orderId.toHexString(),
  orderNumber: 'SR-7K4M2Q',
  status,
  customerId,
  riderId,
  contactName: 'Asha Menon',
  contactPhone: '+919876500000',
  customerNote: 'Gate code 4411',
  paymentStatus: 'cod_pending',
  totalPaise: 34900,
  idempotencyKey: 'secret-idem-key',
  requestHash: 'secret-hash',
  deliveryAddress: { line1: '12 Rose Villa, Temple Rd', formattedAddress: '12 Rose Villa', location: { type: 'Point', coordinates: [75.3704, 11.8745] } },
  lines: [{ menuItemId: new Types.ObjectId(), name: 'Paneer Wrap', unitPricePaise: 14900, options: [], quantity: 2, lineTotalPaise: 29800, note: 'no onion' }],
  statusLog: [{ from: null, to: OrderStatus.Placed, byUserId: staffId, byRole: Role.Customer, at: new Date('2026-01-01T10:00:00Z'), reason: 'internal remark' }],
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-01T10:05:00Z'),
  ...extra,
});

describe('toPublicTrackingOrder', () => {
  it('exposes ONLY the whitelisted fields', () => {
    const dto = toPublicTrackingOrder(order(OrderStatus.OutForDelivery));
    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'destination', 'isLive', 'items', 'orderNumber', 'status', 'timeline', 'updatedAt']);
  });

  it('leaks no internal id, personal data, money, rider or staff identity', () => {
    const json = JSON.stringify(toPublicTrackingOrder(order(OrderStatus.OutForDelivery)));
    for (const secret of [orderId.toHexString(), customerId.toHexString(), riderId.toHexString(), staffId.toHexString(), 'Asha', '9876500000', 'Gate code', 'Rose Villa', 'Temple Rd', 'secret-idem', 'secret-hash', 'internal remark', 'no onion', '34900', '14900', 'cod_pending']) {
      expect(json).not.toContain(secret);
    }
  });

  it('shows the human order code and item names with quantities', () => {
    const dto = toPublicTrackingOrder(order(OrderStatus.Preparing));
    expect(dto.orderNumber).toBe('SR-7K4M2Q');
    expect(dto.items).toEqual([{ name: 'Paneer Wrap', quantity: 2 }]);
    expect(dto.timeline).toEqual([{ status: OrderStatus.Placed, at: '2026-01-01T10:00:00.000Z' }]);
  });

  it('gives the delivery pin (lat, lng) only while the rider is on the way', () => {
    for (const s of [OrderStatus.RiderAccepted, OrderStatus.PickedUp, OrderStatus.OutForDelivery]) {
      const d = toPublicTrackingOrder(order(s));
      expect(d.isLive).toBe(true);
      expect(d.destination).toEqual({ latitude: 11.8745, longitude: 75.3704 });
    }
    for (const s of [OrderStatus.Placed, OrderStatus.Preparing, OrderStatus.Ready, OrderStatus.Assigned, OrderStatus.Delivered, OrderStatus.Cancelled]) {
      const d = toPublicTrackingOrder(order(s));
      expect(d.isLive).toBe(false);
      expect(d.destination).toBeUndefined();
    }
  });
});

describe('toPublicLocation', () => {
  it('drops the order id', () => {
    const out = toPublicLocation({ orderId: orderId.toHexString(), latitude: 1, longitude: 2, heading: 90, accuracy: 5, timestamp: 9 } as any);
    expect(out).toEqual({ latitude: 1, longitude: 2, heading: 90, accuracy: 5, timestamp: 9 });
    expect(JSON.stringify(out)).not.toContain(orderId.toHexString());
  });
});
