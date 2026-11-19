import { Role } from '../common/enums';

/** JWT payload shape. Keep in sync with frontend expectations: `sub` + `role` only. */
export type JwtPayload = { sub: string; role: Role };

/** What `req.user` holds after authentication. */
export type AuthUser = { sub: string; role: Role };
