import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/** SMS stub. Swap the body for a real provider later; callers don't change. */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  sendOtp(phone: string, code: string): void {
    if (process.env.NODE_ENV === 'production') {
      // Never print OTPs in production. Fail loudly until a real provider is wired.
      throw new ServiceUnavailableException('SMS provider not configured');
    }
    this.logger.log(`[SMS STUB] OTP for ${phone}: ${code}`);
  }
}
