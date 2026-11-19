import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserSummaryDto } from '../auth/dto/auth-response.dto';
import { Role } from '../common/enums';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { toUserSummary } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import { CreateStaffDto, SetStaffActiveDto } from './dto/create-staff.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.Admin)
@Controller('admin/staff')
export class AdminController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ApiCreatedResponse({ type: UserSummaryDto })
  async create(@Body() dto: CreateStaffDto): Promise<UserSummaryDto> {
    return toUserSummary(await this.users.createStaff(dto));
  }

  @Get()
  @ApiOkResponse({ type: [UserSummaryDto] })
  async list(): Promise<UserSummaryDto[]> {
    return (await this.users.listStaff()).map(toUserSummary);
  }

  @Patch(':id/active')
  @ApiOkResponse({ type: UserSummaryDto, description: 'Enable/disable. Not yourself, not the last active admin. Takes effect on the next request.' })
  async setActive(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SetStaffActiveDto,
  ): Promise<UserSummaryDto> {
    return toUserSummary(await this.users.setStaffActive(actor.sub, id, dto.isActive));
  }
}
