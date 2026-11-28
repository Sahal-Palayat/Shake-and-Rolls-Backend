import { Controller, Get, Header, HttpCode, Param, Post, Body } from '@nestjs/common';
import { ApiGoneResponse, ApiNotFoundResponse, ApiOkResponse, ApiCreatedResponse, ApiConflictResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ReviewDto, ReviewTokenDto, ReviewTokenStateDto, SubmitReviewDto, TrackingErrorDto, TrackingSnapshotDto } from './dto/tracking.dto';
import { PublicTrackingService } from './public-tracking.service';
import { ReviewsService } from './reviews.service';

// The token is in the URL: keep it out of caches and out of the Referer header sent to other sites.
const NO_STORE = 'no-store';
const NO_REFERRER = 'no-referrer';

@ApiTags('tracking')
@Controller('track')
export class TrackingController {
  constructor(private readonly tracking: PublicTrackingService) {}

  /** Public on purpose: the customer opens this from a WhatsApp / SMS link and is not logged in. The token IS the credential. */
  @Public()
  @Get(':token')
  @Header('Cache-Control', NO_STORE)
  @Header('Referrer-Policy', NO_REFERRER)
  @ApiOkResponse({ type: TrackingSnapshotDto })
  @ApiNotFoundResponse({ type: TrackingErrorDto, description: 'code `invalid`: unknown or malformed link.' })
  @ApiGoneResponse({ type: TrackingErrorDto, description: 'code `expired` (24 h passed), `revoked` (switched off) or `cancelled` (order cancelled).' })
  snapshot(@Param('token') token: string): Promise<TrackingSnapshotDto> {
    return this.tracking.snapshot(token);
  }

  @Public()
  @Post(':token/review-token')
  @HttpCode(200)
  @Header('Cache-Control', NO_STORE)
  @Header('Referrer-Policy', NO_REFERRER)
  @ApiOkResponse({ type: ReviewTokenDto, description: 'A separate review credential. Works after the tracking link has expired.' })
  @ApiConflictResponse({ type: TrackingErrorDto, description: '`not_delivered` or `already_reviewed`.' })
  @ApiGoneResponse({ type: TrackingErrorDto, description: '`revoked`, `cancelled` or `review_closed`.' })
  reviewToken(@Param('token') token: string): Promise<ReviewTokenDto> {
    return this.tracking.issueReviewToken(token);
  }
}

@ApiTags('reviews')
@Controller('reviews/by-token')
export class ReviewTokenController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get(':reviewToken')
  @Header('Cache-Control', NO_STORE)
  @Header('Referrer-Policy', NO_REFERRER)
  @ApiOkResponse({ type: ReviewTokenStateDto })
  @ApiNotFoundResponse({ type: TrackingErrorDto })
  @ApiGoneResponse({ type: TrackingErrorDto })
  state(@Param('reviewToken') reviewToken: string): Promise<ReviewTokenStateDto> {
    return this.reviews.stateByToken(reviewToken);
  }

  @Public()
  @Post(':reviewToken')
  @Header('Cache-Control', NO_STORE)
  @Header('Referrer-Policy', NO_REFERRER)
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiConflictResponse({ type: TrackingErrorDto, description: '`not_delivered` or `already_reviewed` (one review per order).' })
  @ApiGoneResponse({ type: TrackingErrorDto })
  submit(@Param('reviewToken') reviewToken: string, @Body() dto: SubmitReviewDto): Promise<ReviewDto> {
    return this.reviews.submitByToken(reviewToken, dto);
  }
}
