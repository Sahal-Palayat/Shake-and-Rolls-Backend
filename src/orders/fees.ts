import { Fulfillment } from '../common/enums';

/** All amounts in paise. 0 means "not set / free". Comes from env (see config/env.ts). */
export type FeeConfig = {
  deliveryFeePaise: number;
  /** Delivery is free once the subtotal reaches this. 0 = never free. */
  freeDeliveryAbovePaise: number;
  /** Smallest subtotal (before fees) we accept. 0 = no minimum. */
  minOrderPaise: number;
};

export function loadFeeConfig(get: (key: string) => number | undefined): FeeConfig {
  return {
    deliveryFeePaise: get('DELIVERY_FEE_PAISE') ?? 0,
    freeDeliveryAbovePaise: get('FREE_DELIVERY_ABOVE_PAISE') ?? 0,
    minOrderPaise: get('MIN_ORDER_PAISE') ?? 0,
  };
}

/** Pickup is always free to the customer. Delivery is the flat fee unless the free-delivery threshold is met. */
export function deliveryFeeFor(fulfillment: Fulfillment, subtotalPaise: number, cfg: FeeConfig): number {
  if (fulfillment === Fulfillment.Pickup) return 0;
  if (cfg.freeDeliveryAbovePaise > 0 && subtotalPaise >= cfg.freeDeliveryAbovePaise) return 0;
  return cfg.deliveryFeePaise;
}
