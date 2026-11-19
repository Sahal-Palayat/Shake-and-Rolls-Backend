import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Role, STAFF_ROLES } from '../../common/enums';

export class CreateStaffDto {
  @ApiProperty({ example: 'Ravi' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'kitchen1' })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username!: string;

  @ApiProperty({ enum: STAFF_ROLES, enumName: 'StaffRole' })
  @IsIn(STAFF_ROLES)
  role!: Role;

  @ApiProperty({ enum: ['password', 'pin'] })
  @IsIn(['password', 'pin'])
  secretType!: 'password' | 'pin';

  @ApiProperty({ description: 'Password (8+ chars) or PIN (4-6 digits)' })
  @IsString()
  @MaxLength(72)
  secret!: string;
}

export class SetStaffActiveDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
}
