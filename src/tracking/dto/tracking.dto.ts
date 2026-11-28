import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { OrderStatus } from '../../common/enums';
import { MAX_REVIEW_COMMENT_LENGTH } from '../tracking.constants';

/** What staff get back after generating a link. The raw token appears here ONCE and is never stored. */
export class TrackingLinkDto {
  @ApiProperty({ example: 'https://yourdomain.com/track/Zk3...' }) url!: string;
  @ApiProperty({ description: 'ISO time. The link stops showing live tracking after this (24 h after generation).' }) expiresAt!: string;
}

export class TrackingRevokeResultDto {
  @ApiProperty({ description: 'How many links were switched off.' }) revoked!: number;
}

class PublicPointDto {
  @ApiProperty() latitude!: number;
  @ApiProperty() longitude!: number;
}
class PublicItemDto {
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
}
class PublicTimelineEntryDto {
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty() at!: string;
}

/**
 * The anonymous view of an order. Deliberately small: NO internal order id, customer name / phone / address text,
 * prices, rider identity, staff ids or status-log reasons. Anyone holding the link sees exactly this.
 */
export class PublicTrackingOrderDto {
  @ApiProperty({ example: 'SR-7K4M2Q', description: 'The human code (not the database id).' }) orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiProperty({ description: 'True while the rider is on this delivery (accepted .. out for delivery): the live map is meaningful.' }) isLive!: boolean;
  @ApiPropertyOptional({ type: PublicPointDto, description: 'The delivery pin. Only present while isLive, so a finished order stops exposing the address.' }) destination?: PublicPointDto;
  @ApiProperty({ type: [PublicItemDto] }) items!: PublicItemDto[];
  @ApiProperty({ type: [PublicTimelineEntryDto] }) timeline!: PublicTimelineEntryDto[];
}

export const REVIEW_STATES = ['unavailable', 'available', 'submitted', 'closed'] as const;
export type ReviewStateName = (typeof REVIEW_STATES)[number];

export class ReviewStateDto {
  @ApiProperty({ enum: REVIEW_STATES, description: 'unavailable = not delivered yet. available = can be submitted. submitted = already reviewed. closed = review window over.' }) state!: ReviewStateName;
  @ApiPropertyOptional() rating?: number;
  @ApiPropertyOptional() comment?: string;
}

export class TrackingSnapshotDto {
  @ApiProperty({ type: PublicTrackingOrderDto }) order!: PublicTrackingOrderDto;
  @ApiProperty({ description: 'ISO time this link stops working for live tracking.' }) expiresAt!: string;
  @ApiProperty({ type: ReviewStateDto }) review!: ReviewStateDto;
}

/** Body of 404 / 410 answers from the public endpoints. `code` is what the page switches on. */
export const TRACKING_ERROR_CODES = ['invalid', 'expired', 'revoked', 'cancelled'] as const;
export type TrackingErrorCode = (typeof TRACKING_ERROR_CODES)[number];
export class TrackingErrorDto {
  @ApiProperty() statusCode!: number;
  @ApiProperty({ enum: TRACKING_ERROR_CODES }) code!: TrackingErrorCode;
  @ApiProperty({ description: 'Plain-language text, safe to show to the customer.' }) message!: string;
  @ApiPropertyOptional({ description: 'Only on `expired`: the order was delivered and can still be reviewed.' }) reviewAvailable?: boolean;
}

/** Separate credential: lets the customer leave a review after the tracking link has expired. */
export class ReviewTokenDto {
  @ApiProperty() reviewToken!: string;
  @ApiProperty({ description: 'ISO time the review token stops working (end of the review window).' }) expiresAt!: string;
}

export class ReviewTokenStateDto {
  @ApiProperty({ example: 'SR-7K4M2Q' }) orderNumber!: string;
  @ApiProperty({ type: ReviewStateDto }) review!: ReviewStateDto;
  @ApiProperty() expiresAt!: string;
}

export class SubmitReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;

  @ApiPropertyOptional({ maxLength: MAX_REVIEW_COMMENT_LENGTH, example: 'Hot and quick!' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_REVIEW_COMMENT_LENGTH * 2) // generous: normalizeComment() trims and caps; this only stops megabyte bodies
  comment?: string;
}

export class ReviewDto {
  @ApiProperty() rating!: number;
  @ApiPropertyOptional() comment?: string;
  @ApiProperty() createdAt!: string;
}
