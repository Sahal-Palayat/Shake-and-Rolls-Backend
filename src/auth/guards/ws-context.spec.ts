import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/** Regression: the global guards crashed on every Socket.IO message ("Cannot read properties of undefined (reading 'authorization')"). */
const wsContext = { getType: () => 'ws', getHandler: () => () => undefined, getClass: () => class {}, switchToHttp: () => { throw new Error('not http'); } } as unknown as ExecutionContext;

describe('global guards and Socket.IO messages', () => {
  it('JwtAuthGuard lets ws messages through untouched (handshake already authenticated them)', () => {
    expect(new JwtAuthGuard(new Reflector()).canActivate(wsContext)).toBe(true);
  });
  it('RolesGuard does not demand an HTTP role policy for ws messages', () => {
    expect(new RolesGuard(new Reflector()).canActivate(wsContext)).toBe(true);
  });
});
