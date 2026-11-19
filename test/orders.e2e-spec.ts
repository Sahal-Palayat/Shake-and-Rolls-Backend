import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SmsService } from '../src/auth/sms.service';

type M = 'get' | 'post' | 'patch' | 'delete';

describe('Orders API (e2e)', () => {
  let app: INestApplication;
  const sentOtps: Record<string, string> = {};
  let adminToken: string, kitchenToken: string, riderToken: string, rider2Token: string, custA: string, custB: string;
  let riderId: string;
  let wrapId: string, cheeseId: string, jalapId: string, shakeId: string, soldOutId: string, reqGroupItemId: string;
  let keyN = 0;
  const newKey = () => `test-key-${Date.now()}-${keyN++}`;

  const api = () => request(app.getHttpServer());
  const as = (t: string | null, m: M, p: string) => {
    const r = api()[m](`/api${p}`);
    return t ? r.set('Authorization', `Bearer ${t}`) : r;
  };
  const subOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub as string;

  const customerLogin = async (phone: string) => {
    await api().post('/api/auth/customer/otp/request').send({ phone }).expect(200);
    return (await api().post('/api/auth/customer/otp/verify').send({ phone, code: sentOtps[`+91${phone}`] }).expect(200)).body.accessToken as string;
  };
  const staffLogin = async (username: string, secret: string) =>
    (await api().post('/api/auth/staff/login').send({ username, secret })).body.accessToken as string;

  const body = (lines: object[], extra: object = {}) => ({
    lines,
    paymentMethod: 'cod',
    contactName: 'Asha',
    contactPhone: '9876500000',
    deliveryAddress: { line1: 'House 4, Temple Rd', area: 'Kannur', pincode: '670001' },
    ...extra,
  });
  const place = (token: string, b: object, key = newKey()) => as(token, 'post', '/orders').set('Idempotency-Key', key).send(b);
  const placeOk = async (token = custA, lines: object[] = [{ menuItemId: wrapId, quantity: 1 }]) =>
    (await place(token, body(lines)).expect(201)).body as { id: string; status: string; paymentStatus: string; totalPaise: number };
  const move = (token: string, id: string, status: string, extra: object = {}) =>
    as(token, 'patch', `/orders/${id}/status`).send({ status, ...extra });

  /** Drive a fresh order to `assigned` to the given rider. */
  const toAssigned = async () => {
    const o = await placeOk();
    await move(kitchenToken, o.id, 'accepted').expect(200);
    await move(kitchenToken, o.id, 'preparing').expect(200);
    await move(kitchenToken, o.id, 'ready').expect(200);
    await move(kitchenToken, o.id, 'assigned', { riderId }).expect(200);
    return o;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsService)
      .useValue({ sendOtp: (phone: string, code: string) => void (sentOtps[phone] = code) })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    adminToken = await staffLogin('boss', 'correct-horse-battery');
    const mk = (name: string, username: string, role: string, secret: string) =>
      as(adminToken, 'post', '/admin/staff').send({ name, username, role, secretType: 'pin', secret }).expect(201);
    await mk('Kit', 'kitchen1', 'kitchen', '4821');
    await mk('Rid', 'rider1', 'rider', '5931');
    await mk('Rid2', 'rider2', 'rider', '6042');
    kitchenToken = await staffLogin('kitchen1', '4821');
    riderToken = await staffLogin('rider1', '5931');
    rider2Token = await staffLogin('rider2', '6042');
    riderId = subOf(riderToken);
    custA = await customerLogin('9876500001');
    custB = await customerLogin('9876500002');

    const cat = (await as(adminToken, 'post', '/menu/categories').send({ name: 'Orders cat' }).expect(201)).body.id;
    const wrap = (
      await as(adminToken, 'post', '/menu/items')
        .send({
          categoryId: cat, name: 'Paneer Wrap', pricePaise: 14900, isVeg: true,
          optionGroups: [{ name: 'Add-ons', minSelect: 0, maxSelect: 2, options: [
            { name: 'Extra cheese', priceDeltaPaise: 2000 }, { name: 'Jalapeños', priceDeltaPaise: 1000 }, { name: 'Sauce', priceDeltaPaise: 500 } ] }],
        })
        .expect(201)
    ).body;
    wrapId = wrap.id;
    cheeseId = wrap.optionGroups[0].options[0].id;
    jalapId = wrap.optionGroups[0].options[1].id;
    shakeId = (await as(adminToken, 'post', '/menu/items').send({ categoryId: cat, name: 'Shake', pricePaise: 9900, isVeg: true }).expect(201)).body.id;
    soldOutId = (await as(adminToken, 'post', '/menu/items').send({ categoryId: cat, name: 'Gone', pricePaise: 100, isVeg: true, isAvailable: false }).expect(201)).body.id;
    reqGroupItemId = (
      await as(adminToken, 'post', '/menu/items')
        .send({ categoryId: cat, name: 'Pick one', pricePaise: 100, isVeg: true,
          optionGroups: [{ name: 'Size', minSelect: 1, maxSelect: 1, options: [{ name: 'S', priceDeltaPaise: 0 }] }] })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  describe('create: server-side pricing', () => {
    it('total = sum((base + options) x qty) from the menu; starts placed / cod_pending with a log entry', async () => {
      const res = await place(custA, body([
        { menuItemId: wrapId, quantity: 2, optionIds: [cheeseId, jalapId] },
        { menuItemId: shakeId, quantity: 1 },
      ])).expect(201);
      expect(res.body.totalPaise).toBe((14900 + 2000 + 1000) * 2 + 9900);
      expect(res.body).toMatchObject({ status: 'placed', paymentStatus: 'cod_pending', paymentMethod: 'cod', contactPhone: '+919876500000' });
      expect(res.body.orderNumber).toMatch(/^SR-[A-Z2-9]{6}$/);
      expect(res.body.statusLog).toHaveLength(1);
      expect(res.body.statusLog[0]).toMatchObject({ from: null, to: 'placed', byRole: 'customer' });
      expect(res.body.statusLog[0].byUserId).toBeUndefined(); // hidden from customers
    });

    it('client-sent prices are rejected (400) and never reach the total', async () => {
      await place(custA, { ...body([{ menuItemId: wrapId, quantity: 1 }]), totalPaise: 1 }).expect(400);
      await place(custA, body([{ menuItemId: wrapId, quantity: 1, pricePaise: 1 }])).expect(400);
      const ok = await placeOk();
      expect(ok.totalPaise).toBe(14900);
    });

    it('a later menu price change does not alter a placed order', async () => {
      const o = await placeOk();
      await as(adminToken, 'patch', `/menu/items/${wrapId}`).send({ pricePaise: 99900 }).expect(200);
      const again = (await as(custA, 'get', `/orders/${o.id}`).expect(200)).body;
      expect(again.totalPaise).toBe(14900);
      expect((await placeOk()).totalPaise).toBe(99900);
      await as(adminToken, 'patch', `/menu/items/${wrapId}`).send({ pricePaise: 14900 }).expect(200);
    });

    it('validation: unknown item, foreign option, sold out, required group, empty, bad qty, bad phone, online', async () => {
      await place(custA, body([{ menuItemId: 'aaaaaaaaaaaaaaaaaaaaaaaa', quantity: 1 }])).expect(400);
      await place(custA, body([{ menuItemId: shakeId, quantity: 1, optionIds: [cheeseId] }])).expect(400);
      await place(custA, body([{ menuItemId: soldOutId, quantity: 1 }])).expect(422);
      await place(custA, body([{ menuItemId: reqGroupItemId, quantity: 1 }])).expect(400);
      await place(custA, body([])).expect(400);
      await place(custA, body([{ menuItemId: shakeId, quantity: 0 }])).expect(400);
      await place(custA, body([{ menuItemId: shakeId, quantity: 1 }], { contactPhone: '12345' })).expect(400);
      await place(custA, body([{ menuItemId: shakeId, quantity: 1 }], { paymentMethod: 'online' })).expect(400);
    });

    it('COD above the limit => 422', async () => {
      // 20 x 14900 = 298000 (ok, under 3000 rupees); 21 lines of that would exceed
      await place(custA, body([{ menuItemId: wrapId, quantity: 20 }])).expect(201);
      await place(custA, body([{ menuItemId: wrapId, quantity: 20 }, { menuItemId: shakeId, quantity: 20 }])).expect(422);
    });

    it('auth: no token 401; only customers may create (staff 403)', async () => {
      await api().post('/api/orders').set('Idempotency-Key', newKey()).send(body([{ menuItemId: shakeId, quantity: 1 }])).expect(401);
      await place(kitchenToken, body([{ menuItemId: shakeId, quantity: 1 }])).expect(403);
      await place(adminToken, body([{ menuItemId: shakeId, quantity: 1 }])).expect(403);
    });
  });

  describe('idempotency', () => {
    it('same key + same body => same order (201 then 200), only one row', async () => {
      const key = newKey();
      const b = body([{ menuItemId: wrapId, quantity: 1, optionIds: [cheeseId, jalapId] }]);
      const first = await place(custA, b, key).expect(201);
      const second = await place(custA, b, key).expect(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body).toEqual(first.body);
      const mine = (await as(custA, 'get', '/orders?limit=100').expect(200)).body as { id: string }[];
      expect(mine.filter((o) => o.id === first.body.id)).toHaveLength(1);
    });

    it('option order does not matter for the fingerprint', async () => {
      const key = newKey();
      const a = await place(custA, body([{ menuItemId: wrapId, quantity: 1, optionIds: [cheeseId, jalapId] }]), key).expect(201);
      const b = await place(custA, body([{ menuItemId: wrapId, quantity: 1, optionIds: [jalapId, cheeseId] }]), key).expect(200);
      expect(b.body.id).toBe(a.body.id);
    });

    it('concurrent duplicates create exactly one order', async () => {
      const key = newKey();
      const b = body([{ menuItemId: shakeId, quantity: 1 }]);
      const rs = await Promise.all(Array.from({ length: 6 }, () => place(custA, b, key)));
      expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    });

    it('same key, different body => 422', async () => {
      const key = newKey();
      await place(custA, body([{ menuItemId: shakeId, quantity: 1 }]), key).expect(201);
      await place(custA, body([{ menuItemId: shakeId, quantity: 2 }]), key).expect(422);
    });

    it('keys are per customer: B reusing A\'s key gets a separate order', async () => {
      const key = newKey();
      const a = await place(custA, body([{ menuItemId: shakeId, quantity: 1 }]), key).expect(201);
      const b = await place(custB, body([{ menuItemId: shakeId, quantity: 1 }]), key).expect(201);
      expect(b.body.id).not.toBe(a.body.id);
    });

    it('missing / malformed key => 400', async () => {
      await as(custA, 'post', '/orders').send(body([{ menuItemId: shakeId, quantity: 1 }])).expect(400);
      await place(custA, body([{ menuItemId: shakeId, quantity: 1 }]), 'short').expect(400);
      await place(custA, body([{ menuItemId: shakeId, quantity: 1 }]), 'has spaces in it!').expect(400);
    });
  });

  describe('status machine', () => {
    it('happy path to delivered; COD cash collected on delivery; full log', async () => {
      const o = await toAssigned();
      await move(riderToken, o.id, 'picked_up').expect(200);
      const done = (await move(riderToken, o.id, 'delivered').expect(200)).body;
      expect(done).toMatchObject({ status: 'delivered', paymentStatus: 'cod_collected', riderId });
      const staffView = (await as(kitchenToken, 'get', `/orders/${o.id}`).expect(200)).body;
      expect(staffView.statusLog.map((e: { from: string | null; to: string }) => [e.from, e.to])).toEqual([
        [null, 'placed'], ['placed', 'accepted'], ['accepted', 'preparing'], ['preparing', 'ready'],
        ['ready', 'assigned'], ['assigned', 'picked_up'], ['picked_up', 'delivered'],
      ]);
      expect(staffView.statusLog[1]).toMatchObject({ byRole: 'kitchen' });
      expect(staffView.statusLog[1].byUserId).toBeTruthy();
      expect(staffView.statusLog[1].at).toBeTruthy();
    });

    it('illegal transitions => 409 and nothing changes', async () => {
      const o = await placeOk();
      for (const to of ['preparing', 'ready', 'assigned', 'picked_up', 'delivered', 'placed']) {
        await move(kitchenToken, o.id, to, to === 'assigned' ? { riderId } : {}).expect(409);
      }
      expect((await as(kitchenToken, 'get', `/orders/${o.id}`).expect(200)).body.status).toBe('placed');
    });

    it('cannot go backwards or leave a terminal state', async () => {
      const o = await placeOk();
      await move(kitchenToken, o.id, 'accepted').expect(200);
      await move(kitchenToken, o.id, 'placed').expect(409);
      await move(kitchenToken, o.id, 'rejected').expect(409); // reject only from placed
      await move(kitchenToken, o.id, 'cancelled', { reason: 'out of stock' }).expect(200);
      await move(kitchenToken, o.id, 'accepted').expect(409);
      await move(adminToken, o.id, 'preparing').expect(409);
    });

    it('cancel/reject are not possible once preparing', async () => {
      const o = await placeOk();
      await move(kitchenToken, o.id, 'accepted').expect(200);
      await move(kitchenToken, o.id, 'preparing').expect(200);
      await move(kitchenToken, o.id, 'cancelled').expect(409);
      await move(adminToken, o.id, 'rejected').expect(409);
    });

    it('reject from placed stores the reason; paymentStatus stays cod_pending', async () => {
      const o = await placeOk();
      const r = (await move(kitchenToken, o.id, 'rejected', { reason: 'closed' }).expect(200)).body;
      expect(r).toMatchObject({ status: 'rejected', paymentStatus: 'cod_pending' });
      expect(r.statusLog.at(-1)).toMatchObject({ from: 'placed', to: 'rejected', reason: 'closed' });
    });

    it('customer: may cancel own order while placed, not after accepted', async () => {
      const a = await placeOk();
      const c = (await move(custA, a.id, 'cancelled').expect(200)).body;
      expect(c.status).toBe('cancelled');
      const b = await placeOk();
      await move(kitchenToken, b.id, 'accepted').expect(200);
      await move(custA, b.id, 'cancelled').expect(403);
    });

    it('customer cannot do staff transitions (403) on own order', async () => {
      const o = await placeOk();
      await move(custA, o.id, 'accepted').expect(403);
      await move(custA, o.id, 'delivered').expect(409); // illegal wins over role
      expect((await as(custA, 'get', `/orders/${o.id}`).expect(200)).body.status).toBe('placed');
    });

    it('assigned needs riderId; riderId only allowed on assigned', async () => {
      const o = await placeOk();
      await move(kitchenToken, o.id, 'accepted').expect(200);
      await move(kitchenToken, o.id, 'preparing', { riderId }).expect(400);
      await move(kitchenToken, o.id, 'preparing').expect(200);
      await move(kitchenToken, o.id, 'ready').expect(200);
      await move(kitchenToken, o.id, 'assigned').expect(400);
      await move(kitchenToken, o.id, 'assigned', { riderId: 'nope' }).expect(400);
      await move(kitchenToken, o.id, 'assigned', { riderId }).expect(200);
    });

    it('rider: only own assigned order; kitchen cannot pick up / deliver', async () => {
      const o = await toAssigned();
      await move(rider2Token, o.id, 'picked_up').expect(404); // not theirs: invisible
      await move(kitchenToken, o.id, 'picked_up').expect(403);
      await move(riderToken, o.id, 'delivered').expect(409); // must pick up first
      await move(riderToken, o.id, 'picked_up').expect(200);
      await move(kitchenToken, o.id, 'delivered').expect(403);
      await move(custA, o.id, 'delivered').expect(403);
      await move(riderToken, o.id, 'accepted').expect(409);
    });

    it('concurrent identical transitions: exactly one wins, log has one entry', async () => {
      const o = await placeOk();
      const rs = await Promise.all(Array.from({ length: 5 }, () => move(kitchenToken, o.id, 'accepted')));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
      const got = (await as(kitchenToken, 'get', `/orders/${o.id}`).expect(200)).body;
      expect(got.statusLog.filter((e: { to: string }) => e.to === 'accepted')).toHaveLength(1);
    });

    it('validation: bad status value, extra fields, bad id', async () => {
      const o = await placeOk();
      await move(kitchenToken, o.id, 'teleported').expect(400);
      await as(kitchenToken, 'patch', `/orders/${o.id}/status`).send({ status: 'accepted', totalPaise: 1 }).expect(400);
      await move(kitchenToken, 'bad-id', 'accepted').expect(400);
      await move(kitchenToken, 'aaaaaaaaaaaaaaaaaaaaaaaa', 'accepted').expect(404);
    });
  });

  describe('ownership + visibility', () => {
    it('customer B cannot read or change customer A\'s order (404); list is scoped', async () => {
      const o = await placeOk(custA);
      await as(custB, 'get', `/orders/${o.id}`).expect(404);
      await move(custB, o.id, 'cancelled').expect(404);
      expect((await as(custA, 'get', `/orders/${o.id}`).expect(200)).body.status).toBe('placed');
      const listB = (await as(custB, 'get', '/orders?limit=100').expect(200)).body as { id: string }[];
      expect(listB.map((x) => x.id)).not.toContain(o.id);
    });

    it('rider sees only orders assigned to them', async () => {
      const mine = await toAssigned();
      const notMine = await placeOk();
      await as(riderToken, 'get', `/orders/${mine.id}`).expect(200);
      await as(riderToken, 'get', `/orders/${notMine.id}`).expect(404);
      await as(rider2Token, 'get', `/orders/${mine.id}`).expect(404);
      const ids = ((await as(riderToken, 'get', '/orders?limit=100').expect(200)).body as { id: string }[]).map((x) => x.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(notMine.id);
    });

    it('kitchen/admin see everything; ?status filters', async () => {
      const o = await placeOk(custB);
      const all = (await as(kitchenToken, 'get', '/orders?status=placed&limit=100').expect(200)).body as { id: string; status: string }[];
      expect(all.map((x) => x.id)).toContain(o.id);
      expect(all.every((x) => x.status === 'placed')).toBe(true);
      await as(adminToken, 'get', `/orders/${o.id}`).expect(200);
      await as(kitchenToken, 'get', '/orders?status=bogus').expect(400);
    });

    it('401 without token on every endpoint', async () => {
      await as(null, 'get', '/orders').expect(401);
      await as(null, 'get', '/orders/aaaaaaaaaaaaaaaaaaaaaaaa').expect(401);
      await as(null, 'patch', '/orders/aaaaaaaaaaaaaaaaaaaaaaaa/status').send({ status: 'accepted' }).expect(401);
    });
  });
});
