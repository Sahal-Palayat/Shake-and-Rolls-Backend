import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Category } from '../../menu/schemas/category.schema';

const isInt = { validator: Number.isInteger, message: '{PATH} must be an integer' };

/** One "pick a ..." step of a combo. Any available item of `category` can fill it. */
@Schema()
export class ComboSlot {
  _id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  label!: string; // "Roll", "Shake", "Fries"

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Category.name, required: true })
  category!: Types.ObjectId;

  @Prop({ default: false })
  isOptional!: boolean;
}
export const ComboSlotSchema = SchemaFactory.createForClass(ComboSlot);

/**
 * A combo is a set of slots plus a percentage off. It holds no prices of its own: the items keep their menu prices
 * and the order pricing takes `discountPercent` off the combo's items. So menu price edits flow through automatically.
 */
@Schema({ timestamps: true })
export class Combo {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  description?: string;

  /** Whole percent off the combo's items (0-90). */
  @Prop({ required: true, min: 0, max: 90, validate: isInt })
  discountPercent!: number;

  @Prop({ type: [ComboSlotSchema], default: [] })
  slots!: ComboSlot[];

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ComboDocument = HydratedDocument<Combo>;
export const ComboSchema = SchemaFactory.createForClass(Combo);
ComboSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
