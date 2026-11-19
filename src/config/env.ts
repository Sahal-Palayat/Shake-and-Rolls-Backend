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
  DELIVERY_FEE_PAISE: number;
  FREE_DELIVERY_ABOVE_PAISE: number;
  MIN_ORDER_PAISE: number;
  SEED_ADMIN_USERNAME?: string;
  SEED_ADMIN_PASSWORD?: string;
};

/** Fails fast at boot if config is missing or weak. Used by ConfigModule. */
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
    DELIVERY_FEE_PAISE: nonNegInt('DELIVERY_FEE_PAISE', 0),
    FREE_DELIVERY_ABOVE_PAISE: nonNegInt('FREE_DELIVERY_ABOVE_PAISE', 0),
    MIN_ORDER_PAISE: nonNegInt('MIN_ORDER_PAISE', 0),
    SEED_ADMIN_USERNAME: optional('SEED_ADMIN_USERNAME'),
    SEED_ADMIN_PASSWORD: optional('SEED_ADMIN_PASSWORD'),
  };

  if (errors.length) throw new Error(`Invalid environment:\n- ${errors.join('\n- ')}`);
  return env;
}
