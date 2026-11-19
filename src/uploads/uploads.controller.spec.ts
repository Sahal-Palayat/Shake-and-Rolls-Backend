import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { UploadsController } from './uploads.controller';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

describe('UploadsController', () => {
  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sr-up-'));
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ UPLOAD_DIR: dir, PUBLIC_BASE_URL: 'http://localhost:3000' })] })],
      controllers: [UploadsController],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores a real PNG under a random name and serves it back', async () => {
    const up = await request(app.getHttpServer()).post('/api/admin/uploads/menu-image').attach('file', PNG, { filename: 'evil.html', contentType: 'text/html' }).expect(201);
    expect(up.body.url).toMatch(/^http:\/\/localhost:3000\/api\/uploads\/[a-f0-9]{32}\.png$/);
    const res = await request(app.getHttpServer()).get(new URL(up.body.url).pathname).expect(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects non-images (even when named .png), missing file, and >2MB', async () => {
    const s = request(app.getHttpServer());
    await s.post('/api/admin/uploads/menu-image').attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'a.png', contentType: 'image/png' }).expect(400);
    await s.post('/api/admin/uploads/menu-image').expect(400);
    await s.post('/api/admin/uploads/menu-image').attach('file', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), 'big.png').expect(413);
  });

  it('serves only generated names (no traversal, no guessing)', async () => {
    const s = request(app.getHttpServer());
    await s.get('/api/uploads/..%2F..%2Fetc%2Fpasswd').expect(400);
    await s.get('/api/uploads/passwd').expect(400);
    await s.get(`/api/uploads/${'a'.repeat(32)}.png`).expect(404);
  });
});
