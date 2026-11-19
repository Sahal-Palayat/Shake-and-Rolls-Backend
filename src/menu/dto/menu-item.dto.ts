import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CategoryDto } from './category.dto';

const MAX_PRICE_PAISE = 1_000_000; // ₹10,000: sanity cap against typos (e.g. rupees sent as paise x100)

/** Input for one add-on / option. Send `id` back on update to keep its identity (orders will reference it). */
export class MenuOptionInputDto {
  @ApiPropertyOptional({ description: 'Existing option id. Omit for a new option.' })
  @IsOptional()
  @IsMongoId()
  id?: string;

  @ApiProperty({ example: 'Extra cheese' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 2000, description: 'Extra charge in paise (₹20 = 2000). 0 = free.' })
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_PAISE)
  priceDeltaPaise!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class OptionGroupInputDto {
  @ApiPropertyOptional({ description: 'Existing group id. Omit for a new group.' })
  @IsOptional()
  @IsMongoId()
  id?: string;

  @ApiProperty({ example: 'Add-ons' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 0, description: '0 = optional group; 1+ = customer must pick at least this many.' })
  @IsInt()
  @Min(0)
  @Max(30)
  minSelect!: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(30)
  maxSelect!: number;

  @ApiProperty({ type: [MenuOptionInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => MenuOptionInputDto)
  options!: MenuOptionInputDto[];
}

export class CreateMenuItemDto {
  @ApiProperty({ description: 'Category id' })
  @IsMongoId()
  categoryId!: string;

  @ApiProperty({ example: 'Paneer Tikka Wrap' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 14900, description: 'Base price in paise (₹149 = 14900)' })
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_PAISE)
  pricePaise!: number;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/paneer-wrap.jpg' })
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false }) // require_tld off: http://localhost:3000/... in dev
  @MaxLength(2048)
  imageUrl?: string;

  @ApiProperty()
  @IsBoolean()
  isVeg!: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ default: 0, description: 'Ascending. Lower shows first.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [OptionGroupInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OptionGroupInputDto)
  optionGroups?: OptionGroupInputDto[];
}

/** PATCH semantics. If `optionGroups` is sent it REPLACES the whole list (send ids to keep existing ones). */
export class UpdateMenuItemDto extends PartialType(CreateMenuItemDto) {}

/** The only thing kitchen may change. */
export class SetAvailabilityDto {
  @ApiProperty()
  @IsBoolean()
  isAvailable!: boolean;
}

export class MenuOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceDeltaPaise!: number;
  @ApiProperty() isAvailable!: boolean;
}

export class OptionGroupDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() minSelect!: number;
  @ApiProperty() maxSelect!: number;
  @ApiProperty({ type: [MenuOptionDto] }) options!: MenuOptionDto[];
}

export class MenuItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ description: 'Paise' }) pricePaise!: number;
  @ApiPropertyOptional() imageUrl?: string;
  @ApiProperty() isVeg!: boolean;
  @ApiProperty() isAvailable!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: [OptionGroupDto] }) optionGroups!: OptionGroupDto[];
}

export class MenuCategoryDto extends CategoryDto {
  @ApiProperty({ type: [MenuItemDto] }) items!: MenuItemDto[];
}
