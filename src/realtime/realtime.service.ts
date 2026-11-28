import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { OrderStatus, Role } from '../common/enums';
import { toOrderDto } from '../orders/order.mapper';
import { OrderDocument } from '../orders/schemas/order.schema';
import { OrderDto } from '../orders/dto/order.dto';
import { toPublicLocation, toPublicTrackingOrder } from '../tracking/tracking.mapper';
import { isTrackable, RiderLocationEvent } from './location';
import { Rooms, ServerEvent } from './realtime.events';

export type OrderCreatedPayload = { order: OrderDto };
export type OrderStatusChangedPayload = { orderId: string; from: OrderStatus; to: OrderStatus; order: OrderDto };

/**
 * Publish side. OrdersService calls this; it never throws (a dead socket must not fail an order).
 * No-op until the gateway attaches the server (unit tests, boot).
 */
@Injectable()
export class RealtimeService {
  private readonly log = new Logger(RealtimeService.name);
  private server?: Server;
  /**
   * Last known rider position per active order, so a customer who opens (or refreshes) the tracking page mid-delivery
   * sees the rider at once instead of waiting for the next 5-10 s update. In memory: a restart just means the next
   * rider update refills it. With several API instances, move this to Redis alongside the Socket.IO Redis adapter.
   */
  private readonly lastLocation = new Map<string, RiderLocationEvent>();

  attach(server: Server): void {
    this.server = server;
  }

  /** Call only for orders the kitchen should see now (COD). Online orders: call after webhook confirms payment. */
  publishOrderCreated(order: OrderDocument): void {
    this.safely(() => {
      const payload: OrderCreatedPayload = { order: toOrderDto(order, Role.Kitchen) };
      this.server?.to(Rooms.kitchen).emit(ServerEvent.OrderCreated, payload);
    });
  }

  /** Remember and broadcast a validated rider position to everyone following that order (customer, and staff who joined). */
  publishRiderLocation(event: RiderLocationEvent): void {
    this.safely(() => {
      const prev = this.lastLocation.get(event.orderId);
      if (prev && prev.timestamp > event.timestamp) return; // out-of-order packet: never move the rider backwards in time
      this.lastLocation.set(event.orderId, event);
      this.server?.to(Rooms.order(event.orderId)).emit(ServerEvent.RiderLocation, event);
      // Anonymous link holders get the same fix WITHOUT the internal order id.
      this.server?.to(Rooms.tracking(event.orderId)).emit(ServerEvent.TrackingLocation, toPublicLocation(event));
    });
  }

  getLastLocation(orderId: string): RiderLocationEvent | undefined {
    return this.lastLocation.get(orderId);
  }

  publishOrderStatusChanged(order: OrderDocument, from: OrderStatus): void {
    this.safely(() => {
      // The delivery is over (or never started tracking): forget the position so nobody is shown a stale rider.
      if (!isTrackable(order.status)) this.lastLocation.delete(order.id as string);
      const base = { orderId: order.id as string, from, to: order.status };
      const staffRooms = [Rooms.kitchen, ...(order.riderId ? [Rooms.rider(order.riderId.toHexString())] : [])];
      // Staff/rider rooms get the full view (actor ids). The order room gets the customer view,
      // and `except` stops a staff socket that is also in the order room from getting a duplicate.
      this.server?.to(staffRooms).emit(ServerEvent.OrderStatusChanged, { ...base, order: toOrderDto(order, Role.Kitchen) });
      this.server
        ?.to(Rooms.order(base.orderId))
        .except(staffRooms)
        .emit(ServerEvent.OrderStatusChanged, { ...base, order: toOrderDto(order, Role.Customer) });
      // Anonymous tracking pages: the redacted snapshot only (no phone, address text, prices or ids).
      this.server?.to(Rooms.tracking(base.orderId)).emit(ServerEvent.TrackingStatus, { order: toPublicTrackingOrder(order) });
    });
  }

  /** Access withdrawn (cancelled / revoked): tell every open tracking page, then close their sockets. */
  publishTrackingRevoked(orderId: string): void {
    this.safely(() => {
      const room = Rooms.tracking(orderId);
      this.server?.to(room).emit(ServerEvent.TrackingRevoked, {});
      this.server?.in(room).disconnectSockets(true);
    });
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.log.error(`emit failed: ${(e as Error).message}`);
    }
  }
}
