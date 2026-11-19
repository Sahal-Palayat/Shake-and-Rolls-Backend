import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { OrderStatus, Role } from '../common/enums';
import { toOrderDto } from '../orders/order.mapper';
import { OrderDocument } from '../orders/schemas/order.schema';
import { OrderDto } from '../orders/dto/order.dto';
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

  publishOrderStatusChanged(order: OrderDocument, from: OrderStatus): void {
    this.safely(() => {
      const base = { orderId: order.id as string, from, to: order.status };
      const staffRooms = [Rooms.kitchen, ...(order.riderId ? [Rooms.rider(order.riderId.toHexString())] : [])];
      // Staff/rider rooms get the full view (actor ids). The order room gets the customer view,
      // and `except` stops a staff socket that is also in the order room from getting a duplicate.
      this.server?.to(staffRooms).emit(ServerEvent.OrderStatusChanged, { ...base, order: toOrderDto(order, Role.Kitchen) });
      this.server
        ?.to(Rooms.order(base.orderId))
        .except(staffRooms)
        .emit(ServerEvent.OrderStatusChanged, { ...base, order: toOrderDto(order, Role.Customer) });
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
