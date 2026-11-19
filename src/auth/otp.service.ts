import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Model } from 'mongoose';
import { Otp, OtpDocument } from './otp.schema';
import { SmsService } from './sms.service';

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_COOLDOWN_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(
    @InjectModel(Otp.name) private readonly otps: Model<OtpDocument>,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  async request(phone: string): Promise<void> {
    const now = new Date();
    const existing = await this.otps.findOne({ phone });
    if (existing && now.getTime() - existing.lastSentAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      throw new HttpException('Please wait before requesting another OTP', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.otps.updateOne(
      { phone },
      {
        $set: {
          codeHash: this.hash(phone, code),
          expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
          attempts: 0,
          lastSentAt: now,
        },
      },
      { upsert: true },
    );
    this.sms.sendOtp(phone, code);
  }

  /** Single use. Throws 401 with one generic message for every failure mode. */
  async verify(phone: string, code: string): Promise<void> {
    const fail = () => new UnauthorizedException('Invalid or expired OTP');

    // Atomically burn one attempt; null if missing, expired, or out of attempts.
    const doc = await this.otps.findOneAndUpdate(
      { phone, expiresAt: { $gt: new Date() }, attempts: { $lt: OTP_MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true },
    );
    if (!doc) throw fail();

    const a = Buffer.from(doc.codeHash, 'hex');
    const b = Buffer.from(this.hash(phone, code), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw fail();

    // Delete to consume; if a parallel request already consumed it, this one loses.
    const { deletedCount } = await this.otps.deleteOne({ _id: doc._id });
    if (deletedCount !== 1) throw fail();
  }

  private hash(phone: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('OTP_SECRET')).update(`${phone}:${code}`).digest('hex');
  }
}
