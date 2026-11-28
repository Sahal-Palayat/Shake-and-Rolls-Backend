import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { DeliveryAreaDto } from './dto/delivery-area.dto';
import { OrdersService } from './orders.service';

@ApiTags('delivery')
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly orders: OrdersService) {}

  /** Public on purpose: checkout draws the area on the map and warns before the customer submits. POST /orders still enforces it. */
  @Public()
  @Get('area')
  @ApiOkResponse({ type: DeliveryAreaDto })
  area(): DeliveryAreaDto {
    const a = this.orders.deliveryArea();
    if (!a) return { isRestricted: false };
    return { isRestricted: true, center: a.center, radiusMeters: a.radiusMeters, ...(a.polygon && { polygon: a.polygon }) };
  }
}
