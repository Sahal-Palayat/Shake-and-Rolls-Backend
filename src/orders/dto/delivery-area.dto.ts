import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LatLngDto {
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
}

export class DeliveryAreaDto {
  @ApiProperty({ description: 'false = no area configured, delivery is not restricted.' }) isRestricted!: boolean;
  @ApiPropertyOptional({ type: LatLngDto, description: 'The shop.' }) center?: LatLngDto;
  @ApiPropertyOptional({ description: 'Delivery radius around the shop, metres. Ignored by clients when polygon is present.' }) radiusMeters?: number;
  @ApiPropertyOptional({ type: [LatLngDto], description: 'Exact boundary, when the shop set one.' }) polygon?: LatLngDto[];
}
