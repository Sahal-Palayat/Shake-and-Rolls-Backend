import { OrderStatus } from '../common/enums';
import { deliveredAtOf, normalizeComment, reviewDeadline } from './review';

describe('normalizeComment', () => {
  it('trims, and turns blank into undefined', () => {
    expect(normalizeComment('  great  ')).toBe('great');
    expect(normalizeComment('   \n  ')).toBeUndefined();
    expect(normalizeComment(undefined)).toBeUndefined();
    expect(normalizeComment(null)).toBeUndefined();
    expect(normalizeComment(42 as unknown as string)).toBeUndefined();
  });
  it('drops control characters but keeps line breaks', () => {
    expect(normalizeComment('a\u0000b\u0007c\td\ne')).toBe('abcd\ne');
    expect(normalizeComment('a\r\nb')).toBe('a\nb');
    expect(normalizeComment('a\n\n\n\n\nb')).toBe('a\n\nb');
  });
  it('caps at 500 characters', () => {
    expect(normalizeComment('x'.repeat(900))).toHaveLength(500);
  });
  it('leaves markup alone (React escapes it when shown)', () => {
    expect(normalizeComment('<b>hot</b>')).toBe('<b>hot</b>');
  });
});

describe('deliveredAtOf / reviewDeadline', () => {
  const t = (iso: string) => new Date(iso);
  it('uses the LAST move to delivered, falls back to updatedAt', () => {
    const log = [
      { to: OrderStatus.Delivered, at: t('2026-01-01T10:00:00Z') },
      { to: OrderStatus.PickedUp, at: t('2026-01-01T11:00:00Z') },
      { to: OrderStatus.Delivered, at: t('2026-01-01T12:00:00Z') },
    ];
    expect(deliveredAtOf({ statusLog: log, updatedAt: t('2026-02-01T00:00:00Z') })).toEqual(t('2026-01-01T12:00:00Z'));
    expect(deliveredAtOf({ statusLog: [], updatedAt: t('2026-02-01T00:00:00Z') })).toEqual(t('2026-02-01T00:00:00Z'));
  });
  it('deadline = delivered + N days', () => {
    expect(reviewDeadline(t('2026-01-01T12:00:00Z'), 7)).toEqual(t('2026-01-08T12:00:00Z'));
  });
});
