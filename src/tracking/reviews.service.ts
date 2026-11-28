import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Fulfillment, OrderStatus } from '../common/enums';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { conflict, gone, notFound } from './api-error';
import { ReviewDto, ReviewStateDto, ReviewTokenStateDto, SubmitReviewDto } from './dto/tracking.dto';
import { OrderReview, OrderReviewDocument, ReviewChannel } from './schemas/order-review.schema';
import { deliveredAtOf, normalizeComment, reviewDeadline } from './review';
import { TrackingTokensService } from './tracking-tokens.service';

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export const toReviewDto = (r: Pick<OrderReviewDocument, 'rating' | 'comment' | 'createdAt'>): ReviewDto => ({
  rating: r.rating,
  ...(r.comment ? { comment: r.comment } : {}),
  createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class ReviewsService {
  private readonly log = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(OrderReview.name) private readonly reviews: Model<OrderReviewDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly access: TrackingTokensService,
  ) {}

  /** A review is only ever accepted for a delivery order that has really been delivered. */
  private static isReviewable(o: Pick<OrderDocument, 'status' | 'fulfillment'>): boolean {
    return o.status === OrderStatus.Delivered && o.fulfillment === Fulfillment.Delivery;
  }

  /** What the review box should show for this order right now. `viaToken` = the anonymous route, which has a deadline. */
  async stateFor(order: OrderDocument, opts: { viaToken: boolean; now?: Date }): Promise<ReviewStateDto> {
    if (!ReviewsService.isReviewable(order)) return { state: 'unavailable' };
    const existing = await this.reviews.findOne({ orderId: order._id });
    if (existing) return { state: 'submitted', rating: existing.rating, ...(existing.comment ? { comment: existing.comment } : {}) };
    if (opts.viaToken) {
      const now = opts.now ?? new Date();
      if (reviewDeadline(deliveredAtOf(order), this.access.reviewWindowDays()).getTime() <= now.getTime()) return { state: 'closed' };
    }
    return { state: 'available' };
  }

  // ---------- review token (anonymous) ----------

  async stateByToken(reviewToken: string): Promise<ReviewTokenStateDto> {
    const auth = await this.access.authorizeReview(reviewToken);
    if (!auth.ok) throw this.denied(auth.code);
    return {
      orderNumber: auth.order.orderNumber,
      review: await this.stateFor(auth.order, { viaToken: true }),
      expiresAt: auth.link.expiresAt.toISOString(),
    };
  }

  async submitByToken(reviewToken: string, dto: SubmitReviewDto): Promise<ReviewDto> {
    const auth = await this.access.authorizeReview(reviewToken);
    if (!auth.ok) throw this.denied(auth.code);
    // Re-read the order's CURRENT status: the token only proves who is asking, never that the order is delivered.
    const fresh = await this.orders.findById(auth.order._id);
    if (!fresh) throw notFound('invalid', 'Order not found');
    return this.create(fresh, dto, 'review_token');
  }

  // ---------- signed-in customer ----------

  /** The customer's own order only (404 otherwise, like every other order read). */
  async submitAsCustomer(customerId: string, orderId: string, dto: SubmitReviewDto): Promise<ReviewDto> {
    const order = await this.orders.findOne({ _id: orderId, customerId: new Types.ObjectId(customerId) });
    if (!order) throw new NotFoundException('Order not found');
    return this.create(order, dto, 'customer');
  }

  async getForOrder(orderId: string): Promise<ReviewDto | null> {
    const r = await this.reviews.findOne({ orderId: new Types.ObjectId(orderId) });
    return r ? toReviewDto(r) : null;
  }

  // ---------- shared ----------

  private async create(order: OrderDocument, dto: SubmitReviewDto, via: ReviewChannel): Promise<ReviewDto> {
    if (!ReviewsService.isReviewable(order)) throw conflict('not_delivered', 'You can review an order once it has been delivered.');
    if (await this.reviews.exists({ orderId: order._id })) throw conflict('already_reviewed', 'This order has already been reviewed. Thank you!');
    try {
      const doc = await this.reviews.create({
        orderId: order._id,
        customerId: order.customerId,
        ...(order.riderId ? { riderId: order.riderId } : {}),
        rating: dto.rating,
        comment: normalizeComment(dto.comment),
        submittedVia: via,
      });
      return toReviewDto(doc);
    } catch (e) {
      // Two submissions raced past the check above: the unique index on orderId lets exactly one through.
      if (isDuplicateKey(e)) throw conflict('already_reviewed', 'This order has already been reviewed. Thank you!');
      this.log.error(`review create failed: ${(e as Error).message}`);
      throw e;
    }
  }

  private denied(code: 'invalid' | 'expired' | 'revoked') {
    if (code === 'expired') return gone('expired', 'This review link has expired.');
    if (code === 'revoked') return gone('revoked', 'This review link is no longer active.');
    return notFound('invalid', 'This review link is not valid.');
  }
}
