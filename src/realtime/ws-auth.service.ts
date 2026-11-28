import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { Role } from '../common/enums';
import { TrackingTokensService } from '../tracking/tracking-tokens.service';
import { hashToken } from '../tracking/tokens';

/** A signed-in user (customer, kitchen, rider, admin). */
export type UserPrincipal = { kind?: 'user'; id: string; role: Role; exp?: number };
/** An anonymous customer who opened a tracking link. Can follow exactly ONE order, read-only. */
export type TrackingPrincipal = { kind: 'tracking'; orderId: string; tokenHash: string; exp: number };
export type WsPrincipal = UserPrincipal | TrackingPrincipal;

export const isTrackingPrincipal = (p: WsPrincipal): p is TrackingPrincipal => p.kind === 'tracking';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ROLES = new Set<string>(Object.values(Role));

/**
 * The ONLY place that knows how a socket proves who it is. Two ways in:
 *  - staff / customers: the same JWT as REST (`sub`, `role`), from handshake `auth.token` or an `Authorization: Bearer` header.
 *  - anonymous customers: handshake `auth.trackingToken`, checked against the stored hash, expiry, revocation and order status.
 * Never from the query string (ends up in logs).
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly tracking: TrackingTokensService,
  ) {}

  async authenticate(socket: Socket): Promise<WsPrincipal> {
    const trackingToken = (socket.handshake.auth as { trackingToken?: unknown } | undefined)?.trackingToken;
    if (trackingToken !== undefined) return this.authenticateTracking(trackingToken);
    return this.authenticateUser(socket);
  }

  private async authenticateTracking(token: unknown): Promise<TrackingPrincipal> {
    const auth = await this.tracking.authorizeTracking(token);
    if (!auth.ok) throw new Error(`tracking ${auth.code}`);
    return {
      kind: 'tracking',
      orderId: auth.order.id as string,
      tokenHash: hashToken(token as string),
      exp: Math.floor(auth.link.expiresAt.getTime() / 1000),
    };
  }

  private async authenticateUser(socket: Socket): Promise<UserPrincipal> {
    const token = this.extractToken(socket);
    if (!token) throw new Error('missing token');
    const p = await this.jwt.verifyAsync<{ sub?: unknown; role?: unknown; exp?: unknown }>(token);
    if (typeof p.sub !== 'string' || !OBJECT_ID.test(p.sub)) throw new Error('bad sub');
    if (typeof p.role !== 'string' || !ROLES.has(p.role)) throw new Error('bad role');
    return { id: p.sub, role: p.role as Role, exp: typeof p.exp === 'number' ? p.exp : undefined };
  }

  private extractToken(socket: Socket): string | null {
    const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const raw = typeof fromAuth === 'string' ? fromAuth : socket.handshake.headers.authorization;
    if (typeof raw !== 'string') return null;
    const t = raw.replace(/^Bearer\s+/i, '').trim();
    return t || null;
  }
}
