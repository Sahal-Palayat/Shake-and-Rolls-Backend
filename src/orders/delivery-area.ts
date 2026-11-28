/**
 * Delivery service area. Pure functions, no Nest, so they are trivial to test.
 *
 * The area is either a circle around the shop (RESTAURANT_LAT / RESTAURANT_LNG / DELIVERY_RADIUS_METERS)
 * or, when DELIVERY_AREA_POLYGON is set, that polygon. A polygon wins over the radius.
 * The GPS point the customer pinned is what gets checked, never the address text.
 */

export type LatLng = { lat: number; lng: number };

export type DeliveryArea = {
  center: LatLng;
  radiusMeters: number;
  /** Optional exact boundary (3+ points). When present it replaces the radius check. */
  polygon?: LatLng[];
};

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export const isValidLatLng = (p: LatLng): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

/** Great-circle distance (haversine), metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray casting. Fine for a city-sized polygon (treats lat/lng as a flat plane). */
export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const crosses = a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

export type AreaCheck = { ok: true; distanceMeters: number } | { ok: false; reason: 'invalid' | 'outside'; distanceMeters: number };

export function checkDeliveryArea(point: LatLng, area: DeliveryArea): AreaCheck {
  if (!isValidLatLng(point)) return { ok: false, reason: 'invalid', distanceMeters: NaN };
  const distance = distanceMeters(point, area.center);
  const inside = area.polygon && area.polygon.length >= 3 ? pointInPolygon(point, area.polygon) : distance <= area.radiusMeters;
  return inside ? { ok: true, distanceMeters: distance } : { ok: false, reason: 'outside', distanceMeters: distance };
}

export const DEFAULT_DELIVERY_RADIUS_METERS = 5000;

const num = (v: unknown): number => (typeof v === 'string' && v.trim() === '' ? NaN : Number(v));

function parsePolygon(raw: unknown): LatLng[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const data = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(data) || data.length < 3) throw new Error('needs at least 3 points');
  return data.map((p) => {
    const pt = Array.isArray(p) ? { lat: Number(p[0]), lng: Number(p[1]) } : { lat: Number((p as LatLng).lat), lng: Number((p as LatLng).lng) };
    if (!isValidLatLng(pt)) throw new Error('has an invalid coordinate');
    return pt;
  });
}

/**
 * Reads the area from config. `get` returns the raw value (env strings or numbers).
 * undefined = no area configured (no restriction). Throws on a half-configured or malformed area.
 */
export function loadDeliveryArea(get: (key: string) => unknown): DeliveryArea | undefined {
  const rawLat = get('RESTAURANT_LAT');
  const rawLng = get('RESTAURANT_LNG');
  const unset = (v: unknown) => v === undefined || v === null || v === '';
  if (unset(rawLat) && unset(rawLng)) return undefined;
  const center = { lat: num(rawLat), lng: num(rawLng) };
  if (!isValidLatLng(center)) throw new Error('RESTAURANT_LAT and RESTAURANT_LNG must both be valid coordinates');

  const rawRadius = get('DELIVERY_RADIUS_METERS');
  const radiusMeters = unset(rawRadius) ? DEFAULT_DELIVERY_RADIUS_METERS : num(rawRadius);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) throw new Error('DELIVERY_RADIUS_METERS must be a positive number of metres');

  let polygon: LatLng[] | undefined;
  try {
    polygon = parsePolygon(get('DELIVERY_AREA_POLYGON'));
  } catch (e) {
    throw new Error(`DELIVERY_AREA_POLYGON must be JSON like [[lat,lng],...] or [{"lat":..,"lng":..},...]: ${(e as Error).message}`);
  }
  return { center, radiusMeters, ...(polygon && { polygon }) };
}

export const formatKm = (meters: number): string => `${(meters / 1000).toFixed(1)} km`;
