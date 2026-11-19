import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '../common/enums';
import { toUserSummary } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import type { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { AuthResponseDto, OtpRequestedDto, UserSummaryDto } from './dto/auth-response.dto';
import { OtpRequestDto, OtpVerifyDto } from './dto/otp.dto';
import { StaffLoginDto } from './dto/staff-login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Post('staff/login')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthResponseDto })
  staffLogin(@Body() dto: StaffLoginDto): Promise<AuthResponseDto> {
    return this.auth.staffLogin(dto);
  }

  @Public()
  @Post('customer/otp/request')
  @HttpCode(200)
  @ApiOkResponse({ type: OtpRequestedDto })
  requestOtp(@Body() dto: OtpRequestDto): Promise<OtpRequestedDto> {
    return this.auth.requestOtp(dto);
  }

  @Public()
  @Post('customer/otp/verify')
  @HttpCode(200)
  @ApiOkResponse({ type: AuthResponseDto })
  verifyOtp(@Body() dto: OtpVerifyDto): Promise<AuthResponseDto> {
    return this.auth.verifyOtp(dto);
  }

  @Roles(Role.Customer, Role.Kitchen, Role.Rider, Role.Admin)
  @ApiBearerAuth()
  @Get('me')
  @ApiOkResponse({ type: UserSummaryDto })
  async me(@CurrentUser() current: AuthUser): Promise<UserSummaryDto> {
    const user = await this.users.findActiveById(current.sub);
    return toUserSummary(user!);
  }
}
