import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Fulfillment, OrderStatus, PaymentStatus, Role } from '../../common/enums';

const isInt = { validator: Number.isInteger, message: '{PATH} must be an integer' };

/** Snapshot of a chosen add-on. Menu edits/deletes never change a placed order. */
@Schema({ _id: false })
export class OrderLineOption {
  @Prop({ type: Types.ObjectId, required: true }) optionId!: Types.ObjectId;
  @Prop({ required: true }) groupName!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true, min: 0, validate: isInt }) priceDeltaPaise!: number;
}
const OrderLineOptionSchema = SchemaFactory.createForClass(OrderLineOption);

@Schema({ _id: false })
export class OrderLine {
  @Prop({ type: Types.ObjectId, required: true }) menuItemId!: Types.ObjectId;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) isVeg!: boolean;
  @Prop({ required: true, min: 0, validate: isInt }) unitPricePaise!: number; // base price only
  @Prop({ type: [OrderLineOptionSchema], default: [] }) options!: OrderLineOption[];
  @Prop({ required: true, min: 1, validate: isInt }) quantity!: number;
  @Prop({ required: true, min: 0, validate: isInt }) lineTotalPaise!: number; // (base + options) * quantity
  @Prop({ trim: true }) note?: string;
  @Prop() comboRef?: string; // groups the lines of one combo
  @Prop() comboName?: string; // snapshot
}
const OrderLineSchema = SchemaFactory.createForClass(OrderLine);

/** Snapshot of a combo discount. Combo edits/deletes never change a placed order. */
@Schema({ _id: false })
export class AppliedCombo {
  @Prop({ type: Types.ObjectId, required: true }) comboId!: Types.ObjectId;
  @Prop({ required: true }) comboRef!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true, min: 0, max: 90, validate: isInt }) discountPercent!: number;
  @Prop({ required: true, min: 1, validate: isInt }) quantity!: number;
  @Prop({ required: true, min: 0, validate: isInt }) itemsPaise!: number;
  @Prop({ required: true, min: 0, validate: isInt }) savingsPaise!: number;
}
const AppliedComboSchema = SchemaFactory.createForClass(AppliedCombo);

@Schema({ _id: false })
export class StatusLogEntry {
  @Prop({ type: String, enum: Object.values(OrderStatus), default: null }) from!: OrderStatus | null;
  @Prop({ type: String, enum: Object.values(OrderStatus), required: true }) to!: OrderStatus;
  @Prop({ type: Types.ObjectId, required: true }) byUserId!: Types.ObjectId;
  @Prop({ type: String, enum: Object.values(Role), required: true }) byRole!: Role;
  @Prop({ required: true }) at!: Date;
  @Prop({ trim: true }) reason?: string;
}
const StatusLogEntrySchema = SchemaFactory.createForClass(StatusLogEntry);

/** GeoJSON point. NOTE: coordinates are [longitude, latitude] (GeoJSON order), the reverse of how people say it. */
@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], required: true, default: 'Point' }) type!: 'Point';
  @Prop({
    type: [Number],
    required: true,
    validate: {
      validator: (c: number[]) => Array.isArray(c) && c.length === 2 && c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90,
      message: 'coordinates must be [lng, lat]',
    },
  })
  coordinates!: number[];
}
const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

@Schema({ _id: false })
export class DeliveryAddress {
  /** The exact GPS point to deliver to. Primary; the text fields below only describe it. Absent on older orders. */
  @Prop({ type: GeoPointSchema }) location?: GeoPoint;
  @Prop({ type: String, enum: ['gps', 'search', 'pin'] }) locationSource?: 'gps' | 'search' | 'pin';
  @Prop({ trim: true }) placeId?: string;
  @Prop({ trim: true }) formattedAddress?: string;
  @Prop({ trim: true }) houseName?: string;
  @Prop({ trim: true }) buildingName?: string;
  @Prop({ trim: true }) floor?: string;
  @Prop({ required: true, trim: true }) line1!: string;
  @Prop({ trim: true }) area?: string;
  @Prop({ trim: true }) landmark?: string;
  @Prop({ trim: true }) pincode?: string;
}
const DeliveryAddressSchema = SchemaFactory.createForClass(DeliveryAddress);

@Schema({ timestamps: true })
export class Order {
  /** Short human code for the kitchen / rider / customer, e.g. SR-7K4M2Q. */
  @Prop({ required: true, unique: true }) orderNumber!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true }) customerId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(OrderStatus), required: true, index: true }) status!: OrderStatus;
  @Prop({ type: String, enum: Object.values(PaymentStatus), required: true }) paymentStatus!: PaymentStatus;
  @Prop({ type: String, enum: ['cod'], required: true }) paymentMethod!: 'cod';

  @Prop({ type: [OrderLineSchema], required: true }) lines!: OrderLine[];
  @Prop({ type: String, enum: Object.values(Fulfillment), required: true, default: Fulfillment.Delivery })
  fulfillment!: Fulfillment;
  /** Items after combo savings. */
  @Prop({ required: true, min: 0, validate: isInt, default: 0 }) subtotalPaise!: number;
  @Prop({ required: true, min: 0, validate: isInt, default: 0 }) comboSavingsPaise!: number;
  @Prop({ type: [AppliedComboSchema], default: [] }) combos!: AppliedCombo[];
  @Prop({ required: true, min: 0, validate: isInt, default: 0 }) deliveryFeePaise!: number;
  @Prop({ required: true, min: 0, validate: isInt }) totalPaise!: number;

  @Prop({ required: true, trim: true }) contactName!: string;
  @Prop({ required: true }) contactPhone!: string; // +91XXXXXXXXXX
  @Prop({ type: DeliveryAddressSchema }) deliveryAddress?: DeliveryAddress; // absent for pickup
  @Prop({ trim: true }) customerNote?: string;

  @Prop({ type: Types.ObjectId, index: true }) riderId?: Types.ObjectId;

  @Prop({ type: [StatusLogEntrySchema], default: [] }) statusLog!: StatusLogEntry[];

  /** Idempotency. Unique per customer. requestHash detects the same key reused with a different body. */
  @Prop({ required: true }) idempotencyKey!: string;
  @Prop({ required: true }) requestHash!: string;
  @Prop({ required: false }) cashCollectedPaise?: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type OrderDocument = HydratedDocument<Order>;
export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });
OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ riderId: 1, status: 1 });
OrderSchema.index({ 'deliveryAddress.location': '2dsphere' }); // sparse by default: pickup and older orders have no point
