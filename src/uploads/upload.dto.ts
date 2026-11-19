import { ApiProperty } from '@nestjs/swagger';

export class UploadResultDto {
  @ApiProperty({ example: 'http://localhost:3000/api/uploads/3f2a....jpg', description: 'Absolute URL. Put it in a menu item\'s imageUrl.' })
  url!: string;
}
