import { Types } from 'mongoose';
import { Fulfillment, OrderStatus } from '../common/enums';
import { PublicTrackingService } from './public-tracking.service';
import { ReviewsService } from './reviews.service';
import { AccessTokenKind, RevokeReason } from './tracking.constants';
import { TrackingTokensService } from './tracking-tokens.service';
import { hashToken } from './tokens';

/** Just enough of a Mongoose model for these services: equality, $exists, $in. Unique keys throw like MongoDB (E11000). */
class MemModel {
  docs: any[] = [];
  constructor(private readonly uniqueKey?: string) {}
  private static match(doc: any, filter: Record<string, any>): boolean {
    return Object.entries(filter).every(([k, v]) => {
      const dv = doc[k];
      if (v && typeof v === 'object' && !(v instanceof Types.ObjectId) && !(v instanceof Date)) {
        if ('$exists' in v) return (dv !== undefined) === v.$exists;
        if ('$in' in v) return v.$in.some((x: unknown) => String(x) === String(dv));
      }
      return String(dv) === String(v);
    });
  }
  findOne = async (f: any) => this.docs.find((d) => MemModel.match(d, f)) ?? null;
  findById = async (id: unknown) => this.docs.find((d) => String(d._id) === String(id)) ?? null;
  exists = async (f: any) => {
    const d = this.docs.find((x) => MemModel.match(x, f));
    return d ? { _id: d._id } : null;
  };
  create = async (data: any) => {
    if (this.uniqueKey && this.docs.some((d) => String(d[this.uniqueKey!]) === String(data[this.uniqueKey!]))) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    const _id = data._id ?? new Types.ObjectId();
    const doc = { createdAt: new Date(), updatedAt: new Date(), ...data, _id, id: _id.toHexString() };
    this.docs.push(doc);
    return doc;
  };
  updateMany = async (f: any, u: any) => {
    let n = 0;
    for (const d of this.docs) if (MemModel.match(d, f)) (Object.assign(d, u.$set), n++);
    return { modifiedCount: n };
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

function setup(env: Record<string, unknown> = {}) {
  const tokens = new MemModel('tokenHash');
  const orders = new MemModel();
  const reviews = new MemModel('orderId');
  const config: any = { get: (k: string) => ({ FRONTEND_ORIGIN: 'https://shop.test', ...env })[k] };
  const access = new TrackingTokensService(tokens as any, orders as any, config);
  const reviewSvc = new ReviewsService(reviews as any, orders as any, access);
  const publicSvc = new PublicTrackingService(access, reviewSvc);
  const customerId = new Types.ObjectId();
  const staffId = new Types.ObjectId().toHexString();

  const addOrder = async (status: OrderStatus, extra: Record<string, unknown> = {}) =>
    orders.create({
      orderNumber: 'SR-TEST22',
      status,
      fulfillment: Fulfillment.Delivery,
      customerId,
      lines: [{ name: 'Wrap', quantity: 1 }],
      statusLog: [{ to: status, at: new Date() }],
      deliveryAddress: { location: { type: 'Point', coordinates: [75.37, 11.87] } },
      ...extra,
    });
  return { tokens, orders, reviews, access, reviewSvc, publicSvc, customerId, staffId, addOrder };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e: any) {
    return { status: e.getStatus?.(), ...(e.getResponse?.() as object) } as { status: number; code: string; reviewAvailable?: boolean; message: string };
  }
  throw new Error('expected a rejection');
};

describe('tracking link: generation', () => {
  it('stores only a hash, with an expiry exactly 24 h out', async () => {
    const { access, tokens, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.OutForDelivery);
    const t0 = new Date('2026-03-01T10:00:00Z');
    const { token, expiresAt } = await access.issueTrackingLink(o.id, staffId, t0);

    expect(expiresAt.getTime() - t0.getTime()).toBe(24 * HOUR);
    const stored = tokens.docs[0];
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token); // the raw token is nowhere in the database
    expect(stored.kind).toBe(AccessTokenKind.Tracking);
    expect(stored.purgeAt.getTime()).toBeGreaterThan(stored.expiresAt.getTime());
  });

  it('builds the URL from TRACKING_BASE_URL, else the first FRONTEND_ORIGIN, and the URL never contains the order id', async () => {
    const a = setup({ FRONTEND_ORIGIN: 'https://a.test, https://b.test' });
    expect(a.access.urlFor('TOK')).toBe('https://a.test/track/TOK');
    const b = setup({ TRACKING_BASE_URL: 'https://yourdomain.com/' });
    expect(b.access.urlFor('TOK')).toBe('https://yourdomain.com/track/TOK');
    const o = await b.addOrder(OrderStatus.PickedUp);
    const { token } = await b.access.issueTrackingLink(o.id, b.staffId);
    expect(b.access.urlFor(token)).not.toContain(o.id);
  });

  it('every link is unique', async () => {
    const { access, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.PickedUp);
    const a = await access.issueTrackingLink(o.id, staffId);
    const b = await access.issueTrackingLink(o.id, staffId);
    expect(a.token).not.toBe(b.token);
  });
});

