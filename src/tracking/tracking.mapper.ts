import { OrderStatus } from '../common/enums';
import { OrderDocument } from '../orders/schemas/order.schema';
import { isTrackable } from '../realtime/location';
import { PublicTrackingOrderDto } from './dto/tracking.dto';

/**
 * The ONLY place that turns an order into what an anonymous link holder may see.
 * Whitelist style: every field is named here on purpose. A new field on Order stays private until someone adds it.
 */
export function toPublicTrackingOrder(o: OrderDocument): PublicTrackingOrderDto {
  const live = isTrackable(o.status);
  const coords = o.deliveryAddress?.location?.coordinates; // GeoJSON [lng, lat]
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    isLive: live,
    // The pin is needed for the map and ETA, so it is shown only while the rider is actually on the way.
    ...(live && coords && coords.length === 2 ? { destination: { latitude: coords[1], longitude: coords[0] } } : {}),
    items: o.lines.map((l) => ({ name: l.name, quantity: l.quantity })),
    timeline: o.statusLog.map((e) => ({ status: e.to, at: e.at.toISOString() })), // no actor ids, no reasons
  };
}

/** Rider fix for a tracking session: same numbers as RiderLocationEvent, minus the internal order id. */
export type PublicLocation = { latitude: number; longitude: number; heading: number | null; accuracy: number; timestamp: number };
export function toPublicLocation(e: PublicLocation): PublicLocation {
  return { latitude: e.latitude, longitude: e.longitude, heading: e.heading, accuracy: e.accuracy, timestamp: e.timestamp };
}

/** Orders whose tracking is over for good. */
export const CLOSED_FOR_TRACKING: readonly OrderStatus[] = [OrderStatus.Cancelled, OrderStatus.Rejected];
