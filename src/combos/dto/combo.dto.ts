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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MenuItemDto } from '../../menu/dto/menu-item.dto';

export const MAX_COMBO_SLOTS = 6;

export class ComboSlotInputDto {
  @ApiPropertyOptional({ description: 'Existing slot id. Omit for a new slot.' })
  @IsOptional()
  @IsMongoId()
  id?: string;

  @ApiProperty({ example: 'Roll' }) @IsString() @MinLength(1) @MaxLength(40) label!: string;

  @ApiProperty({ description: 'Any available item in this category can fill the slot.' }) @IsMongoId() categoryId!: string;

  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isOptional?: boolean;
}

export class CreateComboDto {
  @ApiProperty({ example: 'Student combo' }) @IsString() @MinLength(1) @MaxLength(60) name!: string;

  @ApiPropertyOptional({ example: 'Pick a roll, a shake and fries.' }) @IsOptional() @IsString() @MaxLength(300) description?: string;

  @ApiProperty({ example: 15, description: 'Whole percent off the combo items, 0-90.' }) @IsInt() @Min(0) @Max(90) discountPercent!: number;

  @ApiProperty({ type: [ComboSlotInputDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(MAX_COMBO_SLOTS)
  @ValidateNested({ each: true })
  @Type(() => ComboSlotInputDto)
  slots!: ComboSlotInputDto[];

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
}

export class UpdateComboDto extends PartialType(CreateComboDto) {}

// ---------- output ----------

export class ComboSlotDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty() isOptional!: boolean;
}

export class ComboDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() discountPercent!: number;
  @ApiProperty({ type: [ComboSlotDto] }) slots!: ComboSlotDto[];
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

export class PublicComboSlotDto extends ComboSlotDto {
  @ApiProperty({ type: [MenuItemDto], description: 'Available items that can fill this slot, in menu order.' }) items!: MenuItemDto[];
}

/** Customer view: only active combos whose required slots all have at least one available item. */
export class PublicComboDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() discountPercent!: number;
  @ApiProperty({ type: [PublicComboSlotDto] }) slots!: PublicComboSlotDto[];
}
