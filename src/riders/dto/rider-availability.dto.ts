import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetRiderAvailabilityDto {
  @ApiProperty({ description: 'true = taking deliveries, false = offline' }) @IsBoolean() isOnline!: boolean;
}

export class RiderAvailabilityDto {
  @ApiProperty() riderId!: string;
  @ApiProperty() isOnline!: boolean;
}
