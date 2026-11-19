import { OrderStatus, Role } from '../common/enums';

/**
 * Pure rules. No DB, no Nest. The service calls these; unit tests hit them directly.
 * Server-side only: the client never decides what is legal.
 */

type Rule = { to: OrderStatus; roles: readonly Role[] };

const STAFF = [Role.Kitchen, Role.Admin] as const;

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
  [OrderStatus.Assigned]: [{ to: OrderStatus.PickedUp, roles: [Role.Rider, Role.Admin] }],
  [OrderStatus.PickedUp]: [{ to: OrderStatus.Delivered, roles: [Role.Rider, Role.Admin] }],
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
