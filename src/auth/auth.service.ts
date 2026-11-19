import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../common/enums';
import { normalizePhone } from '../common/phone';
import { DUMMY_HASH, verifySecret } from '../users/credentials';
import { toUserSummary } from '../users/user.mapper';
import { UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './auth.types';
import { AuthResponseDto, OtpRequestedDto } from './dto/auth-response.dto';
import { OtpRequestDto, OtpVerifyDto } from './dto/otp.dto';
import { StaffLoginDto } from './dto/staff-login.dto';
import { OTP_TTL_SECONDS, OtpService } from './otp.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async staffLogin(dto: StaffLoginDto): Promise<AuthResponseDto> {
    const invalid = () => new UnauthorizedException('Invalid credentials');
    const user = await this.users.findStaffForLogin(dto.username);

    // Same work whether or not the user exists.
    const ok = await verifySecret(dto.secret, user?.credentialHash ?? DUMMY_HASH);
    if (!user || !user.isActive || !user.credentialHash) throw invalid();
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw invalid();
    if (!ok) {
      await this.users.recordLoginFailure(user._id);
      throw invalid();
    }

    await this.users.clearLoginFailures(user._id);
    return this.respond(user);
  }

  async requestOtp(dto: OtpRequestDto): Promise<OtpRequestedDto> {
    await this.otp.request(normalizePhone(dto.phone));
    return { expiresInSeconds: OTP_TTL_SECONDS };
  }

  async verifyOtp(dto: OtpVerifyDto): Promise<AuthResponseDto> {
    const phone = normalizePhone(dto.phone);
    await this.otp.verify(phone, dto.code);
    const user = await this.users.findOrCreateCustomer(phone);
    if (!user.isActive) throw new UnauthorizedException('Account disabled');
    return this.respond(user);
  }

  private respond(user: UserDocument): AuthResponseDto {
    const payload: JwtPayload = { sub: user.id as string, role: user.role };
    const ttl =
      user.role === Role.Customer
        ? this.config.getOrThrow<number>('CUSTOMER_JWT_TTL_SECONDS')
        : this.config.getOrThrow<number>('STAFF_JWT_TTL_SECONDS');
    const accessToken = this.jwt.sign(payload, { expiresIn: ttl, algorithm: 'HS256' });
    return { accessToken, user: toUserSummary(user) };
  }
}
