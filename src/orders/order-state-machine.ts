import { OrderStatus, Role } from '../common/enums';

/**
 * Pure rules. No DB, no Nest. The service calls these; unit tests hit them directly.
 * Server-side only: the client never decides what is legal.
 */

type Rule = { to: OrderStatus; roles: readonly Role[] };

const STAFF = [Role.Kitchen, Role.Admin] as const;
const RIDER = [Role.Rider, Role.Admin] as const;

const RULES: Record<OrderStatus, readonly Rule[]> = {
  [OrderStatus.Placed]: [
    { to: OrderStatus.Accepted, roles: STAFF },
    { to: OrderStatus.Rejected, roles: STAFF },
    { to: OrderStatus.Cancelled, roles: [Role.Customer, Role.Kitchen, Role.Admin] },
  ],
  [OrderStatus.Accepted]: [
    { to: OrderStatus.Preparing, roles: STAFF },
    { to: OrderStatus.Cancelled, roles: STAFF }, // customer can only cancel while still `placed`
  ],
  [OrderStatus.Preparing]: [{ to: OrderStatus.Ready, roles: STAFF }],
  [OrderStatus.Ready]: [{ to: OrderStatus.Assigned, roles: STAFF }],
  // Rider leg: assigned -> accepted -> picked up -> out for delivery -> delivered.
  // "Accepted" and "out for delivery" are the rider's own checkpoints; skipping them stays legal so a
  // rider on a bad connection (or the kitchen / admin hand-over) is never stuck.
  [OrderStatus.Assigned]: [
    { to: OrderStatus.RiderAccepted, roles: RIDER },
    { to: OrderStatus.PickedUp, roles: RIDER },
  ],
  [OrderStatus.RiderAccepted]: [{ to: OrderStatus.PickedUp, roles: RIDER }],
  [OrderStatus.PickedUp]: [
    { to: OrderStatus.OutForDelivery, roles: RIDER },
    { to: OrderStatus.Delivered, roles: RIDER },
  ],
  [OrderStatus.OutForDelivery]: [{ to: OrderStatus.Delivered, roles: RIDER }],
  [OrderStatus.Delivered]: [],
  [OrderStatus.Rejected]: [],
  [OrderStatus.Cancelled]: [],
};

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return RULES[from].map((r) => r.to);
}

export function isLegalTransition(from: OrderStatus, to: OrderStatus): boolean {
  return RULES[from].some((r) => r.to === to);
}

export function canRoleTransition(from: OrderStatus, to: OrderStatus, role: Role): boolean {
  return RULES[from].some((r) => r.to === to && r.roles.includes(role));
}
