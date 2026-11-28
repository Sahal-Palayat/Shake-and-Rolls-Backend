/** Wire contract for Socket.IO. Mirror in the frontend when the realtime feature hook is built. */
export const ServerEvent = {
  OrderCreated: 'order:created',
  OrderStatusChanged: 'order:status_changed',
  AuthExpired: 'auth:expired',
  /** Live rider position for ONE order. Sent to that order's room only. See RiderLocationEvent. */
  RiderLocation: 'order:rider_location',

  // ---- anonymous tracking sessions (customer opened /track/{token}). Payloads NEVER contain the internal order id. ----
  /** Redacted order snapshot ({ order: PublicTrackingOrderDto }) every time the order changes. */
  TrackingStatus: 'track:status',
  /** Rider position without the order id ({ latitude, longitude, heading, accuracy, timestamp }). */
  TrackingLocation: 'track:rider_location',
  /** Access was withdrawn (order cancelled, link revoked). The socket is closed right after. */
  TrackingRevoked: 'track:revoked',
  /** The 24 h link ran out while the page was open. The socket is closed right after. */
  TrackingExpired: 'track:expired',
} as const;

export const ClientEvent = {
  JoinOrder: 'order:join',
  LeaveOrder: 'order:leave',
  /** Rider app -> server, every 5-10 s while a delivery is active. Acked. See RiderLocationInput. */
  RiderLocation: 'rider:location',
} as const;

export const Rooms = {
  kitchen: 'kitchen',
  rider: (riderId: string) => `rider:${riderId}`,
  order: (orderId: string) => `order:${orderId}`,
  /** Anonymous link holders for one order. Separate from `order:` on purpose: they get redacted payloads only. */
  tracking: (orderId: string) => `tracking:${orderId}`,
} as const;

export const ORDER_ROOM_PREFIX = 'order:';
export const MAX_ORDER_ROOMS_PER_SOCKET = 50;

export type Ack =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'invalid_order_id'
        | 'not_found'
        | 'too_many_rooms'
        | 'forbidden' // not a rider socket
        | 'invalid_payload' // coordinates / timestamp failed validation
        | 'not_active' // not this rider's order, or it is not in a trackable status (finished, cancelled, not accepted yet)
        | 'rate_limited'; // faster than MIN_LOCATION_INTERVAL_MS for this order: the update was dropped
    };
