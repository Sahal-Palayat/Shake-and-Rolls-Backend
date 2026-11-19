import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Model } from 'mongoose';
import type { Server, Socket } from 'socket.io';
import { Role } from '../common/enums';
import { orderScope } from '../orders/order-scope';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import {
  Ack,
  ClientEvent,
  MAX_ORDER_ROOMS_PER_SOCKET,
  ORDER_ROOM_PREFIX,
  Rooms,
  ServerEvent,
} from './realtime.events';
import { RealtimeService } from './realtime.service';
import { WsAuthService, WsPrincipal } from './ws-auth.service';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_TIMER_MS = 2_147_483_647;

/** Evaluated per request (after .env is loaded). CORS_ORIGINS = comma-separated. Unset: open in dev, closed in production. */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients
  const list = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return process.env.NODE_ENV !== 'production';
  return list.includes(origin);
}

@WebSocketGateway({ cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(RealtimeGateway.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly auth: WsAuthService,
    private readonly realtime: RealtimeService,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
    // Handshake auth: unauthenticated sockets never connect.
    server.use((socket, next) => {
      this.auth
        .authenticate(socket)
        .then((p) => {
          socket.data.principal = p;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const p = socket.data.principal as WsPrincipal | undefined;
    if (!p) return void socket.disconnect(true);

    // Role rooms are decided by the server from the JWT, never by the client.
    if (p.role === Role.Kitchen || p.role === Role.Admin) await socket.join(Rooms.kitchen);
    if (p.role === Role.Rider) await socket.join(Rooms.rider(p.id));

    // JWT expiry applies to the open socket too.
    if (p.exp) {
      const ms = Math.min(p.exp * 1000 - Date.now(), MAX_TIMER_MS);
      const t = setTimeout(() => {
        socket.emit(ServerEvent.AuthExpired);
        socket.disconnect(true);
      }, Math.max(ms, 0));
      t.unref();
      this.expiryTimers.set(socket.id, t);
    }
  }

  handleDisconnect(socket: Socket): void {
    const t = this.expiryTimers.get(socket.id);
    if (t) clearTimeout(t);
    this.expiryTimers.delete(socket.id);
  }

  /** Customers (and anyone else) follow a single order. Same ownership rule as GET /orders/:id. */
  @SubscribeMessage(ClientEvent.JoinOrder)
  async onJoin(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const p = socket.data.principal as WsPrincipal | undefined;
    const orderId = this.parseOrderId(body);
    if (!p || !orderId) return { ok: false, error: 'invalid_order_id' };

    const joined = [...socket.rooms].filter((r) => r.startsWith(ORDER_ROOM_PREFIX)).length;
    if (joined >= MAX_ORDER_ROOMS_PER_SOCKET) return { ok: false, error: 'too_many_rooms' };

    try {
      const visible = await this.orders.exists({ _id: orderId, ...orderScope(p) });
      if (!visible) return { ok: false, error: 'not_found' }; // same as REST: don't confirm other people's ids
    } catch (e) {
      this.log.error(`order:join lookup failed: ${(e as Error).message}`);
      return { ok: false, error: 'not_found' };
    }
    await socket.join(Rooms.order(orderId));
    return { ok: true };
  }

  @SubscribeMessage(ClientEvent.LeaveOrder)
  async onLeave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const orderId = this.parseOrderId(body);
    if (!orderId) return { ok: false, error: 'invalid_order_id' };
    await socket.leave(Rooms.order(orderId));
    return { ok: true };
  }

  private parseOrderId(body: unknown): string | null {
    const id = (body as { orderId?: unknown } | null)?.orderId;
    return typeof id === 'string' && OBJECT_ID.test(id) ? id.toLowerCase() : null;
  }
}
