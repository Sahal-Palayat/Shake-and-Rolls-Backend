import { OrderStatus } from '../common/enums';
import { isTrackable, MAX_CLOCK_SKEW_MS, MAX_FIX_AGE_MS, parseRiderLocation } from './location';

const NOW = 1_800_000_000_000;
const ID = '64b7f0c2a1b2c3d4e5f60718';
const ok = (over: Record<string, unknown> = {}) => ({ orderId: ID, latitude: 11.8745, longitude: 75.3704, heading: 45, accuracy: 8.26, timestamp: NOW - 1000, ...over });
const reason = (b: unknown) => { const r = parseRiderLocation(b, NOW); return r.ok ? 'ok' : r.reason; };

describe('parseRiderLocation', () => {
  it('accepts a good fix and normalises it', () => {
    const r = parseRiderLocation(ok({ orderId: ID.toUpperCase() }), NOW);
    expect(r).toEqual({ ok: true, value: { orderId: ID, latitude: 11.8745, longitude: 75.3704, heading: 45, accuracy: 8.3, timestamp: NOW - 1000 } });
  });

  it('heading is optional; null and absent both mean "unknown"; 360 wraps to 0', () => {
    expect((parseRiderLocation(ok({ heading: undefined }), NOW) as any).value.heading).toBeNull();
    expect((parseRiderLocation(ok({ heading: null }), NOW) as any).value.heading).toBeNull();
    expect((parseRiderLocation(ok({ heading: 360 }), NOW) as any).value.heading).toBe(0);
    expect(reason(ok({ heading: -1 }))).toBe('heading');
    expect(reason(ok({ heading: 361 }))).toBe('heading');
    expect(reason(ok({ heading: NaN }))).toBe('heading');
    expect(reason(ok({ heading: '90' }))).toBe('heading');
  });

  it('rejects non-objects and bad ids', () => {
    for (const b of [null, undefined, 1, 'x', []]) expect(reason(b)).not.toBe('ok');
    expect(reason(ok({ orderId: 'abc' }))).toBe('orderId');
    expect(reason(ok({ orderId: 5 }))).toBe('orderId');
  });

  it('rejects out-of-range, non-numeric and null-island coordinates', () => {
    expect(reason(ok({ latitude: 90.1 }))).toBe('latitude');
    expect(reason(ok({ latitude: -90.1 }))).toBe('latitude');
    expect(reason(ok({ longitude: 180.1 }))).toBe('longitude');
    expect(reason(ok({ latitude: '11.8' }))).toBe('latitude');
    expect(reason(ok({ longitude: Infinity }))).toBe('longitude');
    expect(reason(ok({ latitude: 0, longitude: 0 }))).toBe('null_island');
    expect(reason(ok({ latitude: 0, longitude: 75 }))).toBe('ok'); // on the equator is fine
  });

  it('rejects impossible accuracy', () => {
    expect(reason(ok({ accuracy: -1 }))).toBe('accuracy');
    expect(reason(ok({ accuracy: 5001 }))).toBe('accuracy');
    expect(reason(ok({ accuracy: undefined }))).toBe('accuracy');
    expect(reason(ok({ accuracy: 0 }))).toBe('ok');
  });

  it('timestamps: stale rejected, small clock skew clamped to server time, big skew rejected', () => {
    expect(reason(ok({ timestamp: NOW - MAX_FIX_AGE_MS - 1 }))).toBe('stale');
    expect(reason(ok({ timestamp: NOW - MAX_FIX_AGE_MS }))).toBe('ok');
    expect(reason(ok({ timestamp: NOW + MAX_CLOCK_SKEW_MS + 1 }))).toBe('future');
    expect((parseRiderLocation(ok({ timestamp: NOW + 5000 }), NOW) as any).value.timestamp).toBe(NOW); // never in the future
    expect(reason(ok({ timestamp: '2026-01-01' }))).toBe('timestamp');
    expect(reason(ok({ timestamp: NaN }))).toBe('timestamp');
  });
});

describe('isTrackable', () => {
  it('is true from rider_accepted to out_for_delivery, false otherwise', () => {
    const yes = [OrderStatus.RiderAccepted, OrderStatus.PickedUp, OrderStatus.OutForDelivery];
    for (const s of Object.values(OrderStatus)) expect(isTrackable(s)).toBe(yes.includes(s));
  });
});
