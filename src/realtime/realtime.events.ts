/** Wire contract for Socket.IO. Mirror in the frontend when the realtime feature hook is built. */
export const ServerEvent = {
  OrderCreated: 'order:created',
  OrderStatusChanged: 'order:status_changed',
  AuthExpired: 'auth:expired',
} as const;

export const ClientEvent = {
  JoinOrder: 'order:join',
  LeaveOrder: 'order:leave',
} as const;

export const Rooms = {
  kitchen: 'kitchen',
  rider: (riderId: string) => `rider:${riderId}`,
  order: (orderId: string) => `order:${orderId}`,
} as const;

export const ORDER_ROOM_PREFIX = 'order:';
export const MAX_ORDER_ROOMS_PER_SOCKET = 50;

export type Ack = { ok: true } | { ok: false; error: 'invalid_order_id' | 'not_found' | 'too_many_rooms' };
