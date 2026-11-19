import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Role } from '../common/enums';

export type AuthUser = { id: string; role: Role };

/**
 * ASSUMPTION: the JWT strategy puts the token's `sub` and `role` on req.user.
 * If your auth module already has a @CurrentUser(), delete this file and import that one.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const u = ctx.switchToHttp().getRequest<{ user?: { sub?: string; userId?: string; id?: string; role?: Role } }>().user;
  const id = u?.sub ?? u?.userId ?? u?.id;
  if (!u || !id || !u.role) throw new UnauthorizedException();
  return { id, role: u.role };
});
