import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Shared by main.ts and the e2e tests so tests run the same pipeline as production. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const origins = app.get(ConfigService).getOrThrow<string>('FRONTEND_ORIGIN').split(',');
  app.enableCors({ origin: origins });
}

/** Swagger UI at /api/docs, OpenAPI JSON at /api/docs-json (input for openapi-typescript). */
export function setupSwagger(app: INestApplication): void {
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Shakes & Rolls API').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, doc);
}
