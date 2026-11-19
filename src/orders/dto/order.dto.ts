import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsMongoId,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Fulfillment, OrderStatus, PaymentStatus, Role } from '../../common/enums';
import { MAX_LINES_PER_ORDER, MAX_QTY_PER_LINE } from '../orders.constants';

/** NOTE: there is deliberately no price field anywhere in the create input. Prices come from the menu. */
export class OrderLineInputDto {
  @ApiProperty() @IsMongoId() menuItemId!: string;

  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(MAX_QTY_PER_LINE) quantity!: number;

  @ApiPropertyOptional({ type: [String], description: 'Chosen add-on option ids (from the menu item).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsMongoId({ each: true })
  optionIds?: string[];

  @ApiPropertyOptional({ example: 'Less spicy' }) @IsOptional() @IsString() @MaxLength(200) note?: string;
}

export class DeliveryAddressInputDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) line1!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) area?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) landmark?: string;
  @ApiPropertyOptional({ example: '670001' }) @IsOptional() @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' }) pincode?: string;
}

/** What the customer wants to buy and how they get it. Enough to price a cart without logging in. */
export class QuoteOrderDto {
  @ApiProperty({ type: [OrderLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES_PER_ORDER)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInputDto)
  lines!: OrderLineInputDto[];

  @ApiPropertyOptional({ enum: Fulfillment, default: Fulfillment.Delivery, description: 'Omitted = delivery.' })
  @IsOptional()
  @IsEnum(Fulfillment)
  fulfillment?: Fulfillment;
}

export class CreateOrderDto extends QuoteOrderDto {
  @ApiProperty({ enum: ['cod'], description: 'Only COD is accepted until online payment is built.' })
  @IsIn(['cod'])
  paymentMethod!: 'cod';

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) contactName!: string;

  @ApiProperty({ example: '9876500000', description: 'Indian mobile, with or without +91.' })
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'contactPhone must be a valid Indian mobile number' })
  contactPhone!: string;

  @ApiPropertyOptional({ type: DeliveryAddressInputDto, description: 'Required for delivery. Ignored for pickup.' })
  @ValidateIf((o: CreateOrderDto) => o.fulfillment !== Fulfillment.Pickup)
  @IsDefined({ message: 'deliveryAddress is required for delivery' })
  @ValidateNested()
  @Type(() => DeliveryAddressInputDto)
  deliveryAddress?: DeliveryAddressInputDto;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) customerNote?: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus }) @IsEnum(OrderStatus) status!: OrderStatus;

  @ApiPropertyOptional({ description: 'Required when status = assigned. Rejected for any other status.' })
  @IsOptional()
  @IsMongoId()
  riderId?: string;

  @ApiPropertyOptional({ description: 'Why (rejection / cancellation).' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({ description: 'Paise the rider collected. Required when a rider marks a COD order delivered, and must equal the order total. Rejected for any other status.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  cashCollectedPaise?: number;
}

/** Splits "a,b" into ["a","b"]; leaves real arrays (?x=a&x=b) alone. */
const toList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;

  @ApiPropertyOptional({ enum: OrderStatus, isArray: true, description: 'Any of these statuses. Comma-separated or repeated.' })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(9)
  @IsEnum(OrderStatus, { each: true })
  statuses?: OrderStatus[];

  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ description: 'Order number (prefix), customer name, or phone digits.', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  search?: string;

  @ApiPropertyOptional({ description: 'Created at or after (ISO 8601).' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: 'Created before (ISO 8601).' }) @IsOptional() @IsISO8601() to?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Admin only. Bypasses the state machine. The reason is mandatory and goes in the status log. */
export class OverrideOrderStatusDto {
  @ApiProperty({ enum: OrderStatus }) @IsEnum(OrderStatus) status!: OrderStatus;

  @ApiProperty({ description: 'Why the override is needed (3-200 chars). Logged.' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({ description: 'Required for assigned / picked_up / delivered when the order has no rider yet.' })
  @IsOptional()
  @IsMongoId()
  riderId?: string;
}

// ---------- output ----------

export class OrderLineOptionDto {
  @ApiProperty() optionId!: string;
  @ApiProperty() groupName!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceDeltaPaise!: number;
}

export class OrderLineDto {
  @ApiProperty() menuItemId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isVeg!: boolean;
  @ApiProperty({ description: 'Base price per unit, paise' }) unitPricePaise!: number;
  @ApiProperty({ type: [OrderLineOptionDto] }) options!: OrderLineOptionDto[];
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: '(base + options) x quantity, paise' }) lineTotalPaise!: number;
  @ApiPropertyOptional() note?: string;
}

export class StatusLogEntryDto {
  @ApiProperty({ enum: OrderStatus, nullable: true }) from!: OrderStatus | null;
  @ApiProperty({ enum: OrderStatus }) to!: OrderStatus;
  @ApiProperty({ enum: Role }) byRole!: Role;
  @ApiPropertyOptional({ description: 'Omitted for customers.' }) byUserId?: string;
  @ApiProperty({ description: 'ISO timestamp' }) at!: string;
  @ApiPropertyOptional() reason?: string;
}

export class DeliveryAddressDto {
  @ApiProperty() line1!: string;
  @ApiPropertyOptional() area?: string;
  @ApiPropertyOptional() landmark?: string;
  @ApiPropertyOptional() pincode?: string;
}

export class OrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ enum: PaymentStatus }) paymentStatus!: PaymentStatus;
  @ApiProperty({ enum: ['cod'] }) paymentMethod!: 'cod';
  @ApiProperty({ type: [OrderLineDto] }) lines!: OrderLineDto[];
  @ApiProperty({ enum: Fulfillment }) fulfillment!: Fulfillment;
  @ApiProperty({ description: 'Items only, paise' }) subtotalPaise!: number;
  @ApiProperty({ description: 'Paise. 0 for pickup or free delivery' }) deliveryFeePaise!: number;
  @ApiProperty({ description: 'subtotal + delivery fee, paise' }) totalPaise!: number;
  @ApiProperty() contactName!: string;
  @ApiProperty() contactPhone!: string;
  @ApiPropertyOptional({ type: DeliveryAddressDto, description: 'Absent for pickup orders.' }) deliveryAddress?: DeliveryAddressDto;
  @ApiPropertyOptional() customerNote?: string;
  @ApiPropertyOptional() riderId?: string;
  @ApiPropertyOptional({ description: 'Paise the rider reported collecting on delivery (COD only).' }) cashCollectedPaise?: number;
  @ApiProperty({ type: [StatusLogEntryDto] }) statusLog!: StatusLogEntryDto[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

/** Server-priced cart. This is what the customer is charged: the client never computes it. */
export class OrderQuoteDto {
  @ApiProperty({ type: [OrderLineDto] }) lines!: OrderLineDto[];
  @ApiProperty({ enum: Fulfillment }) fulfillment!: Fulfillment;
  @ApiProperty({ description: 'Items only, paise' }) subtotalPaise!: number;
  @ApiProperty({ description: 'Paise' }) deliveryFeePaise!: number;
  @ApiProperty({ description: 'subtotal + delivery fee, paise' }) totalPaise!: number;
  @ApiProperty({ description: 'Smallest accepted subtotal, paise. 0 = no minimum.' }) minOrderPaise!: number;
  @ApiProperty({ description: 'Delivery is free from this subtotal, paise. 0 = never free.' }) freeDeliveryAbovePaise!: number;
  @ApiProperty({ description: 'Largest total accepted for cash on delivery, paise.' }) maxCodPaise!: number;
}
