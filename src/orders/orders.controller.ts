import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../common/enums';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './current-user.decorator';
import { CreateOrderDto, ListOrdersQueryDto, OrderDto, OrderQuoteDto, OverrideOrderStatusDto, QuoteOrderDto, UpdateOrderStatusDto } from './dto/order.dto';
import { ReviewsService } from '../tracking/reviews.service';
import { ReviewDto, ReviewStateDto, SubmitReviewDto, TrackingErrorDto, TrackingLinkDto, TrackingRevokeResultDto } from '../tracking/dto/tracking.dto';
import { toOrderDto } from './order.mapper';
import { OrdersService } from './orders.service';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly reviews: ReviewsService,
  ) {}

  /** Public on purpose: the cart prices itself before anyone logs in. Reads the menu only, writes nothing. */
  @Public()
  @Post('quote')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderQuoteDto, description: 'What this cart would cost right now, computed from the menu. Same pricing as POST /orders.' })
  quote(@Body() dto: QuoteOrderDto): Promise<OrderQuoteDto> {
    return this.orders.quote(dto);
  }

  @Roles(Role.Customer)
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8-128 chars [A-Za-z0-9_-]. Same key + same body returns the same order (200).' })
  @ApiCreatedResponse({ type: OrderDto, description: 'Created (201). A replay of the same key returns 200 with the same order.' })
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderDto> {
    if (!key || !KEY_RE.test(key)) {
      throw new BadRequestException('Idempotency-Key header is required (8-128 chars: letters, digits, _ or -)');
    }
    const { order, replayed } = await this.orders.create(user, key, dto);
    res.status(replayed ? 200 : 201);
    return toOrderDto(order, user.role);
  }

  @Roles(Role.Customer, Role.Kitchen, Role.Rider, Role.Admin)
  @Get()
  @ApiOkResponse({ type: [OrderDto], description: 'Scoped by role: customer = own, rider = assigned to them, kitchen/admin = all. Newest first.' })
  async list(@CurrentUser() user: AuthUser, @Query() q: ListOrdersQueryDto): Promise<OrderDto[]> {
    return (await this.orders.list(user, q)).map((o) => toOrderDto(o, user.role));
  }

  @Roles(Role.Customer, Role.Kitchen, Role.Rider, Role.Admin)
  @Get(':id')
  @ApiOkResponse({ type: OrderDto })
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string): Promise<OrderDto> {
    return toOrderDto(await this.orders.getVisible(user, id), user.role);
  }

  @Roles(Role.Customer, Role.Kitchen, Role.Rider, Role.Admin)
  @Patch(':id/status')
  @ApiOkResponse({ type: OrderDto, description: '409 = illegal transition, 403 = your role may not make this one.' })
  async updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderDto> {
    return toOrderDto(await this.orders.transition(user, id, dto), user.role);
  }

  @Roles(Role.Admin)
  @Patch(':id/override')
  @ApiOkResponse({ type: OrderDto, description: 'Admin only. Skips the state machine; reason required; logged as "[override] ...".' })
  async override(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: OverrideOrderStatusDto,
  ): Promise<OrderDto> {
    return toOrderDto(await this.orders.override(user, id, dto), user.role);
  }

  // ---------- customer tracking link ----------

  @Roles(Role.Kitchen, Role.Rider, Role.Admin)
  @Post(':id/tracking-link')
  @ApiCreatedResponse({ type: TrackingLinkDto, description: 'A new link, valid 24 h. The raw token is only ever in this answer: the server stores a hash. Share it with the customer.' })
  createTrackingLink(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string): Promise<TrackingLinkDto> {
    return this.orders.createTrackingLink(user, id);
  }

  @Roles(Role.Kitchen, Role.Admin)
  @Post(':id/tracking-links/revoke')
  @HttpCode(200)
  @ApiOkResponse({ type: TrackingRevokeResultDto, description: 'Security invalidation: every link of this order stops working at once and open tracking pages are closed.' })
  revokeTrackingLinks(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string): Promise<TrackingRevokeResultDto> {
    return this.orders.revokeTrackingLinks(user, id);
  }

  // ---------- review (signed-in access; the anonymous route is /reviews/by-token) ----------

  @Roles(Role.Customer, Role.Kitchen, Role.Admin)
  @Get(':id/review')
  @ApiOkResponse({ type: ReviewStateDto, description: 'Whether this order can be / has been reviewed (and the review). Same visibility as GET /orders/:id.' })
  async reviewState(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string): Promise<ReviewStateDto> {
    return this.reviews.stateFor(await this.orders.getVisible(user, id), { viaToken: false });
  }

  @Roles(Role.Customer)
  @Post(':id/review')
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiConflictResponse({ type: TrackingErrorDto, description: '`not_delivered` or `already_reviewed` (one review per order).' })
  submitReview(@CurrentUser() user: AuthUser, @Param('id', ParseObjectIdPipe) id: string, @Body() dto: SubmitReviewDto): Promise<ReviewDto> {
    return this.reviews.submitAsCustomer(user.id, id, dto);
  }
}
