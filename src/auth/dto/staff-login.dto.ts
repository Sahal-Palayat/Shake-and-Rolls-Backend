import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class StaffLoginDto {
  @ApiProperty({ example: 'kitchen1' })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9._-]+$/)
  username!: string;

  @ApiProperty({ description: 'Password or PIN', example: '4821' })
  @IsString()
  @MinLength(4)
  @MaxLength(72)
  secret!: string;
}
