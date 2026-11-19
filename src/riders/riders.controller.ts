import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums';
import { CurrentUser } from '../orders/current-user.decorator';
import type { AuthUser } from '../orders/current-user.decorator';
import { RiderAvailabilityDto, SetRiderAvailabilityDto } from './dto/rider-availability.dto';
import { RidersService } from './riders.service';

@ApiTags('riders')
@ApiBearerAuth()
@Controller('riders')
export class RidersController {
  constructor(private readonly riders: RidersService) {}

  @Roles(Role.Rider)
  @Get('me/availability')
  @ApiOkResponse({ type: RiderAvailabilityDto })
  mine(@CurrentUser() user: AuthUser): Promise<RiderAvailabilityDto> {
    return this.riders.get(user.id);
  }

  @Roles(Role.Rider)
  @Put('me/availability')
  @ApiOkResponse({ type: RiderAvailabilityDto, description: 'Online/offline toggle. Going offline does not take away orders already assigned.' })
  setMine(@CurrentUser() user: AuthUser, @Body() dto: SetRiderAvailabilityDto): Promise<RiderAvailabilityDto> {
    return this.riders.set(user.id, dto.isOnline);
  }

  @Roles(Role.Admin, Role.Kitchen)
  @Get('online')
  @ApiOkResponse({ type: [RiderAvailabilityDto], description: 'Riders who are currently online.' })
  online(): Promise<RiderAvailabilityDto[]> {
    return this.riders.listOnline();
  }
}
