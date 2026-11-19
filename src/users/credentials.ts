import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { CredentialType } from './user.schema';

const COST = 12;

export function assertSecretPolicy(type: CredentialType, secret: string): void {
  if (type === 'pin' && !/^\d{4,6}$/.test(secret)) {
    throw new BadRequestException('PIN must be 4 to 6 digits');
  }
  if (type === 'password' && secret.length < 8) {
    throw new BadRequestException('Password must be at least 8 characters');
  }
}

export function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, COST);
}

export function verifySecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

/** Used to burn the same time when the username doesn't exist (no user enumeration by timing). */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-secret', COST);
