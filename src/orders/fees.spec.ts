import { Fulfillment } from '../common/enums';
import { deliveryFeeFor, loadFeeConfig } from './fees';

const cfg = { deliveryFeePaise: 3000, freeDeliveryAbovePaise: 40000, minOrderPaise: 0 };

describe('deliveryFeeFor', () => {
  it('charges the flat fee for delivery', () => expect(deliveryFeeFor(Fulfillment.Delivery, 10000, cfg)).toBe(3000));
  it('pickup is always free', () => expect(deliveryFeeFor(Fulfillment.Pickup, 10000, cfg)).toBe(0));
  it('free at exactly the threshold, charged one paisa below', () => {
    expect(deliveryFeeFor(Fulfillment.Delivery, 40000, cfg)).toBe(0);
    expect(deliveryFeeFor(Fulfillment.Delivery, 39999, cfg)).toBe(3000);
  });
  it('threshold 0 means never free', () => expect(deliveryFeeFor(Fulfillment.Delivery, 9_999_999, { ...cfg, freeDeliveryAbovePaise: 0 })).toBe(3000));
});

describe('loadFeeConfig', () => {
  it('defaults everything to 0 when unset', () => expect(loadFeeConfig(() => undefined)).toEqual({ deliveryFeePaise: 0, freeDeliveryAbovePaise: 0, minOrderPaise: 0 }));
});
