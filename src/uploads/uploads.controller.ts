import { BadRequestException, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums';
import { UploadResultDto } from './upload.dto';
import { sniffImage } from './sniff-image';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

@ApiTags('uploads')
@Controller()
export class UploadsController {
  private readonly dir: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.dir = resolve(config.getOrThrow<string>('UPLOAD_DIR'));
    this.baseUrl = config.getOrThrow<string>('PUBLIC_BASE_URL');
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Post('admin/uploads/menu-image')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiCreatedResponse({ type: UploadResultDto, description: 'JPEG, PNG or WebP, max 2 MB. Type is checked from the file bytes, not the name.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async uploadMenuImage(@UploadedFile() file?: { buffer: Buffer }): Promise<UploadResultDto> {
    if (!file) throw new BadRequestException('Send the image as multipart field "file"');
    const ext = sniffImage(file.buffer);
    if (!ext) throw new BadRequestException('Only JPEG, PNG or WebP images are allowed');
    const name = `${randomBytes(16).toString('hex')}.${ext}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(resolve(this.dir, name), file.buffer, { flag: 'wx' });
    return { url: `${this.baseUrl}/api/uploads/${name}` };
  }

  /** Public: menu images are shown to customers. Only names this service generated are served. */
  @Public()
  @Get('uploads/:name')
  serve(@Param('name') name: string, @Res() res: Response): void {
    if (!NAME_RE.test(name)) throw new BadRequestException('Invalid file name');
    res.set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(name, { root: this.dir }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ statusCode: 404, message: 'Not found' });
    });
  }
}
