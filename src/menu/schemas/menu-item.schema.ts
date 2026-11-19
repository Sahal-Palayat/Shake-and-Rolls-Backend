import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { Category } from './category.schema';

/** Money is stored as integer paise (₹1 = 100). Same unit Razorpay uses. */
const isInt = { validator: Number.isInteger, message: '{PATH} must be an integer' };

@Schema()
export class MenuOption {
  _id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, min: 0, validate: isInt })
  priceDeltaPaise!: number;

  @Prop({ default: true })
  isAvailable!: boolean;
}
export const MenuOptionSchema = SchemaFactory.createForClass(MenuOption);

@Schema()
export class OptionGroup {
  _id!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  /** 0 = optional group. >=1 = customer must pick at least this many. */
  @Prop({ required: true, min: 0, validate: isInt })
  minSelect!: number;

  @Prop({ required: true, min: 1, validate: isInt })
  maxSelect!: number;

  @Prop({ type: [MenuOptionSchema], default: [] })
  options!: MenuOption[];
}
export const OptionGroupSchema = SchemaFactory.createForClass(OptionGroup);

@Schema({ timestamps: true })
export class MenuItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: Category.name, required: true, index: true })
  category!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true, min: 0, validate: isInt })
  pricePaise!: number;

  @Prop({ trim: true })
  imageUrl?: string;

  @Prop({ required: true })
  isVeg!: boolean;

  /** "Sold out" switch. Kitchen may flip this; nothing else on the item. */
  @Prop({ default: true })
  isAvailable!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop({ type: [OptionGroupSchema], default: [] })
  optionGroups!: OptionGroup[];

  createdAt!: Date;
  updatedAt!: Date;
}

export type MenuItemDocument = HydratedDocument<MenuItem>;
export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);
