import { Types } from 'mongoose';
import { generateToken, hashToken, isWellFormedToken, linkState, TOKEN_LENGTH } from './tokens';

describe('generateToken', () => {
  it('is 43 URL-safe characters (256 bits)', () => {
    const t = generateToken();
    expect(t).toHaveLength(TOKEN_LENGTH);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(isWellFormedToken(t)).toBe(true);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 5000 }, generateToken));
    expect(seen.size).toBe(5000);
  });

  it('carries nothing about an order: nothing to decode, nothing that contains an id', () => {
    const id = new Types.ObjectId().toHexString();
    for (let i = 0; i < 200; i++) expect(generateToken()).not.toContain(id);
  });
});

describe('hashToken', () => {
  it('is deterministic, hex, and not the token itself', () => {
    const t = generateToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(t)).not.toContain(t);
    expect(hashToken(t)).not.toBe(hashToken(generateToken()));
  });
});

describe('isWellFormedToken', () => {
  it('rejects anything that is not a 43 char base64url string', () => {
    for (const bad of [undefined, null, 42, {}, [], '', 'short', 'x'.repeat(42), 'x'.repeat(44), `${'a'.repeat(42)}!`, `${'a'.repeat(42)} `, `{"$ne":1}`]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
    expect(isWellFormedToken('a'.repeat(43))).toBe(true);
  });
});

describe('linkState', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms);
  it('active before expiry, expired at and after it', () => {
    expect(linkState({ expiresAt: at(1) }, now)).toBe('active');
    expect(linkState({ expiresAt: at(0) }, now)).toBe('expired');
    expect(linkState({ expiresAt: at(-1) }, now)).toBe('expired');
  });
  it('revoked wins over everything', () => {
    expect(linkState({ expiresAt: at(1000), revokedAt: now }, now)).toBe('revoked');
    expect(linkState({ expiresAt: at(-1000), revokedAt: now }, now)).toBe('revoked');
  });
});
