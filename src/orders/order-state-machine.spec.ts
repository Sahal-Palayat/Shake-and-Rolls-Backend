import { OrderStatus as S, Role } from '../common/enums';
import { canRoleTransition, isLegalTransition, nextStatuses } from './order-state-machine';

const ALL = Object.values(S);
const LEGAL: [S, S][] = [
  [S.Placed, S.Accepted],
  [S.Placed, S.Rejected],
  [S.Placed, S.Cancelled],
  [S.Accepted, S.Preparing],
  [S.Accepted, S.Cancelled],
  [S.Preparing, S.Ready],
  [S.Ready, S.Assigned],
  [S.Assigned, S.RiderAccepted],
  [S.Assigned, S.PickedUp], // skipping "accepted" stays legal
  [S.RiderAccepted, S.PickedUp],
  [S.PickedUp, S.OutForDelivery],
  [S.PickedUp, S.Delivered], // skipping "out for delivery" stays legal
  [S.OutForDelivery, S.Delivered],
];

describe('order state machine', () => {
  it.each(LEGAL)('%s -> %s is legal', (a, b) => expect(isLegalTransition(a, b)).toBe(true));

  it('every other pair is illegal (skips, backwards, self, out of terminal)', () => {
    for (const a of ALL) {
      for (const b of ALL) {
        if (LEGAL.some(([x, y]) => x === a && y === b)) continue;
        expect({ a, b, legal: isLegalTransition(a, b) }).toEqual({ a, b, legal: false });
      }
    }
  });

  it('terminal states have no exits', () => {
    for (const t of [S.Delivered, S.Rejected, S.Cancelled]) expect(nextStatuses(t)).toEqual([]);
  });

  it('cancel/reject only from early states', () => {
    for (const s of [S.Preparing, S.Ready, S.Assigned, S.RiderAccepted, S.PickedUp, S.OutForDelivery, S.Delivered]) {
      expect(isLegalTransition(s, S.Cancelled)).toBe(false);
      expect(isLegalTransition(s, S.Rejected)).toBe(false);
    }
  });

  it('roles', () => {
    expect(canRoleTransition(S.Placed, S.Accepted, Role.Kitchen)).toBe(true);
    expect(canRoleTransition(S.Placed, S.Accepted, Role.Customer)).toBe(false);
    expect(canRoleTransition(S.Placed, S.Accepted, Role.Rider)).toBe(false);
    expect(canRoleTransition(S.Placed, S.Cancelled, Role.Customer)).toBe(true);
    expect(canRoleTransition(S.Accepted, S.Cancelled, Role.Customer)).toBe(false);
    expect(canRoleTransition(S.Assigned, S.PickedUp, Role.Rider)).toBe(true);
    expect(canRoleTransition(S.Assigned, S.PickedUp, Role.Kitchen)).toBe(false);
    expect(canRoleTransition(S.PickedUp, S.Delivered, Role.Customer)).toBe(false);
  });

  it('the rider checkpoints belong to the rider (and admin), nobody else', () => {
    for (const [a, b] of [[S.Assigned, S.RiderAccepted], [S.RiderAccepted, S.PickedUp], [S.PickedUp, S.OutForDelivery], [S.OutForDelivery, S.Delivered]] as [S, S][]) {
      expect(canRoleTransition(a, b, Role.Rider)).toBe(true);
      expect(canRoleTransition(a, b, Role.Admin)).toBe(true);
      expect(canRoleTransition(a, b, Role.Kitchen)).toBe(false);
      expect(canRoleTransition(a, b, Role.Customer)).toBe(false);
    }
  });

  it('no way back: a rider cannot undo a checkpoint', () => {
    expect(isLegalTransition(S.RiderAccepted, S.Assigned)).toBe(false);
    expect(isLegalTransition(S.OutForDelivery, S.PickedUp)).toBe(false);
  });
});
