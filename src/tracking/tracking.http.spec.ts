import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Injectable } from '@nestjs/common';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrdersController } from '../orders/orders.controller';
import { OrdersService } from '../orders/orders.service';
import { configureApp } from '../app.setup';
import { ConfigModule } from '@nestjs/config';
import { gone, notFound, conflict } from './api-error';
import { PublicTrackingService } from './public-tracking.service';
import { ReviewsService } from './reviews.service';
import { ReviewTokenController, TrackingController } from './tracking.controller';

const TOKEN = 'a'.repeat(43);

/** Stand-in for the app's JwtStrategy so the real global JwtAuthGuard can run (no token => 401). */
@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: 'test-secret' });
  }
  validate(p: unknown) {
    return p;
  }
}

describe('public tracking + review HTTP surface', () => {
  let app: INestApplication;
  const publicSvc = { snapshot: jest.fn(), issueReviewToken: jest.fn() };
  const reviews = { stateByToken: jest.fn(), submitByToken: jest.fn(), stateFor: jest.fn(), submitAsCustomer: jest.fn() };
  const orders = { createTrackingLink: jest.fn(), revokeTrackingLinks: jest.fn(), getVisible: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ FRONTEND_ORIGIN: 'http://localhost:3001' })] }), PassportModule],
      controllers: [TrackingController, ReviewTokenController, OrdersController],
      providers: [
        TestJwtStrategy,
        { provide: PublicTrackingService, useValue: publicSvc },
        { provide: ReviewsService, useValue: reviews },
        { provide: OrdersService, useValue: orders },
        // the same global guards the real app uses: a route without @Public needs a token AND a role
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('GET /api/track/:token needs no login and is never cached or leaked through Referer', async () => {
    publicSvc.snapshot.mockResolvedValue({ order: { orderNumber: 'SR-1' }, expiresAt: 'x', review: { state: 'unavailable' } });
    const r = await request(app.getHttpServer()).get(`/api/track/${TOKEN}`).expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(publicSvc.snapshot).toHaveBeenCalledWith(TOKEN);
  });

  it('expired answers 410 with a body the page can switch on', async () => {
    publicSvc.snapshot.mockRejectedValue(gone('expired', 'This tracking link has expired.', { reviewAvailable: true }));
    const r = await request(app.getHttpServer()).get(`/api/track/${TOKEN}`).expect(410);
    expect(r.body).toEqual({ statusCode: 410, code: 'expired', message: 'This tracking link has expired.', reviewAvailable: true });
  });

  it('invalid answers 404 `invalid`', async () => {
    publicSvc.snapshot.mockRejectedValue(notFound('invalid', 'nope'));
    const r = await request(app.getHttpServer()).get('/api/track/garbage').expect(404);
    expect(r.body).toMatchObject({ code: 'invalid' });
  });

  it('POST /api/track/:token/review-token is public and not cached', async () => {
    publicSvc.issueReviewToken.mockResolvedValue({ reviewToken: 'R', expiresAt: 'x' });
    const r = await request(app.getHttpServer()).post(`/api/track/${TOKEN}/review-token`).expect(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toEqual({ reviewToken: 'R', expiresAt: 'x' });
  });

  it('POST /api/reviews/by-token/:t validates the body (stars 1-5, no extra fields)', async () => {
    reviews.submitByToken.mockResolvedValue({ rating: 5, createdAt: 'x' });
    const url = `/api/reviews/by-token/${TOKEN}`;
    await request(app.getHttpServer()).post(url).send({ rating: 5, comment: 'yum' }).expect(201);
    expect(reviews.submitByToken).toHaveBeenCalledWith(TOKEN, { rating: 5, comment: 'yum' });
    reviews.submitByToken.mockClear();
    for (const body of [{}, { rating: 0 }, { rating: 9 }, { rating: 2.5 }, { rating: 5, orderId: 'abc' }]) {
      await request(app.getHttpServer()).post(url).send(body).expect(400);
    }
    expect(reviews.submitByToken).not.toHaveBeenCalled();
  });

  it('a duplicate review is a 409 `already_reviewed`', async () => {
    reviews.submitByToken.mockRejectedValue(conflict('already_reviewed', 'done'));
    const r = await request(app.getHttpServer()).post(`/api/reviews/by-token/${TOKEN}`).send({ rating: 5 }).expect(409);
    expect(r.body.code).toBe('already_reviewed');
  });

  it('the staff endpoints are NOT public: no token = 401', async () => {
    const id = '507f1f77bcf86cd799439011';
    await request(app.getHttpServer()).post(`/api/orders/${id}/tracking-link`).expect(401);
    await request(app.getHttpServer()).post(`/api/orders/${id}/tracking-links/revoke`).expect(401);
    await request(app.getHttpServer()).post(`/api/orders/${id}/review`).send({ rating: 5 }).expect(401);
    await request(app.getHttpServer()).get(`/api/orders/${id}/review`).expect(401);
    expect(orders.createTrackingLink).not.toHaveBeenCalled();
  });

  it('the OpenAPI document builds with the new routes', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('t').build());
    for (const p of ['/api/track/{token}', '/api/track/{token}/review-token', '/api/reviews/by-token/{reviewToken}', '/api/orders/{id}/tracking-link', '/api/orders/{id}/tracking-links/revoke', '/api/orders/{id}/review']) {
      expect(doc.paths).toHaveProperty([p]);
    }
    expect(Object.keys(doc.components!.schemas!)).toEqual(expect.arrayContaining(['TrackingSnapshotDto', 'PublicTrackingOrderDto', 'TrackingLinkDto', 'SubmitReviewDto', 'ReviewDto', 'ReviewStateDto', 'TrackingErrorDto']));
  });
});
