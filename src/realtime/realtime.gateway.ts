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
import { Model, Types } from 'mongoose';
import type { Server, Socket } from 'socket.io';
import { Fulfillment, Role } from '../common/enums';
import { orderScope } from '../orders/order-scope';
import { MIN_LOCATION_INTERVAL_MS, parseRiderLocation, TRACKABLE_STATUSES } from './location';
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
import { toPublicLocation } from '../tracking/tracking.mapper';
import { isTrackingPrincipal, WsAuthService, WsPrincipal } from './ws-auth.service';

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

    if (isTrackingPrincipal(p)) {
      // Anonymous tracking session: the server puts it in the ONE room of the order its token belongs to.
      // The client never names a room, so a link for order A can never listen to order B.
      await socket.join(Rooms.tracking(p.orderId));
      // Late joiner (page opened or refreshed mid-delivery): hand over the last known rider position right away.
      const last = this.realtime.getLastLocation(p.orderId);
      if (last) socket.emit(ServerEvent.TrackingLocation, toPublicLocation(last));
    } else {
      // Role rooms are decided by the server from the JWT, never by the client.
      if (p.role === Role.Kitchen || p.role === Role.Admin) await socket.join(Rooms.kitchen);
      if (p.role === Role.Rider) await socket.join(Rooms.rider(p.id));
    }

    // JWT expiry applies to the open socket too. For a tracking session the same timer enforces the 24 h link expiry.
    if (p.exp) {
      const ms = Math.min(p.exp * 1000 - Date.now(), MAX_TIMER_MS);
      const event = isTrackingPrincipal(p) ? ServerEvent.TrackingExpired : ServerEvent.AuthExpired;
      const t = setTimeout(() => {
        socket.emit(event);
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
    if (isTrackingPrincipal(p)) return { ok: false, error: 'forbidden' }; // tracking sessions are placed in their room by the server

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
    // Late joiner (page opened or refreshed mid-delivery): hand over the last known rider position right away.
    const last = this.realtime.getLastLocation(orderId);
    if (last) socket.emit(ServerEvent.RiderLocation, last);
    return { ok: true };
  }

  /**
   * Rider app -> server, every 5-10 s during a delivery.
   * Checks, in order: it is a rider socket, the payload is sane, it is not flooding, and the order is THIS rider's,
   * a delivery order, and in a trackable status. Only then is it broadcast to that order's room.
   * The acks tell the rider app what to do: `not_active` = stop sending for this order.
   */
  @SubscribeMessage(ClientEvent.RiderLocation)
  async onRiderLocation(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const p = socket.data.principal as WsPrincipal | undefined;
    if (!p || isTrackingPrincipal(p) || p.role !== Role.Rider) return { ok: false, error: 'forbidden' };

    const now = Date.now();
    const parsed = parseRiderLocation(body, now);
    if (!parsed.ok) return { ok: false, error: 'invalid_payload' };
    const event = parsed.value;

    // Per socket + order; lives on socket.data so it disappears with the connection.
    const sentAt = ((socket.data.locationSentAt as Map<string, number> | undefined) ?? (socket.data.locationSentAt = new Map<string, number>()));
    const prev = sentAt.get(event.orderId);
    if (prev !== undefined && now - prev < MIN_LOCATION_INTERVAL_MS) return { ok: false, error: 'rate_limited' };

    try {
      const active = await this.orders.exists({
        _id: event.orderId,
        riderId: new Types.ObjectId(p.id),
        fulfillment: Fulfillment.Delivery,
        status: { $in: TRACKABLE_STATUSES },
      });
      if (!active) return { ok: false, error: 'not_active' };
    } catch (e) {
      this.log.error(`rider:location lookup failed: ${(e as Error).message}`);
      return { ok: false, error: 'not_active' };
    }

    sentAt.set(event.orderId, now);
    this.realtime.publishRiderLocation(event);
    return { ok: true };
  }

  @SubscribeMessage(ClientEvent.LeaveOrder)
  async onLeave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const p = socket.data.principal as WsPrincipal | undefined;
    if (p && isTrackingPrincipal(p)) return { ok: false, error: 'forbidden' };
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
