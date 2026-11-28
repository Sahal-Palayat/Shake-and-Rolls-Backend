import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Fulfillment } from '../common/enums';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { CLOSED_FOR_TRACKING } from './tracking.mapper';
import {
  AccessTokenKind,
  DEFAULT_REVIEW_WINDOW_DAYS,
  PURGE_AFTER_EXPIRY_MS,
  RevokeReason,
  TRACKING_LINK_TTL_MS,
} from './tracking.constants';
import { OrderAccessToken, OrderAccessTokenDocument } from './schemas/access-token.schema';
import { reviewDeadline } from './review';
import { generateToken, hashToken, isWellFormedToken, linkState } from './tokens';

export type TrackingAuthFailure = 'invalid' | 'expired' | 'revoked' | 'cancelled';
export type TrackingAuth =
  | { ok: true; link: OrderAccessTokenDocument; order: OrderDocument }
  | { ok: false; code: TrackingAuthFailure; link?: OrderAccessTokenDocument; order?: OrderDocument };
export type ReviewAuth =
  | { ok: true; link: OrderAccessTokenDocument; order: OrderDocument }
  | { ok: false; code: 'invalid' | 'expired' | 'revoked' };

/**
 * The single authority on public access to an order: issues, verifies and revokes the tracking and review tokens.
 * REST (the tracking page), Socket.IO (live location) and the review endpoints all ask THIS class, so "who may see
 * what" cannot drift between them.
 */
@Injectable()
export class TrackingTokensService {
  constructor(
    @InjectModel(OrderAccessToken.name) private readonly tokens: Model<OrderAccessTokenDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly config: ConfigService,
  ) {}

  // ---------- config ----------

  reviewWindowDays(): number {
    const v = Number(this.config.get<number | string>('REVIEW_WINDOW_DAYS') ?? DEFAULT_REVIEW_WINDOW_DAYS);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_REVIEW_WINDOW_DAYS;
  }

  /** Public address of the customer site. TRACKING_BASE_URL wins; otherwise the first FRONTEND_ORIGIN. */
  urlFor(token: string): string {
    const explicit = this.config.get<string>('TRACKING_BASE_URL');
    const first = (this.config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:3001').split(',')[0];
    const base = (explicit || first).trim().replace(/\/+$/, '');
    return `${base}/track/${token}`;
  }

  // ---------- issue ----------

  /** New tracking link, valid 24 h from now. Older links stay valid until they expire or are revoked. */
  async issueTrackingLink(orderId: string, createdByUserId: string, now: Date = new Date()): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(now.getTime() + TRACKING_LINK_TTL_MS);
    await this.tokens.create({
      orderId: new Types.ObjectId(orderId),
      kind: AccessTokenKind.Tracking,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy: new Types.ObjectId(createdByUserId),
      purgeAt: new Date(expiresAt.getTime() + PURGE_AFTER_EXPIRY_MS),
    });
    return { token, expiresAt };
  }

  /**
   * New review token. It lives until the end of the review window (delivery time + REVIEW_WINDOW_DAYS), NOT 24 h,
   * so the tracking expiry never blocks a legitimate review. Any earlier unused review token for the order is retired.
   * Returns null when the window is already over.
   */
  async issueReviewToken(orderId: string, deliveredAt: Date, now: Date = new Date()): Promise<{ token: string; expiresAt: Date } | null> {
    const expiresAt = reviewDeadline(deliveredAt, this.reviewWindowDays());
    if (expiresAt.getTime() <= now.getTime()) return null;
    const oid = new Types.ObjectId(orderId);
    await this.tokens.updateMany(
      { orderId: oid, kind: AccessTokenKind.Review, revokedAt: { $exists: false } },
      { $set: { revokedAt: now, revokedReason: RevokeReason.Superseded } },
    );
    const token = generateToken();
    await this.tokens.create({
      orderId: oid,
      kind: AccessTokenKind.Review,
      tokenHash: hashToken(token),
      expiresAt,
      purgeAt: new Date(expiresAt.getTime() + PURGE_AFTER_EXPIRY_MS),
    });
    return { token, expiresAt };
  }

  // ---------- verify ----------

  /**
   * Is this token allowed to see this order's tracking right now?
   * `allowExpired` is for the review route only: an expired (but never revoked) link may still prove the holder
   * is the customer. A link revoked for security never passes, expired or not.
   */
  async authorizeTracking(token: unknown, opts: { now?: Date; allowExpired?: boolean } = {}): Promise<TrackingAuth> {
    const now = opts.now ?? new Date();
    if (!isWellFormedToken(token)) return { ok: false, code: 'invalid' };
    const link = await this.tokens.findOne({ tokenHash: hashToken(token), kind: AccessTokenKind.Tracking });
    if (!link) return { ok: false, code: 'invalid' };

    const order = await this.orders.findById(link.orderId);
    if (!order || order.fulfillment !== Fulfillment.Delivery) return { ok: false, code: 'invalid' };

    // Checked against the ORDER as well as the link: even if revoking the link had failed, a cancelled order is closed.
    if (CLOSED_FOR_TRACKING.includes(order.status)) return { ok: false, code: 'cancelled', link, order };

    const state = linkState(link, now);
    if (state === 'revoked') {
      const gone = link.revokedReason === RevokeReason.Cancelled || link.revokedReason === RevokeReason.Rejected;
      return { ok: false, code: gone ? 'cancelled' : 'revoked', link, order };
    }
    if (state === 'expired' && !opts.allowExpired) return { ok: false, code: 'expired', link, order };
    return { ok: true, link, order };
  }

  async authorizeReview(token: unknown, now: Date = new Date()): Promise<ReviewAuth> {
    if (!isWellFormedToken(token)) return { ok: false, code: 'invalid' };
    const link = await this.tokens.findOne({ tokenHash: hashToken(token), kind: AccessTokenKind.Review });
    if (!link) return { ok: false, code: 'invalid' };
    const state = linkState(link, now);
    if (state === 'revoked') return { ok: false, code: 'revoked' };
    if (state === 'expired') return { ok: false, code: 'expired' };
    const order = await this.orders.findById(link.orderId);
    if (!order) return { ok: false, code: 'invalid' };
    return { ok: true, link, order };
  }

  // ---------- revoke ----------

  /** Switches off every still-active token of this kind for the order. Returns how many were switched off. */
  async revokeAllForOrder(orderId: string, reason: RevokeReason, kinds: AccessTokenKind[] = [AccessTokenKind.Tracking], now: Date = new Date()): Promise<number> {
    const r = await this.tokens.updateMany(
      { orderId: new Types.ObjectId(orderId), kind: { $in: kinds }, revokedAt: { $exists: false } },
      { $set: { revokedAt: now, revokedReason: reason } },
    );
    return r.modifiedCount;
  }
}
