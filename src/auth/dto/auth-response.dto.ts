import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../../common/enums';

export class UserSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: Role, enumName: 'Role' }) role!: Role;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional() username?: string;
  @ApiPropertyOptional() phone?: string;
  @ApiProperty() isActive!: boolean;
}

export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ type: UserSummaryDto }) user!: UserSummaryDto;
}

export class OtpRequestedDto {
  @ApiProperty({ example: 300 }) expiresInSeconds!: number;
}
