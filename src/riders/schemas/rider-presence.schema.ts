import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** One row per rider: are they taking deliveries right now. Own collection so the users schema is untouched. */
@Schema({ timestamps: true, collection: 'rider_presence' })
export class RiderPresence {
  @Prop({ type: Types.ObjectId, required: true, unique: true }) riderId!: Types.ObjectId;
  @Prop({ required: true, default: false }) isOnline!: boolean;
}

export type RiderPresenceDocument = HydratedDocument<RiderPresence>;
export const RiderPresenceSchema = SchemaFactory.createForClass(RiderPresence);
