import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { IN_MOBILE_REGEX } from '../../common/phone';

export class OtpRequestDto {
  @ApiProperty({ example: '9876543210', description: 'Indian mobile, optional +91 prefix' })
  @IsString()
  @Matches(IN_MOBILE_REGEX, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;
}

export class OtpVerifyDto extends OtpRequestDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}
