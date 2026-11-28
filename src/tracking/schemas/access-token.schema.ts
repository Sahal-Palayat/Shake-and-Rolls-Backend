import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AccessTokenKind, RevokeReason } from '../tracking.constants';

/**
 * One public credential for one order. The raw token is NEVER stored: only its hash.
 * `kind` keeps the two uses apart: a tracking token can never be used where a review token is expected, and vice versa.
 */
@Schema({ timestamps: true, collection: 'order_access_tokens' })
export class OrderAccessToken {
  @Prop({ type: Types.ObjectId, required: true }) orderId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(AccessTokenKind), required: true }) kind!: AccessTokenKind;

  /** sha256 of the token (see tokens.ts). Unique: this is the lookup key. */
  @Prop({ required: true, unique: true }) tokenHash!: string;

  @Prop({ type: Date, required: true }) expiresAt!: Date;

  /** Set = access withdrawn. Never cleared: issue a new link instead. */
  @Prop({ type: Date }) revokedAt?: Date;
  @Prop({ type: String, enum: Object.values(RevokeReason) }) revokedReason?: RevokeReason;

  /** Staff member who generated a tracking link (audit). Absent for review tokens. */
  @Prop({ type: Types.ObjectId }) createdBy?: Types.ObjectId;

  /** MongoDB deletes the document when this passes (TTL index below). Always later than expiresAt. */
  @Prop({ type: Date, required: true }) purgeAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type OrderAccessTokenDocument = HydratedDocument<OrderAccessToken>;
export const OrderAccessTokenSchema = SchemaFactory.createForClass(OrderAccessToken);

OrderAccessTokenSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
OrderAccessTokenSchema.index({ orderId: 1, kind: 1, revokedAt: 1 });
