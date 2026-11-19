import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { Role } from '../common/enums';

export type WsPrincipal = { id: string; role: Role; exp?: number };

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ROLES = new Set<string>(Object.values(Role));

/**
 * The ONLY place that knows how a socket proves who it is.
 * Same JWT as REST (`sub`, `role`). Token comes from handshake `auth.token` or an
 * `Authorization: Bearer` header (Node clients). Never from the query string (ends up in logs).
 */
@Injectable()
export class WsAuthService {
  constructor(private readonly jwt: JwtService) {}

  async authenticate(socket: Socket): Promise<WsPrincipal> {
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