describe('tracking link: public snapshot', () => {
  it('a fresh link shows the redacted order and its expiry', async () => {
    const { access, publicSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.OutForDelivery);
    const { token, expiresAt } = await access.issueTrackingLink(o.id, staffId);
    const snap = await publicSvc.snapshot(token);
    expect(snap.order.status).toBe(OrderStatus.OutForDelivery);
    expect(snap.order.destination).toEqual({ latitude: 11.87, longitude: 75.37 });
    expect(snap.expiresAt).toBe(expiresAt.toISOString());
    expect(snap.review).toEqual({ state: 'unavailable' });
    expect(JSON.stringify(snap)).not.toContain(o.id);
  });

  it('unknown, malformed and injected tokens all get the same 404', async () => {
    const { publicSvc } = setup();
    for (const t of ['nope', 'a'.repeat(43), '{"$ne":null}', '../../etc/passwd']) {
      expect(await code(publicSvc.snapshot(t))).toMatchObject({ status: 404, code: 'invalid' });
    }
  });

  it('a link older than 24 h answers 410 `expired` with a clear message', async () => {
    const { access, publicSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.OutForDelivery);
    const { token } = await access.issueTrackingLink(o.id, staffId, ago(25 * HOUR));
    const e = await code(publicSvc.snapshot(token));
    expect(e).toMatchObject({ status: 410, code: 'expired', reviewAvailable: false });
    expect(e.message).toMatch(/expired/i);
  });

  it('works right up to the 24 h mark and not a moment after', async () => {
    const { access, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.OutForDelivery);
    const t0 = new Date('2026-03-01T10:00:00Z');
    const { token } = await access.issueTrackingLink(o.id, staffId, t0);
    expect((await access.authorizeTracking(token, { now: new Date(t0.getTime() + 24 * HOUR - 1) })).ok).toBe(true);
    expect(await access.authorizeTracking(token, { now: new Date(t0.getTime() + 24 * HOUR) })).toMatchObject({ ok: false, code: 'expired' });
  });

  it('a revoked link answers 410 `revoked`, even before it expires', async () => {
    const { access, publicSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.OutForDelivery);
    const { token } = await access.issueTrackingLink(o.id, staffId);
    expect(await access.revokeAllForOrder(o.id, RevokeReason.Security)).toBe(1);
    expect(await code(publicSvc.snapshot(token))).toMatchObject({ status: 410, code: 'revoked' });
  });

  it('revoking one order leaves other orders\' links alone', async () => {
    const { access, publicSvc, addOrder, staffId } = setup();
    const a = await addOrder(OrderStatus.OutForDelivery);
    const b = await addOrder(OrderStatus.OutForDelivery);
    const ta = await access.issueTrackingLink(a.id, staffId);
    const tb = await access.issueTrackingLink(b.id, staffId);
    await access.revokeAllForOrder(a.id, RevokeReason.Security);
    await expect(publicSvc.snapshot(tb.token)).resolves.toBeTruthy();
    await expect(publicSvc.snapshot(ta.token)).rejects.toBeTruthy();
  });

  it('a cancelled order is closed even if the link was never revoked (defence in depth)', async () => {
    const { access, publicSvc, addOrder, staffId, orders } = setup();
    const o = await addOrder(OrderStatus.Accepted);
    const { token } = await access.issueTrackingLink(o.id, staffId);
    orders.docs[0].status = OrderStatus.Cancelled; // link NOT revoked
    expect(await code(publicSvc.snapshot(token))).toMatchObject({ status: 410, code: 'cancelled' });
  });

  it('a link revoked because of cancellation says `cancelled`, not a generic error', async () => {
    const { access, publicSvc, addOrder, staffId, orders } = setup();
    const o = await addOrder(OrderStatus.Accepted);
    const { token } = await access.issueTrackingLink(o.id, staffId);
    await access.revokeAllForOrder(o.id, RevokeReason.Cancelled);
    orders.docs[0].status = OrderStatus.Placed; // even if somebody un-cancelled it, the revoked link stays dead
    expect(await code(publicSvc.snapshot(token))).toMatchObject({ status: 410, code: 'cancelled' });
  });

  it('pickup orders have no tracking link', async () => {
    const { access, publicSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.Ready, { fulfillment: Fulfillment.Pickup });
    const { token } = await access.issueTrackingLink(o.id, staffId);
    expect(await code(publicSvc.snapshot(token))).toMatchObject({ status: 404, code: 'invalid' });
  });
});

