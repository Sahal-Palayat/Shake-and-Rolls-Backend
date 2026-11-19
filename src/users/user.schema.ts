import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Role } from '../common/enums';

export type CredentialType = 'password' | 'pin';

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, enum: Object.values(Role), index: true })
  role!: Role;

  @Prop({ trim: true })
  name?: string;

  /** Staff/rider login id. Lowercased. Not set for customers. */
  @Prop({ lowercase: true, trim: true })
  username?: string;

  /** E.164 (+91...). Customers only. */
  @Prop()
  phone?: string;

  @Prop({ select: false })
  credentialHash?: string;

  @Prop({ enum: ['password', 'pin'] })
  credentialType?: CredentialType;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ default: 0, select: false })
  failedLogins!: number;

  @Prop({ select: false })
  lockedUntil?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

// Unique only where the field is present (customers have no username, staff have no phone).
// Never write null/'' into these fields: sparse indexes still index explicit nulls.
UserSchema.index({ username: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });
