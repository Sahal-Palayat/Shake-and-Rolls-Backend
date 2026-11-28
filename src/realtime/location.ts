import { OrderStatus } from '../common/enums';

/**
 * Live rider tracking: the rules, with no Nest and no DB so they can be unit tested directly.
 *
 * Wire contract (mirror: frontend/features/kitchen/events.ts, frontend/features/tracking/tracking.ts):
 *   rider app  --'rider:location'-->  server   RiderLocationInput  (acked)
 *   server  --'order:rider_location'-->  order room   RiderLocationEvent
 */

/**
 * A rider's position is accepted and shown to the customer only in these statuses:
 * from the moment the rider accepts the delivery until the order is closed.
 * Everything else (still in the kitchen, only assigned, delivered, cancelled) is rejected with `not_active`.
 */
export const TRACKABLE_STATUSES: readonly OrderStatus[] = [OrderStatus.RiderAccepted, OrderStatus.PickedUp, OrderStatus.OutForDelivery];

export const isTrackable = (status: OrderStatus): boolean => TRACKABLE_STATUSES.includes(status);

/** The rider app sends every 5-10 s. Anything faster than this per order is dropped (a buggy or abusive client). */
export const MIN_LOCATION_INTERVAL_MS = 2_000;
/** A fix older than this is not worth showing. */
export const MAX_FIX_AGE_MS = 5 * 60_000;
/** Phone clocks drift. Up to this far ahead is accepted and clamped to server time. */
export const MAX_CLOCK_SKEW_MS = 30_000;
/** Beyond this the fix is too vague to put on a map (cell-tower fallback). */
export const MAX_ACCURACY_M = 5_000;

/** Rider -> server. */
export type RiderLocationInput = {
  orderId: string;
  latitude: number;
  longitude: number;
  /** Degrees clockwise from true north. null/absent when the device cannot tell (standing still, no compass). */
  heading?: number | null;
  /** Metres (1-sigma radius reported by the device). */
  accuracy: number;
  /** When the device took the fix, epoch milliseconds. */
  timestamp: number;
};

/** Server -> customer's order room. `timestamp` is the fix time (epoch ms), never in the future. */
export type RiderLocationEvent = {
  orderId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  accuracy: number;
  timestamp: number;
};

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export type ParsedLocation = { ok: true; value: RiderLocationEvent } | { ok: false; reason: string };

/** Validates untrusted socket input and returns a clean event. Never trusts types, ranges or the client clock. */
export function parseRiderLocation(body: unknown, nowMs: number): ParsedLocation {
  if (typeof body !== 'object' || body === null) return { ok: false, reason: 'body' };
  const b = body as Record<string, unknown>;

  if (typeof b.orderId !== 'string' || !OBJECT_ID.test(b.orderId)) return { ok: false, reason: 'orderId' };
  if (!isNum(b.latitude) || b.latitude < -90 || b.latitude > 90) return { ok: false, reason: 'latitude' };
  if (!isNum(b.longitude) || b.longitude < -180 || b.longitude > 180) return { ok: false, reason: 'longitude' };
  // (0,0) is what a broken GPS reports; nobody delivers from the Gulf of Guinea.
  if (b.latitude === 0 && b.longitude === 0) return { ok: false, reason: 'null_island' };
  if (!isNum(b.accuracy) || b.accuracy < 0 || b.accuracy > MAX_ACCURACY_M) return { ok: false, reason: 'accuracy' };
  if (!isNum(b.timestamp)) return { ok: false, reason: 'timestamp' };
  if (b.timestamp < nowMs - MAX_FIX_AGE_MS) return { ok: false, reason: 'stale' };
  if (b.timestamp > nowMs + MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'future' };

  let heading: number | null = null;
  if (b.heading !== undefined && b.heading !== null) {
    if (!isNum(b.heading) || b.heading < 0 || b.heading > 360) return { ok: false, reason: 'heading' };
    heading = b.heading === 360 ? 0 : b.heading;
  }

  return {
    ok: true,
    value: {
      orderId: b.orderId.toLowerCase(),
      latitude: b.latitude,
      longitude: b.longitude,
      heading,
      accuracy: Math.round(b.accuracy * 10) / 10,
      timestamp: Math.min(Math.round(b.timestamp), nowMs),
    },
  };
}