describe('review after delivery', () => {
  const delivered = (h: number) => ({ statusLog: [{ to: OrderStatus.Delivered, at: ago(h * HOUR) }], updatedAt: ago(h * HOUR) });

  it('is locked until the order is delivered (state, token and submit)', async () => {
    const { access, publicSvc, reviewSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.OutForDelivery);
    const { token } = await access.issueTrackingLink(o.id, staffId);
    expect((await publicSvc.snapshot(token)).review.state).toBe('unavailable');
    expect(await code(publicSvc.issueReviewToken(token))).toMatchObject({ status: 409, code: 'not_delivered' });
    // a review token that somehow exists still cannot review an undelivered order
    const issued = await access.issueReviewToken(o.id, new Date());
    expect(await code(reviewSvc.submitByToken(issued!.token, { rating: 5 }))).toMatchObject({ status: 409, code: 'not_delivered' });
  });

  it('delivered: the page offers the review, and submitting it stores it against that order', async () => {
    const { access, publicSvc, reviewSvc, reviews, addOrder, staffId } = setup();
    const rider = new Types.ObjectId();
    const o = await addOrder(OrderStatus.Delivered, { riderId: rider, ...delivered(1) });
    const { token } = await access.issueTrackingLink(o.id, staffId);
    expect((await publicSvc.snapshot(token)).review).toEqual({ state: 'available' });

    const { reviewToken } = await publicSvc.issueReviewToken(token);
    const saved = await reviewSvc.submitByToken(reviewToken, { rating: 4, comment: '  Hot and quick!  ' });
    expect(saved).toMatchObject({ rating: 4, comment: 'Hot and quick!' });

    expect(reviews.docs).toHaveLength(1);
    expect(String(reviews.docs[0].orderId)).toBe(o.id);
    expect(String(reviews.docs[0].customerId)).toBe(String(o.customerId));
    expect(String(reviews.docs[0].riderId)).toBe(String(rider));
    expect(reviews.docs[0].submittedVia).toBe('review_token');
    expect((await publicSvc.snapshot(token)).review).toEqual({ state: 'submitted', rating: 4, comment: 'Hot and quick!' });
  });

  it('cannot be submitted twice (second try is a 409), and the first review is kept', async () => {
    const { access, publicSvc, reviewSvc, reviews, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.Delivered, delivered(1));
    const { token } = await access.issueTrackingLink(o.id, staffId);
    const { reviewToken } = await publicSvc.issueReviewToken(token);
    await reviewSvc.submitByToken(reviewToken, { rating: 5 });
    expect(await code(reviewSvc.submitByToken(reviewToken, { rating: 1, comment: 'changed my mind' }))).toMatchObject({ status: 409, code: 'already_reviewed' });
    expect(await code(publicSvc.issueReviewToken(token))).toMatchObject({ status: 409, code: 'already_reviewed' });
    expect(reviews.docs).toHaveLength(1);
    expect(reviews.docs[0].rating).toBe(5);
  });

  it('two submissions racing past the check: the unique index lets exactly one in', async () => {
    const { access, publicSvc, reviewSvc, reviews, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.Delivered, delivered(1));
    const { token } = await access.issueTrackingLink(o.id, staffId);
    const { reviewToken } = await publicSvc.issueReviewToken(token);
    (reviews as any).exists = async () => null; // both requests saw "no review yet"
    const results = await Promise.allSettled([reviewSvc.submitByToken(reviewToken, { rating: 5 }), reviewSvc.submitByToken(reviewToken, { rating: 2 })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason.getResponse()).toMatchObject({ code: 'already_reviewed' });
    expect(reviews.docs).toHaveLength(1);
  });

  it('THE 24 h EXPIRY DOES NOT BLOCK A REVIEW: an expired link can still obtain a review token and submit', async () => {
    const { access, publicSvc, reviewSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.Delivered, delivered(30)); // delivered 30 h ago
    const { token } = await access.issueTrackingLink(o.id, staffId, ago(40 * HOUR)); // link expired 16 h ago

    const expired = await code(publicSvc.snapshot(token));
    expect(expired).toMatchObject({ status: 410, code: 'expired', reviewAvailable: true }); // page: "expired" + review box

    const { reviewToken, expiresAt } = await publicSvc.issueReviewToken(token);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 5 * DAY); // lives for the review window, not 24 h
    await expect(reviewSvc.submitByToken(reviewToken, { rating: 5 })).resolves.toMatchObject({ rating: 5 });
  });

  it('the review token is a different credential: a tracking token is not accepted as one, and vice versa', async () => {
    const { access, publicSvc, reviewSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.Delivered, delivered(1));
    const { token } = await access.issueTrackingLink(o.id, staffId);
    const { reviewToken } = await publicSvc.issueReviewToken(token);
    expect(reviewToken).not.toBe(token);
    expect(await code(reviewSvc.submitByToken(token, { rating: 5 }))).toMatchObject({ status: 404, code: 'invalid' });
    expect(await code(publicSvc.snapshot(reviewToken))).toMatchObject({ status: 404, code: 'invalid' });
  });

  it('a newer review token retires the older one', async () => {
    const { access, publicSvc, reviewSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.Delivered, delivered(1));
    const { token } = await access.issueTrackingLink(o.id, staffId);
    const first = await publicSvc.issueReviewToken(token);
    const second = await publicSvc.issueReviewToken(token);
    expect(await code(reviewSvc.stateByToken(first.reviewToken))).toMatchObject({ status: 410, code: 'revoked' });
    await expect(reviewSvc.stateByToken(second.reviewToken)).resolves.toMatchObject({ review: { state: 'available' } });
  });

  it('closes after the review window (default 7 days); REVIEW_WINDOW_DAYS changes it', async () => {
    const late = setup();
    const o = await late.addOrder(OrderStatus.Delivered, delivered(8 * 24));
    const { token } = await late.access.issueTrackingLink(o.id, late.staffId, ago(8 * DAY));
    expect(await code(late.publicSvc.snapshot(token))).toMatchObject({ code: 'expired', reviewAvailable: false });
    expect(await code(late.publicSvc.issueReviewToken(token))).toMatchObject({ status: 410, code: 'review_closed' });

    const longer = setup({ REVIEW_WINDOW_DAYS: 14 });
    const o2 = await longer.addOrder(OrderStatus.Delivered, delivered(8 * 24));
    const t2 = await longer.access.issueTrackingLink(o2.id, longer.staffId, ago(8 * DAY));
    await expect(longer.publicSvc.issueReviewToken(t2.token)).resolves.toHaveProperty('reviewToken');
  });

  it('an expired review token is refused', async () => {
    const { access, reviewSvc, addOrder } = setup();
    const o = await addOrder(OrderStatus.Delivered, delivered(1));
    const issued = await access.issueReviewToken(o.id, ago(1 * HOUR), new Date());
    // age it past its deadline
    const doc = (access as any).tokens.docs.find((d: any) => d.kind === AccessTokenKind.Review);
    doc.expiresAt = ago(1000);
    expect(await code(reviewSvc.submitByToken(issued!.token, { rating: 5 }))).toMatchObject({ status: 410, code: 'expired' });
  });

  it('a link revoked for security gives no review route (neither tracking nor review token works)', async () => {
    const { access, publicSvc, reviewSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.Delivered, delivered(30));
    const { token } = await access.issueTrackingLink(o.id, staffId, ago(40 * HOUR));
    const { reviewToken } = await publicSvc.issueReviewToken(token);
    await access.revokeAllForOrder(o.id, RevokeReason.Security, [AccessTokenKind.Tracking, AccessTokenKind.Review]);
    expect(await code(publicSvc.issueReviewToken(token))).toMatchObject({ status: 410, code: 'revoked' });
    expect(await code(reviewSvc.submitByToken(reviewToken, { rating: 5 }))).toMatchObject({ status: 410, code: 'revoked' });
  });

  it('a cancelled order can never be reviewed', async () => {
    const { access, publicSvc, addOrder, staffId } = setup();
    const o = await addOrder(OrderStatus.Cancelled);
    const { token } = await access.issueTrackingLink(o.id, staffId);
    expect(await code(publicSvc.issueReviewToken(token))).toMatchObject({ status: 410, code: 'cancelled' });
  });

  describe('signed-in customer route', () => {
    it('works with no token and no 24 h limit, only for the customer\'s own delivered order', async () => {
      const { reviewSvc, reviews, addOrder, customerId } = setup();
      const o = await addOrder(OrderStatus.Delivered, delivered(24 * 20));
      await expect(reviewSvc.submitAsCustomer(customerId.toHexString(), o.id, { rating: 3 })).resolves.toMatchObject({ rating: 3 });
      expect(reviews.docs[0].submittedVia).toBe('customer');
      expect(await code(reviewSvc.submitAsCustomer(customerId.toHexString(), o.id, { rating: 1 }))).toMatchObject({ status: 409, code: 'already_reviewed' });
    });

    it('someone else\'s order is a 404, an undelivered one is a 409', async () => {
      const { reviewSvc, addOrder, customerId } = setup();
      const mine = await addOrder(OrderStatus.OutForDelivery);
      await expect(reviewSvc.submitAsCustomer(new Types.ObjectId().toHexString(), mine.id, { rating: 5 })).rejects.toMatchObject({ status: 404 });
      expect(await code(reviewSvc.submitAsCustomer(customerId.toHexString(), mine.id, { rating: 5 }))).toMatchObject({ status: 409, code: 'not_delivered' });
    });

    it('pickup orders are not reviewable here (this is a delivery review)', async () => {
      const { reviewSvc, addOrder, customerId } = setup();
      const o = await addOrder(OrderStatus.Delivered, { fulfillment: Fulfillment.Pickup, ...delivered(1) });
      expect(await code(reviewSvc.submitAsCustomer(customerId.toHexString(), o.id, { rating: 5 }))).toMatchObject({ code: 'not_delivered' });
    });
  });
});
