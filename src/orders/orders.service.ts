import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomInt } from 'crypto';
import { Model, Types } from 'mongoose';
import { Fulfillment, OrderStatus, PaymentStatus, Role } from '../common/enums';
import { MenuService } from '../menu/menu.service';
import { MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { RealtimeService } from '../realtime/realtime.service';
import { UsersService } from '../users/users.service';
import { AuthUser } from './current-user.decorator';
import { CreateOrderDto, ListOrdersQueryDto, OrderQuoteDto, OverrideOrderStatusDto, QuoteOrderDto, UpdateOrderStatusDto } from './dto/order.dto';
import { deliveryFeeFor, FeeConfig, loadFeeConfig } from './fees';
import { checkCashCollected, formatRupees } from './cash';
import { canRoleTransition, isLegalTransition } from './order-state-machine';
import { orderScope } from './order-scope';
import { DEFAULT_MAX_COD_PAISE } from './orders.constants';
import { priceLines } from './pricing';
import { Order, OrderDocument, StatusLogEntry } from './schemas/order.schema';

const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const ORDER_NUMBER_TRIES = 5;

function dupKeyOn(err: unknown, field: string): boolean {
  if (typeof err !== 'object' || err === null || (err as { code?: number }).code !== 11000) return false;
  const e = err as { keyPattern?: Record<string, unknown>; message?: string };
  return e.keyPattern ? field in e.keyPattern : (e.message ?? '').includes(field);
}

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function newOrderNumber(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ORDER_NUMBER_ALPHABET[randomInt(ORDER_NUMBER_ALPHABET.length)];
  return `SR-${s}`;
}

function normalizePhone(p: string): string {
  return p.startsWith('+91') ? p : `+91${p}`;
}

/** Canonical fingerprint of what the client asked for (never of server-computed prices). */
function fingerprint(dto: CreateOrderDto, phone: string): string {
  const canon = {
    lines: dto.lines.map((l) => ({
      m: l.menuItemId,
      q: l.quantity,
      o: [...(l.optionIds ?? [])].sort(),
      n: l.note?.trim() || null,
    })),
    pm: dto.paymentMethod,
    f: dto.fulfillment ?? Fulfillment.Delivery,
    cn: dto.contactName.trim(),
    cp: phone,
    a:
      dto.fulfillment === Fulfillment.Pickup || !dto.deliveryAddress
        ? null
        : {
            l1: dto.deliveryAddress.line1.trim(),
            ar: dto.deliveryAddress.area?.trim() || null,
            lm: dto.deliveryAddress.landmark?.trim() || null,
            pc: dto.deliveryAddress.pincode ?? null,
          },
    cnote: dto.customerNote?.trim() || null,
  };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

@Injectable()
export class OrdersService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly menu: MenuService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly users: UsersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.orders.init(); // the unique idempotency index must exist before traffic
  }

  // ---------- quote ----------

  private feeConfig(): FeeConfig {
    // Number(): values that only exist in process.env arrive as strings.
    return loadFeeConfig((k) => {
      const v = this.config.get<number | string>(k);
      return v === undefined || v === '' ? undefined : Number(v);
    });
  }

  private maxCodPaise(): number {
    return Number(this.config.get<number | string>('MAX_COD_PAISE') ?? DEFAULT_MAX_COD_PAISE);
  }

  private async priceCart(dto: QuoteOrderDto) {
    const ids = [...new Set(dto.lines.map((l) => l.menuItemId))];
    const found = await this.menu.findItemsByIds(ids);
    const menu = new Map<string, MenuItemDocument>(found.map((i) => [i.id as string, i]));
    const { lines, totalPaise: subtotalPaise } = priceLines(dto.lines, menu);
    const fulfillment = dto.fulfillment ?? Fulfillment.Delivery;
    const fees = this.feeConfig();
    const deliveryFeePaise = deliveryFeeFor(fulfillment, subtotalPaise, fees);
    return { lines, fulfillment, fees, subtotalPaise, deliveryFeePaise, totalPaise: subtotalPaise + deliveryFeePaise };
  }

  /** Prices a cart exactly as create() would. Writes nothing. Same errors as create() for unknown/unavailable items. */
  async quote(dto: QuoteOrderDto): Promise<OrderQuoteDto> {
    const p = await this.priceCart(dto);
    return {
      lines: p.lines.map((l) => ({
        menuItemId: String(l.menuItemId),
        name: l.name,
        isVeg: l.isVeg,
        unitPricePaise: l.unitPricePaise,
        options: l.options.map((o) => ({
          optionId: String(o.optionId),
          groupName: o.groupName,
          name: o.name,
          priceDeltaPaise: o.priceDeltaPaise,
        })),
        quantity: l.quantity,
        lineTotalPaise: l.lineTotalPaise,
        ...(l.note ? { note: l.note } : {}),
      })),
      fulfillment: p.fulfillment,
      subtotalPaise: p.subtotalPaise,
      deliveryFeePaise: p.deliveryFeePaise,
      totalPaise: p.totalPaise,
      minOrderPaise: p.fees.minOrderPaise,
      freeDeliveryAbovePaise: p.fees.freeDeliveryAbovePaise,
      maxCodPaise: this.maxCodPaise(),
    };
  }

  // ---------- create ----------

  async create(
    user: AuthUser,
    idempotencyKey: string,
    dto: CreateOrderDto,
  ): Promise<{ order: OrderDocument; replayed: boolean }> {
    const customerId = new Types.ObjectId(user.id);
    const phone = normalizePhone(dto.contactPhone);
    const requestHash = fingerprint(dto, phone);

    const existing = await this.orders.findOne({ customerId, idempotencyKey });
    if (existing) return { order: this.assertSameRequest(existing, requestHash), replayed: true };

    const { lines, fulfillment, fees, subtotalPaise, deliveryFeePaise, totalPaise } = await this.priceCart(dto);
    const isPickup = fulfillment === Fulfillment.Pickup;
    if (!isPickup && !dto.deliveryAddress) throw new BadRequestException('deliveryAddress is required for delivery');

    if (fees.minOrderPaise > 0 && subtotalPaise < fees.minOrderPaise) {
      throw new UnprocessableEntityException(`Minimum order is ₹${fees.minOrderPaise / 100}. Add more items.`);
    }
    const maxCod = this.maxCodPaise();
    if (totalPaise > maxCod) {
      throw new UnprocessableEntityException(`Cash on delivery is limited to ₹${maxCod / 100}. Reduce the order.`);
    }

    for (let attempt = 0; attempt < ORDER_NUMBER_TRIES; attempt++) {
      try {
        const order = await this.orders.create({
          orderNumber: newOrderNumber(),
          customerId,
          status: OrderStatus.Placed,
          paymentStatus: PaymentStatus.CodPending,
          paymentMethod: 'cod',
          fulfillment,
          lines,
          subtotalPaise,
          deliveryFeePaise,
          totalPaise,
          contactName: dto.contactName.trim(),
          contactPhone: phone,
          ...(isPickup || !dto.deliveryAddress
            ? {}
            : {
                deliveryAddress: {
                  line1: dto.deliveryAddress.line1.trim(),
                  area: dto.deliveryAddress.area?.trim(),
                  landmark: dto.deliveryAddress.landmark?.trim(),
                  pincode: dto.deliveryAddress.pincode,
                },
              }),
          customerNote: dto.customerNote?.trim(),
          statusLog: [this.logEntry(null, OrderStatus.Placed, user)],
          idempotencyKey,
          requestHash,
        });
        this.realtime.publishOrderCreated(order); // COD goes straight to the kitchen; never on replay
        return { order, replayed: false };
      } catch (e) {
        if (dupKeyOn(e, 'idempotencyKey')) {
          // Lost a race against the same key: return the winner's order.
          const winner = await this.orders.findOne({ customerId, idempotencyKey });
          if (winner) return { order: this.assertSameRequest(winner, requestHash), replayed: true };
        }
        if (dupKeyOn(e, 'orderNumber')) continue; // rare code collision, roll a new one
        throw e;
      }
    }
    throw new ConflictException('Could not allocate an order number. Please retry.');
  }

  private assertSameRequest(order: OrderDocument, requestHash: string): OrderDocument {
    if (order.requestHash !== requestHash) {
      throw new UnprocessableEntityException('Idempotency-Key was already used with a different request');
    }
    return order;
  }

  // ---------- read ----------

  async getVisible(user: AuthUser, id: string): Promise<OrderDocument> {
    const doc = await this.orders.findOne({ _id: id, ...orderScope(user) });
    if (!doc) throw new NotFoundException('Order not found'); // 404, not 403: don't confirm other people's ids exist
    return doc;
  }

  list(user: AuthUser, q: ListOrdersQueryDto): Promise<OrderDocument[]> {
    const filter: Record<string, unknown> = { ...orderScope(user) };

    const statuses = [...new Set([...(q.statuses ?? []), ...(q.status ? [q.status] : [])])];
    if (q.status && q.statuses?.length) {
      // both given: the intersection (status narrows statuses)
      const only = q.statuses.filter((s) => s === q.status);
      filter.status = { $in: only };
    } else if (statuses.length) {
      filter.status = { $in: statuses };
    }
    if (q.paymentStatus) filter.paymentStatus = q.paymentStatus;

    if (q.from || q.to) {
      filter.createdAt = { ...(q.from && { $gte: new Date(q.from) }), ...(q.to && { $lt: new Date(q.to) }) };
    }
    if (q.search?.trim()) {
      const esc = escapeRegex(q.search.trim());
      filter.$or = [
        { orderNumber: { $regex: `^${esc}`, $options: 'i' } },
        { contactName: { $regex: esc, $options: 'i' } },
        { contactPhone: { $regex: esc } },
      ];
    }
    return this.orders.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit ?? 50);
  }

  // ---------- status machine ----------

  async transition(user: AuthUser, id: string, dto: UpdateOrderStatusDto): Promise<OrderDocument> {
    const order = await this.getVisible(user, id);
    const from = order.status;
    const to = dto.status;

    // Pickup orders never get a rider. The kitchen hands them over: ready -> delivered ("collected").
    // This is the ONE addition to the state machine, and it is limited to pickup orders.
    const isPickup = order.fulfillment === Fulfillment.Pickup;
    if (isPickup && to === OrderStatus.Assigned) throw new BadRequestException('Pickup orders do not use a rider');
    const isHandover = isPickup && from === OrderStatus.Ready && to === OrderStatus.Delivered;

    if (isHandover) {
      if (user.role !== Role.Kitchen && user.role !== Role.Admin) {
        throw new ForbiddenException(`Role ${user.role} cannot move an order ${from} -> ${to}`);
      }
    } else {
      if (!isLegalTransition(from, to)) {
        throw new ConflictException(`Illegal transition: ${from} -> ${to}`);
      }
      if (!canRoleTransition(from, to, user.role)) {
        throw new ForbiddenException(`Role ${user.role} cannot move an order ${from} -> ${to}`);
      }
    }
    // Customers may cancel only while nobody has accepted it (also encoded in the state machine).

    if (to === OrderStatus.Assigned && !dto.riderId) throw new BadRequestException('riderId is required when assigning');
    if (to !== OrderStatus.Assigned && dto.riderId) throw new BadRequestException('riderId is only allowed when assigning');
    if (to === OrderStatus.Assigned) await this.assertActiveRider(dto.riderId!);

    // COD: a rider must report the cash, and it must match the order total (see cash.ts).
    const cash = checkCashCollected({ role: user.role, to, paymentMethod: order.paymentMethod, totalPaise: order.totalPaise, cashCollectedPaise: dto.cashCollectedPaise });

    const set: Record<string, unknown> = { status: to };
    if (to === OrderStatus.Assigned) set.riderId = new Types.ObjectId(dto.riderId);
    // COD: delivery is when the rider collects the cash.
    if (to === OrderStatus.Delivered && order.paymentMethod === 'cod') set.paymentStatus = PaymentStatus.CodCollected;
    if (cash !== undefined) set.cashCollectedPaise = cash;
    // The amount is also written to the status log, so it is on record even if the schema field is missing.
    const reason = cash !== undefined ? [dto.reason?.trim(), `Cash collected ${formatRupees(cash)}`].filter(Boolean).join('. ') : dto.reason;

    // Compare-and-set on the status we validated against: two racing requests can't both win.
    const updated = await this.orders.findOneAndUpdate(
      { _id: id, status: from },
      { $set: set, $push: { statusLog: this.logEntry(from, to, user, reason) } },
      { new: true },
    );
    if (!updated) throw new ConflictException('Order was changed by someone else. Reload and retry.');
    this.realtime.publishOrderStatusChanged(updated, from);
    return updated;
  }

  /** Admin escape hatch (wrong tap, stuck order). Any status -> any other, reason required, fully logged. */
  async override(user: AuthUser, id: string, dto: OverrideOrderStatusDto): Promise<OrderDocument> {
    if (user.role !== Role.Admin) throw new ForbiddenException('Admin only'); // belt and braces: the route is @Roles(Admin) too
    const order = await this.getVisible(user, id);
    const from = order.status;
    const to = dto.status;
    if (from === to) throw new ConflictException(`Order is already ${to}`);

    const needsRider = to === OrderStatus.Assigned || to === OrderStatus.PickedUp || to === OrderStatus.Delivered;
    const existingRider = order.riderId?.toHexString();
    const set: Record<string, unknown> = { status: to };
    const unset: Record<string, 1> = {};

    if (needsRider) {
      const riderId = dto.riderId ?? existingRider;
      if (!riderId) throw new BadRequestException('riderId is required: this order has no rider yet');
      if (riderId !== existingRider || to === OrderStatus.Assigned) await this.assertActiveRider(riderId);
      set.riderId = new Types.ObjectId(riderId);
    } else {
      if (dto.riderId) throw new BadRequestException(`riderId is not allowed for ${to}`);
      if (existingRider) unset.riderId = 1; // moved back / closed out: the rider loses it
    }

    if (to === OrderStatus.Delivered && order.paymentMethod === 'cod') set.paymentStatus = PaymentStatus.CodCollected;
    else if (from === OrderStatus.Delivered && order.paymentStatus === PaymentStatus.CodCollected) {
      set.paymentStatus = PaymentStatus.CodPending; // un-delivering a COD order un-collects the cash
      unset.cashCollectedPaise = 1;
    }

    const updated = await this.orders.findOneAndUpdate(
      { _id: id, status: from },
      {
        $set: set,
        ...(Object.keys(unset).length && { $unset: unset }),
        $push: { statusLog: this.logEntry(from, to, user, `[override] ${dto.reason}`) },
      },
      { new: true },
    );
    if (!updated) throw new ConflictException('Order was changed by someone else. Reload and retry.');
    this.realtime.publishOrderStatusChanged(updated, from);
    return updated;
  }

  private async assertActiveRider(riderId: string): Promise<void> {
    const rider = await this.users.findActiveById(riderId);
    if (!rider || rider.role !== Role.Rider) throw new BadRequestException('riderId must be an active rider account');
  }

  private logEntry(from: OrderStatus | null, to: OrderStatus, user: AuthUser, reason?: string): StatusLogEntry {
    return {
      from,
      to,
      byUserId: new Types.ObjectId(user.id),
      byRole: user.role,
      at: new Date(),
      ...(reason?.trim() && { reason: reason.trim() }),
    };
  }
}
