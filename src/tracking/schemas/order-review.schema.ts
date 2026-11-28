import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const REVIEW_CHANNELS = ['review_token', 'customer'] as const;
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number];

/** One review per order. The UNIQUE index on orderId is what makes duplicate submissions impossible, even under a race. */
@Schema({ timestamps: true, collection: 'order_reviews' })
export class OrderReview {
  @Prop({ type: Types.ObjectId, required: true, unique: true }) orderId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) customerId!: Types.ObjectId;
  /** Snapshot of who delivered it, so ratings can be read per rider later. */
  @Prop({ type: Types.ObjectId, index: true }) riderId?: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5, validate: { validator: Number.isInteger, message: 'rating must be a whole number' } }) rating!: number;
  @Prop({ trim: true, maxlength: 500 }) comment?: string;

  /** How the customer proved it was theirs. */
  @Prop({ type: String, enum: REVIEW_CHANNELS, required: true }) submittedVia!: ReviewChannel;

  createdAt!: Date;
  updatedAt!: Date;
}

export type OrderReviewDocument = HydratedDocument<OrderReview>;
export const OrderReviewSchema = SchemaFactory.createForClass(OrderReview);
