import { BadRequestException, ConflictException, Injectable, NotFoundException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../common/enums';
import { assertSecretPolicy, hashSecret } from './credentials';
import { CredentialType, User, UserDocument } from './user.schema';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.users.init(); // make sure indexes exist before serving traffic
    await this.seedAdmin();
  }

  async findActiveById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.users.findOne({ _id: id, isActive: true });
  }

  findStaffForLogin(username: string): Promise<UserDocument | null> {
    return this.users
      .findOne({ username: username.toLowerCase(), role: { $ne: Role.Customer } })
      .select('+credentialHash +failedLogins +lockedUntil');
  }

  /** Atomic: no duplicate customers if two verifies race. */
  async findOrCreateCustomer(phone: string): Promise<UserDocument> {
    await this.users.updateOne(
      { phone, role: Role.Customer },
      { $setOnInsert: { phone, role: Role.Customer, isActive: true } },
      { upsert: true },
    );
    return this.users.findOne({ phone, role: Role.Customer }).orFail();
  }

  listStaff(): Promise<UserDocument[]> {
    return this.users.find({ role: { $ne: Role.Customer } }).sort({ createdAt: 1 });
  }

  async createStaff(input: {
    name: string;
    username: string;
    role: Role;
    secretType: CredentialType;
    secret: string;
  }): Promise<UserDocument> {
    assertSecretPolicy(input.secretType, input.secret);
    const credentialHash = await hashSecret(input.secret);
    try {
      return await this.users.create({
        name: input.name,
        username: input.username.toLowerCase(),
        role: input.role,
        credentialType: input.secretType,
        credentialHash,
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('Username already taken');
      throw e;
    }
  }

  /** Enable/disable a staff or rider account. Never yourself, never the last active admin. */
  async setStaffActive(actorId: string, id: string, isActive: boolean): Promise<UserDocument> {
    const target = await this.users.findOne({ _id: id, role: { $ne: Role.Customer } });
    if (!target) throw new NotFoundException('Staff account not found');
    if (!isActive) {
      if (target.id === actorId) throw new BadRequestException('You cannot disable your own account');
      if (target.role === Role.Admin && (await this.users.countDocuments({ role: Role.Admin, isActive: true, _id: { $ne: target._id } })) === 0) {
        throw new BadRequestException('Cannot disable the last active admin');
      }
    }
    target.isActive = isActive;
    await target.save();
    return target;
  }

  async recordLoginFailure(id: Types.ObjectId): Promise<void> {
    await this.users.updateOne({ _id: id }, { $inc: { failedLogins: 1 } });
    const u = await this.users.findById(id).select('+failedLogins');
    if (u && u.failedLogins >= MAX_FAILED_LOGINS) {
      await this.users.updateOne(
        { _id: id },
        { $set: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), failedLogins: 0 } },
      );
    }
  }

  async clearLoginFailures(id: Types.ObjectId): Promise<void> {
    await this.users.updateOne({ _id: id }, { $set: { failedLogins: 0 }, $unset: { lockedUntil: 1 } });
  }

  private async seedAdmin(): Promise<void> {
    const username = this.config.get<string>('SEED_ADMIN_USERNAME');
    const password = this.config.get<string>('SEED_ADMIN_PASSWORD');
    if (!username || !password) return;
    if (await this.users.exists({ role: Role.Admin })) return;
    await this.createStaff({ name: 'Admin', username, role: Role.Admin, secretType: 'password', secret: password });
    this.logger.warn(`Seeded first admin "${username}". Remove SEED_ADMIN_* from the env now.`);
  }
}
