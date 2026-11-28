import { createHash, randomBytes } from 'crypto';

/**
 * Pure helpers for the public tracking / review credentials. No Nest, no DB, so they are unit tested directly.
 *
 * A token is 32 random bytes (256 bits) from the OS CSPRNG, base64url encoded: 43 URL-safe characters.
 * It carries NO information (not the order id, not a timestamp): it is only a key to look the link up.
 * Only the SHA-256 of it is stored. A plain fast hash is the right tool here: the input already has 256 bits of
 * entropy, so there is nothing to brute-force (bcrypt/argon2 are for low-entropy passwords).
 */

export const TOKEN_BYTES = 32;
export const TOKEN_LENGTH = 43; // base64url of 32 bytes, no padding
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const HASH_NAMESPACE = 'sr.access-token.v1:';

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Cheap shape check so garbage never reaches the database. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(HASH_NAMESPACE + token).digest('hex');
}

export type LinkState = 'active' | 'expired' | 'revoked';

/** Revoked beats expired: a revoked link says "no longer active" even after its time ran out. */
export function linkState(link: { expiresAt: Date; revokedAt?: Date | null }, now: Date): LinkState {
  if (link.revokedAt) return 'revoked';
  return link.expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';
}
