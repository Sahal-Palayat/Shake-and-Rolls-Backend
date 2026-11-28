import { checkDeliveryArea, distanceMeters, loadDeliveryArea, pointInPolygon } from './delivery-area';

const shop = { lat: 11.8745, lng: 75.3704 }; // Kannur
const area = { center: shop, radiusMeters: 5000 };

describe('distanceMeters', () => {
  it('is 0 for the same point', () => expect(distanceMeters(shop, shop)).toBeCloseTo(0, 3));
  it('about 111.2 km per degree of latitude', () => {
    expect(distanceMeters({ lat: 10, lng: 76 }, { lat: 11, lng: 76 })).toBeGreaterThan(111_000);
    expect(distanceMeters({ lat: 10, lng: 76 }, { lat: 11, lng: 76 })).toBeLessThan(111_500);
  });
});

describe('checkDeliveryArea (radius)', () => {
  it('accepts the shop itself and a point 2 km away', () => {
    expect(checkDeliveryArea(shop, area).ok).toBe(true);
    expect(checkDeliveryArea({ lat: shop.lat + 0.018, lng: shop.lng }, area).ok).toBe(true);
  });
  it('rejects a point ~11 km away and reports the distance', () => {
    const r = checkDeliveryArea({ lat: shop.lat + 0.1, lng: shop.lng }, area);
    expect(r).toMatchObject({ ok: false, reason: 'outside' });
    expect(r.distanceMeters).toBeGreaterThan(10_000);
  });
  it('rejects impossible coordinates', () => {
    expect(checkDeliveryArea({ lat: 91, lng: 0 }, area)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkDeliveryArea({ lat: NaN, lng: 0 }, area)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('polygon', () => {
  const square = [
    { lat: 11.8, lng: 75.3 },
    { lat: 11.8, lng: 75.4 },
    { lat: 11.9, lng: 75.4 },
    { lat: 11.9, lng: 75.3 },
  ];
  it('inside / outside', () => {
    expect(pointInPolygon({ lat: 11.85, lng: 75.35 }, square)).toBe(true);
    expect(pointInPolygon({ lat: 11.95, lng: 75.35 }, square)).toBe(false);
  });
  it('replaces the radius when present', () => {
    const a = { center: shop, radiusMeters: 100, polygon: square };
    expect(checkDeliveryArea({ lat: 11.82, lng: 75.32 }, a).ok).toBe(true); // far from the centre, inside the polygon
    expect(checkDeliveryArea(shop, { ...a, polygon: square.map((p) => ({ lat: p.lat + 1, lng: p.lng })) }).ok).toBe(false);
  });
});

describe('loadDeliveryArea', () => {
  const env = (o: Record<string, unknown>) => (k: string) => o[k];
  it('undefined when nothing is configured', () => expect(loadDeliveryArea(env({}))).toBeUndefined());
  it('reads string env values, default radius 5 km', () => {
    expect(loadDeliveryArea(env({ RESTAURANT_LAT: '11.8745', RESTAURANT_LNG: '75.3704' }))).toEqual({ center: shop, radiusMeters: 5000 });
    expect(loadDeliveryArea(env({ RESTAURANT_LAT: 11.8745, RESTAURANT_LNG: 75.3704, DELIVERY_RADIUS_METERS: '3500' }))?.radiusMeters).toBe(3500);
  });
  it('throws when half-configured or malformed', () => {
    expect(() => loadDeliveryArea(env({ RESTAURANT_LAT: '11.8' }))).toThrow(/RESTAURANT_LAT/);
    expect(() => loadDeliveryArea(env({ RESTAURANT_LAT: '11', RESTAURANT_LNG: '75', DELIVERY_RADIUS_METERS: '-1' }))).toThrow(/RADIUS/);
    expect(() => loadDeliveryArea(env({ RESTAURANT_LAT: '11', RESTAURANT_LNG: '75', DELIVERY_AREA_POLYGON: '[[1,2]]' }))).toThrow(/POLYGON/);
  });
  it('parses a polygon as pairs or objects', () => {
    const base = { RESTAURANT_LAT: '11', RESTAURANT_LNG: '75' };
    expect(loadDeliveryArea(env({ ...base, DELIVERY_AREA_POLYGON: '[[1,2],[1,3],[2,3]]' }))?.polygon).toHaveLength(3);
    expect(loadDeliveryArea(env({ ...base, DELIVERY_AREA_POLYGON: '[{"lat":1,"lng":2},{"lat":1,"lng":3},{"lat":2,"lng":3}]' }))?.polygon).toHaveLength(3);
  });
});
