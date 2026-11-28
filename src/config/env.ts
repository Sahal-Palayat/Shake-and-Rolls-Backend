import { loadDeliveryArea } from '../orders/delivery-area';

export type Env = {
  NODE_ENV: string;
  PORT: number;
  MONGODB_URI: string;
  JWT_SECRET: string;
  OTP_SECRET: string;
  STAFF_JWT_TTL_SECONDS: number;
  CUSTOMER_JWT_TTL_SECONDS: number;
  FRONTEND_ORIGIN: string;
  UPLOAD_DIR: string;
  PUBLIC_BASE_URL: string;
  /** Public address of the customer site, used to build tracking links. Defaults to the first FRONTEND_ORIGIN. */
  TRACKING_BASE_URL?: string;
  /** Days after delivery during which a review is accepted through a review token. */
  REVIEW_WINDOW_DAYS: number;
  DELIVERY_FEE_PAISE: number;
  FREE_DELIVERY_ABOVE_PAISE: number;
  MIN_ORDER_PAISE: number;
  /** Shop location + delivery radius. Optional in dev (no restriction); required in production. */
  RESTAURANT_LAT?: number;
  RESTAURANT_LNG?: number;
  DELIVERY_RADIUS_METERS?: number;
  /** JSON [[lat,lng],...] or [{lat,lng},...]. Replaces the radius when set. */
  DELIVERY_AREA_POLYGON?: string;
  SEED_ADMIN_USERNAME?: string;
  SEED_ADMIN_PASSWORD?: string;
};

/** Fails fast at boot if config is missing or weak. Used by ConfigModule. */
/** Validates the delivery-area settings. In production the area is mandatory: an unset area would mean "deliver anywhere". */
function deliveryAreaEnv(raw: Record<string, unknown>, errors: string[]): Partial<Env> {
  try {
    const area = loadDeliveryArea((k) => raw[k]);
    if (!area) {
      if (raw['NODE_ENV'] === 'production') errors.push('RESTAURANT_LAT and RESTAURANT_LNG are required in production (delivery service area)');
      return {};
    }
    const poly = raw['DELIVERY_AREA_POLYGON'];
    return {
      RESTAURANT_LAT: area.center.lat,
      RESTAURANT_LNG: area.center.lng,
      DELIVERY_RADIUS_METERS: area.radiusMeters,
      ...(typeof poly === 'string' && poly ? { DELIVERY_AREA_POLYGON: poly } : {}),
    };
  } catch (e) {
    errors.push((e as Error).message);
    return {};
  }
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const errors: string[] = [];
  const str = (key: string, fallback?: string): string => {
    const v = raw[key] ?? fallback;
    if (typeof v !== 'string' || v.length === 0) {
      errors.push(`${key} is required`);
      return '';
    }
    return v;
  };
  const secret = (key: string): string => {
    const v = str(key);
    if (v && v.length < 32) errors.push(`${key} must be at least 32 characters`);
    return v;
  };
  const int = (key: string, fallback: number): number => {
    const v = Number(raw[key] ?? fallback);
    if (!Number.isInteger(v) || v <= 0) errors.push(`${key} must be a positive integer`);
    return v;
  };
  /** 0 is allowed (0 = feature off / free). */
  const nonNegInt = (key: string, fallback: number): number => {
    const v = Number(raw[key] ?? fallback);
    if (!Number.isInteger(v) || v < 0) errors.push(`${key} must be a whole number of paise, 0 or more`);
    return v;
  };
  const optional = (key: string): string | undefined => {
    const v = raw[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  const env: Env = {
    NODE_ENV: str('NODE_ENV', 'development'),
    PORT: int('PORT', 3000),
    MONGODB_URI: str('MONGODB_URI'),
    JWT_SECRET: secret('JWT_SECRET'),
    OTP_SECRET: secret('OTP_SECRET'),
    STAFF_JWT_TTL_SECONDS: int('STAFF_JWT_TTL_SECONDS', 12 * 60 * 60),
    CUSTOMER_JWT_TTL_SECONDS: int('CUSTOMER_JWT_TTL_SECONDS', 30 * 24 * 60 * 60),
    FRONTEND_ORIGIN: str('FRONTEND_ORIGIN', 'http://localhost:3001'),
    UPLOAD_DIR: str('UPLOAD_DIR', './uploads'),
    PUBLIC_BASE_URL: str('PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''),
    TRACKING_BASE_URL: optional('TRACKING_BASE_URL')?.replace(/\/+$/, ''),
    REVIEW_WINDOW_DAYS: int('REVIEW_WINDOW_DAYS', 7),
    DELIVERY_FEE_PAISE: nonNegInt('DELIVERY_FEE_PAISE', 0),
    FREE_DELIVERY_ABOVE_PAISE: nonNegInt('FREE_DELIVERY_ABOVE_PAISE', 0),
    MIN_ORDER_PAISE: nonNegInt('MIN_ORDER_PAISE', 0),
    ...deliveryAreaEnv(raw, errors),
    SEED_ADMIN_USERNAME: optional('SEED_ADMIN_USERNAME'),
    SEED_ADMIN_PASSWORD: optional('SEED_ADMIN_PASSWORD'),
  };

  if (errors.length) throw new Error(`Invalid environment:\n- ${errors.join('\n- ')}`);
  return env;
}
