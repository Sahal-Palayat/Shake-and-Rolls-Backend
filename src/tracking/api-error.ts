import { ConflictException, GoneException, HttpException, NotFoundException } from '@nestjs/common';

/** Error bodies the public pages switch on: { statusCode, code, message, ...extra }. */
function body(statusCode: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return { statusCode, code, message, ...extra };
}

export const notFound = (code: string, message: string): HttpException => new NotFoundException(body(404, code, message));
export const gone = (code: string, message: string, extra?: Record<string, unknown>): HttpException => new GoneException(body(410, code, message, extra));
export const conflict = (code: string, message: string): HttpException => new ConflictException(body(409, code, message));

export const INVALID_LINK = 'This tracking link is not valid. Please check the link you were sent.';
export const EXPIRED_LINK = 'This tracking link has expired. Tracking links work for 24 hours after they are sent.';
export const REVOKED_LINK = 'This tracking link is no longer active.';
export const CANCELLED_ORDER = 'This order was cancelled, so there is nothing to track.';
