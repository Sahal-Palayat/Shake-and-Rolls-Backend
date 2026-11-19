// Source of truth for shared enums. Mirrored in frontend/src/types/enums.ts: change both together.

export enum Role {
  Customer = 'customer',
  Kitchen = 'kitchen',
  Rider = 'rider',
  Admin = 'admin',
}

/** Roles that log in with username + password/PIN. */
export const STAFF_ROLES = [Role.Kitchen, Role.Rider, Role.Admin] as const;

export enum OrderStatus {
  Placed = 'placed',
  Accepted = 'accepted',
  Preparing = 'preparing',
  Ready = 'ready',
  Assigned = 'assigned',
  PickedUp = 'picked_up',
  Delivered = 'delivered',
  Rejected = 'rejected',
  Cancelled = 'cancelled',
}

export enum PaymentStatus {
  CodPending = 'cod_pending',
  PaymentPending = 'payment_pending',
  Paid = 'paid',
  Failed = 'failed',
  Refunded = 'refunded',
  CodCollected = 'cod_collected',
}

export enum Fulfillment {
  Delivery = 'delivery',
  Pickup = 'pickup',
}
