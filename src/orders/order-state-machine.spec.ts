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
  [S.Assigned, S.PickedUp],
  [S.PickedUp, S.Delivered],
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
    for (const s of [S.Preparing, S.Ready, S.Assigned, S.PickedUp, S.Delivered]) {
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
});
