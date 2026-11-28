import { Injectable } from '@nestjs/common';
import { OrderStatus } from '../common/enums';
import { CANCELLED_ORDER, EXPIRED_LINK, gone, INVALID_LINK, notFound, REVOKED_LINK, conflict } from './api-error';
import { ReviewTokenDto, TrackingSnapshotDto } from './dto/tracking.dto';
import { ReviewsService } from './reviews.service';
import { deliveredAtOf } from './review';
import { toPublicTrackingOrder } from './tracking.mapper';
import { TrackingTokensService } from './tracking-tokens.service';

/** What the anonymous tracking page (and its review box) calls. Everything is keyed by the token, never by an order id. */
@Injectable()
export class PublicTrackingService {
  constructor(
    private readonly access: TrackingTokensService,
    private readonly reviews: ReviewsService,
  ) {}

  async snapshot(token: string): Promise<TrackingSnapshotDto> {
    const auth = await this.access.authorizeTracking(token);
    if (!auth.ok) {
      if (auth.code === 'expired' && auth.order) {
        // The link is over, but a delivered order can still be reviewed: tell the page so it can offer the review box.
        const review = await this.reviews.stateFor(auth.order, { viaToken: true });
        throw gone('expired', EXPIRED_LINK, { reviewAvailable: review.state === 'available' });
      }
      if (auth.code === 'cancelled') throw gone('cancelled', CANCELLED_ORDER);
      if (auth.code === 'revoked') throw gone('revoked', REVOKED_LINK);
      throw notFound('invalid', INVALID_LINK); // unknown token, malformed token, missing order: all look the same
    }
    return {
      order: toPublicTrackingOrder(auth.order),
      expiresAt: auth.link.expiresAt.toISOString(),
      review: await this.reviews.stateFor(auth.order, { viaToken: true }),
    };
  }

  /**
   * Hands the page a SEPARATE review credential. Works for an expired link too (that is the point), but never for
   * one revoked for security, and only once the order really is delivered.
   */
  async issueReviewToken(token: string): Promise<ReviewTokenDto> {
    const auth = await this.access.authorizeTracking(token, { allowExpired: true });
    if (!auth.ok) {
      if (auth.code === 'cancelled') throw gone('cancelled', CANCELLED_ORDER);
      if (auth.code === 'revoked') throw gone('revoked', REVOKED_LINK);
      throw notFound('invalid', INVALID_LINK);
    }
    const state = await this.reviews.stateFor(auth.order, { viaToken: true });
    if (auth.order.status !== OrderStatus.Delivered) throw conflict('not_delivered', 'You can review an order once it has been delivered.');
    if (state.state === 'submitted') throw conflict('already_reviewed', 'This order has already been reviewed. Thank you!');
    if (state.state === 'closed') throw gone('review_closed', 'The time to review this order has passed.');

    const issued = await this.access.issueReviewToken(auth.order.id as string, deliveredAtOf(auth.order));
    if (!issued) throw gone('review_closed', 'The time to review this order has passed.');
    return { reviewToken: issued.token, expiresAt: issued.expiresAt.toISOString() };
  }
}
