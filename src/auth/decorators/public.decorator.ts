import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Explicitly opts an endpoint out of authentication (login, OTP). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
