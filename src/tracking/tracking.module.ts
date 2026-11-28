import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { PublicTrackingService } from './public-tracking.service';
import { ReviewsService } from './reviews.service';
import { OrderAccessToken, OrderAccessTokenSchema } from './schemas/access-token.schema';
import { OrderReview, OrderReviewSchema } from './schemas/order-review.schema';
import { ReviewTokenController, TrackingController } from './tracking.controller';
import { TrackingTokensService } from './tracking-tokens.service';

/**
 * Public (token) access to one order: the tracking link and the review. Depends on no other feature module, so
 * Orders and Realtime can both import it without a cycle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderAccessToken.name, schema: OrderAccessTokenSchema },
      { name: OrderReview.name, schema: OrderReviewSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [TrackingController, ReviewTokenController],
  providers: [TrackingTokensService, ReviewsService, PublicTrackingService],
  exports: [TrackingTokensService, ReviewsService],
})
export class TrackingModule {}
