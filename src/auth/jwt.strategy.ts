import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';
import { AuthUser, JwtPayload } from './auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  /**
   * Re-checks the user on every request: a deactivated account loses access immediately,
   * and the role is taken from the DB, not the token, so a role change applies at once.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findActiveById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return { sub: user.id as string, role: user.role };
  }
}
