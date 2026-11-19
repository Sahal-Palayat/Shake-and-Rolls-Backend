import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { SmsService } from '../src/auth/sms.service';

describe('Menu API (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let kitchenToken: string;
  let customerToken: string;
  const sentOtps: Record<string, string> = {};

  const api = () => request(app.getHttpServer());
  const as = (token: string | null, method: 'get' | 'post' | 'patch' | 'delete', path: string) => {
    const r = api()[method](`/api${path}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const admin = (m: 'get' | 'post' | 'patch' | 'delete', p: string) => as(adminToken, m, p);
  const kitchen = (m: 'get' | 'post' | 'patch' | 'delete', p: string) => as(kitchenToken, m, p);

  const mkCategory = async (name: string, extra: object = {}) =>
    (await admin('post', '/menu/categories').send({ name, ...extra }).expect(201)).body as { id: string; name: string };

  const itemBody = (categoryId: string, extra: object = {}) => ({
    categoryId,
    name: 'Paneer Wrap',
    pricePaise: 14900,
    isVeg: true,
    ...extra,
  });

  const toppings = {
    name: 'Add-ons',
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: 'Extra cheese', priceDeltaPaise: 2000 },
      { name: 'Jalapeños', priceDeltaPaise: 1000 },
    ],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SmsService)
      .useValue({ sendOtp: (phone: string, code: string) => void (sentOtps[phone] = code) })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    adminToken = (await api().post('/api/auth/staff/login').send({ username: 'boss', secret: 'correct-horse-battery' })).body
      .accessToken;
    await admin('post', '/admin/staff')
      .send({ name: 'Kit', username: 'kitchen1', role: 'kitchen', secretType: 'pin', secret: '4821' })
      .expect(201);
    kitchenToken = (await api().post('/api/auth/staff/login').send({ username: 'kitchen1', secret: '4821' })).body.accessToken;

    await api().post('/api/auth/customer/otp/request').send({ phone: '9876500000' }).expect(200);
    customerToken = (
      await api().post('/api/auth/customer/otp/verify').send({ phone: '9876500000', code: sentOtps['+919876500000'] }).expect(200)
    ).body.accessToken;
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  describe('public reads need no token', () => {
    it.each(['/menu', '/menu/categories', '/menu/items'])('GET %s => 200', async (path) => {
      await as(null, 'get', path).expect(200);
    });
  });

  describe('write endpoints: 401 without token, 403 for kitchen/customer (except availability)', () => {
    let categoryId = '';
    let itemId = '';
    beforeAll(async () => {
      categoryId = (await mkCategory('Guarded')).id;
      itemId = (await admin('post', '/menu/items').send(itemBody(categoryId, { name: 'Guarded item' })).expect(201)).body.id;
    });

    const writes: [string, 'post' | 'patch' | 'delete', () => string, () => object][] = [
      ['create category', 'post', () => '/menu/categories', () => ({ name: 'Nope' })],
      ['update category', 'patch', () => `/menu/categories/${categoryId}`, () => ({ name: 'Nope' })],
      ['delete category', 'delete', () => `/menu/categories/${categoryId}`, () => ({})],
      ['create item', 'post', () => '/menu/items', () => ({ categoryId, name: 'Nope', pricePaise: 1, isVeg: true })],
      ['update item', 'patch', () => `/menu/items/${itemId}`, () => ({ name: 'Nope' })],
      ['delete item', 'delete', () => `/menu/items/${itemId}`, () => ({})],
    ];

    it.each(writes)('%s: no token => 401', async (_n, method, path, body) => {
      await as(null, method, path()).send(body()).expect(401);
    });
    it.each(writes)('%s: kitchen => 403', async (_n, method, path, body) => {
      await kitchen(method, path()).send(body()).expect(403);
    });
    it.each(writes)('%s: customer => 403', async (_n, method, path, body) => {
      await as(customerToken, method, path()).send(body()).expect(403);
    });

    it('availability: no token 401, customer 403', async () => {
      await as(null, 'patch', `/menu/items/${itemId}/availability`).send({ isAvailable: false }).expect(401);
      await as(customerToken, 'patch', `/menu/items/${itemId}/availability`).send({ isAvailable: false }).expect(403);
    });

    it('nothing was actually changed by the rejected writes', async () => {
      const res = await as(null, 'get', `/menu/items/${itemId}`).expect(200);
      expect(res.body.name).toBe('Guarded item');
      expect(res.body.isAvailable).toBe(true);
      expect((await as(null, 'get', '/menu/categories')).body.map((c: { name: string }) => c.name)).not.toContain('Nope');
    });
  });

  describe('categories CRUD (admin)', () => {
    it('create / list / update / delete', async () => {
      const c = await mkCategory('Shakes', { description: 'Thick', sortOrder: 5 });
      expect(c).toMatchObject({ name: 'Shakes', description: 'Thick', sortOrder: 5 });

      const upd = await admin('patch', `/menu/categories/${c.id}`).send({ description: 'Thicker' }).expect(200);
      expect(upd.body).toMatchObject({ name: 'Shakes', description: 'Thicker', sortOrder: 5 });

      const list = (await as(null, 'get', '/menu/categories').expect(200)).body as { id: string }[];
      expect(list.map((x) => x.id)).toContain(c.id);

      await admin('delete', `/menu/categories/${c.id}`).expect(204);
      await admin('delete', `/menu/categories/${c.id}`).expect(404);
    });

    it('duplicate name (case-insensitive) => 409, on create and on rename', async () => {
      await mkCategory('Fries');
      await admin('post', '/menu/categories').send({ name: 'fries' }).expect(409);
      const other = await mkCategory('Fries 2');
      await admin('patch', `/menu/categories/${other.id}`).send({ name: 'FRIES' }).expect(409);
    });

    it('validation: empty name, extra fields, bad ids', async () => {
      await admin('post', '/menu/categories').send({ name: '' }).expect(400);
      await admin('post', '/menu/categories').send({ name: 'X', evil: 1 }).expect(400);
      await admin('patch', '/menu/categories/not-an-id').send({ name: 'X' }).expect(400);
      await admin('patch', '/menu/categories/aaaaaaaaaaaaaaaaaaaaaaaa').send({ name: 'X' }).expect(404);
    });

    it('cannot delete a category that still has items => 409; works once emptied', async () => {
      const c = await mkCategory('Has items');
      const i = (await admin('post', '/menu/items').send(itemBody(c.id)).expect(201)).body;
      await admin('delete', `/menu/categories/${c.id}`).expect(409);
      await admin('delete', `/menu/items/${i.id}`).expect(204);
      await admin('delete', `/menu/categories/${c.id}`).expect(204);
    });
  });

  describe('items CRUD (admin)', () => {
    let catId: string;
    beforeAll(async () => {
      catId = (await mkCategory('Wraps')).id;
    });

    it('create with options, read back publicly, update, delete', async () => {
      const created = (
        await admin('post', '/menu/items')
          .send(itemBody(catId, { description: 'Spicy', imageUrl: 'https://cdn.example.com/p.jpg', optionGroups: [toppings] }))
          .expect(201)
      ).body;
      expect(created).toMatchObject({
        categoryId: catId,
        name: 'Paneer Wrap',
        pricePaise: 14900,
        isVeg: true,
        isAvailable: true,
        imageUrl: 'https://cdn.example.com/p.jpg',
      });
      expect(created.optionGroups).toHaveLength(1);
      expect(created.optionGroups[0].options.map((o: { name: string }) => o.name)).toEqual(['Extra cheese', 'Jalapeños']);
      expect(created.optionGroups[0].options.every((o: { isAvailable: boolean; id: string }) => o.isAvailable && o.id)).toBe(true);

      const pub = (await as(null, 'get', `/menu/items/${created.id}`).expect(200)).body;
      expect(pub).toEqual(created);

      const upd = (await admin('patch', `/menu/items/${created.id}`).send({ pricePaise: 15900, isVeg: false }).expect(200)).body;
      expect(upd).toMatchObject({ pricePaise: 15900, isVeg: false, name: 'Paneer Wrap' });
      expect(upd.optionGroups).toEqual(created.optionGroups); // untouched when not sent

      await admin('delete', `/menu/items/${created.id}`).expect(204);
      await as(null, 'get', `/menu/items/${created.id}`).expect(404);
      await admin('delete', `/menu/items/${created.id}`).expect(404);
    });

    it('optionGroups on PATCH replaces the list; sending ids keeps identity', async () => {
      const item = (await admin('post', '/menu/items').send(itemBody(catId, { optionGroups: [toppings] })).expect(201)).body;
      const g = item.optionGroups[0];
      const keep = g.options[0];

      const upd = (
        await admin('patch', `/menu/items/${item.id}`)
          .send({
            optionGroups: [
              {
                id: g.id,
                name: 'Add-ons v2',
                minSelect: 0,
                maxSelect: 1,
                options: [{ id: keep.id, name: 'Extra cheese', priceDeltaPaise: 2500 }],
              },
            ],
          })
          .expect(200)
      ).body;
      expect(upd.optionGroups).toHaveLength(1);
      expect(upd.optionGroups[0].id).toBe(g.id);
      expect(upd.optionGroups[0].options).toEqual([
        { id: keep.id, name: 'Extra cheese', priceDeltaPaise: 2500, isAvailable: true },
      ]);

      const cleared = (await admin('patch', `/menu/items/${item.id}`).send({ optionGroups: [] }).expect(200)).body;
      expect(cleared.optionGroups).toEqual([]);
    });

    it('can move an item to another category', async () => {
      const other = await mkCategory('Moved to');
      const item = (await admin('post', '/menu/items').send(itemBody(catId)).expect(201)).body;
      const upd = (await admin('patch', `/menu/items/${item.id}`).send({ categoryId: other.id }).expect(200)).body;
      expect(upd.categoryId).toBe(other.id);
      const byCat = (await as(null, 'get', `/menu/items?categoryId=${other.id}`).expect(200)).body;
      expect(byCat.map((x: { id: string }) => x.id)).toEqual([item.id]);
    });

    describe('validation', () => {
      const post = (body: object) => admin('post', '/menu/items').send(body);

      it('unknown category => 400; malformed => 400', async () => {
        await post(itemBody('aaaaaaaaaaaaaaaaaaaaaaaa')).expect(400);
        await post(itemBody('nope')).expect(400);
        const item = (await post(itemBody(catId)).expect(201)).body;
        await admin('patch', `/menu/items/${item.id}`).send({ categoryId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }).expect(400);
      });

      it.each([
        ['float price', { pricePaise: 149.5 }],
        ['negative price', { pricePaise: -1 }],
        ['absurd price', { pricePaise: 99_999_999 }],
        ['string price', { pricePaise: '149' }],
        ['missing isVeg', { isVeg: undefined }],
        ['empty name', { name: '' }],
        ['non-url image', { imageUrl: 'not a url' }],
        ['javascript: image', { imageUrl: 'javascript:alert(1)' }],
        ['extra field', { isAdmin: true }],
      ])('rejects %s', async (_n, extra) => {
        await post(itemBody(catId, extra)).expect(400);
      });

      it.each([
        ['min > max', { ...toppings, minSelect: 3, maxSelect: 2 }],
        ['max > option count', { ...toppings, maxSelect: 3 }],
        ['no options', { ...toppings, options: [] }],
        ['negative option price', { ...toppings, options: [{ name: 'x', priceDeltaPaise: -5 }, { name: 'y', priceDeltaPaise: 0 }] }],
        ['unknown field on option', { ...toppings, options: [{ name: 'x', priceDeltaPaise: 0, foo: 1 }, { name: 'y', priceDeltaPaise: 0 }] }],
      ])('rejects option group: %s', async (_n, group) => {
        await post(itemBody(catId, { optionGroups: [group] })).expect(400);
      });

      it('rejects duplicate option ids within an item', async () => {
        const item = (await post(itemBody(catId, { optionGroups: [toppings] })).expect(201)).body;
        const id = item.optionGroups[0].options[0].id;
        await admin('patch', `/menu/items/${item.id}`)
          .send({
            optionGroups: [
              { ...toppings, options: [{ id, name: 'a', priceDeltaPaise: 0 }, { id, name: 'b', priceDeltaPaise: 0 }] },
            ],
          })
          .expect(400);
      });

      it('nothing is persisted from rejected creates', async () => {
        const before = (await as(null, 'get', '/menu/items')).body.length;
        await post(itemBody(catId, { pricePaise: -1 })).expect(400);
        expect((await as(null, 'get', '/menu/items')).body.length).toBe(before);
      });

      it('bad ids on item routes => 400/404, not 500', async () => {
        await as(null, 'get', '/menu/items/xyz').expect(400);
        await as(null, 'get', '/menu/items/aaaaaaaaaaaaaaaaaaaaaaaa').expect(404);
        await as(null, 'get', '/menu/items?categoryId=xyz').expect(400);
        await admin('patch', '/menu/items/aaaaaaaaaaaaaaaaaaaaaaaa').send({ name: 'x' }).expect(404);
      });
    });
  });

  describe('availability toggle: admin + kitchen, and ONLY that', () => {
    let itemId: string;
    let optionId: string;
    beforeAll(async () => {
      const c = await mkCategory('Toggle cat');
      const item = (await admin('post', '/menu/items').send(itemBody(c.id, { name: 'Toggle me', optionGroups: [toppings] })).expect(201)).body;
      itemId = item.id;
      optionId = item.optionGroups[0].options[1].id;
    });

    it('kitchen can mark an item unavailable and available again', async () => {
      const off = (await kitchen('patch', `/menu/items/${itemId}/availability`).send({ isAvailable: false }).expect(200)).body;
      expect(off.isAvailable).toBe(false);
      expect((await as(null, 'get', `/menu/items/${itemId}`)).body.isAvailable).toBe(false);
      const on = (await kitchen('patch', `/menu/items/${itemId}/availability`).send({ isAvailable: true }).expect(200)).body;
      expect(on.isAvailable).toBe(true);
    });

    it('admin can toggle too', async () => {
      await admin('patch', `/menu/items/${itemId}/availability`).send({ isAvailable: false }).expect(200);
      await admin('patch', `/menu/items/${itemId}/availability`).send({ isAvailable: true }).expect(200);
    });

    it('kitchen cannot smuggle other fields through the toggle (400) and nothing changes', async () => {
      await kitchen('patch', `/menu/items/${itemId}/availability`).send({ isAvailable: false, pricePaise: 1 }).expect(400);
      await kitchen('patch', `/menu/items/${itemId}/availability`).send({ pricePaise: 1 }).expect(400);
      await kitchen('patch', `/menu/items/${itemId}/availability`).send({ isAvailable: 'false' }).expect(400);
      const item = (await as(null, 'get', `/menu/items/${itemId}`)).body;
      expect(item.pricePaise).toBe(14900);
      expect(item.isAvailable).toBe(true);
    });

    it('kitchen cannot edit the item itself', async () => {
      await kitchen('patch', `/menu/items/${itemId}`).send({ pricePaise: 1 }).expect(403);
      expect((await as(null, 'get', `/menu/items/${itemId}`)).body.pricePaise).toBe(14900);
    });

    it('kitchen can toggle a single add-on; sibling options untouched', async () => {
      const off = (
        await kitchen('patch', `/menu/items/${itemId}/options/${optionId}/availability`).send({ isAvailable: false }).expect(200)
      ).body;
      const opts = off.optionGroups[0].options as { id: string; isAvailable: boolean }[];
      expect(opts.find((o) => o.id === optionId)!.isAvailable).toBe(false);
      expect(opts.filter((o) => o.id !== optionId).every((o) => o.isAvailable)).toBe(true);
      expect(off.isAvailable).toBe(true); // item itself unaffected
    });

    it('unknown item/option => 404, malformed => 400', async () => {
      await kitchen('patch', `/menu/items/${itemId}/options/aaaaaaaaaaaaaaaaaaaaaaaa/availability`).send({ isAvailable: false }).expect(404);
      await kitchen('patch', `/menu/items/aaaaaaaaaaaaaaaaaaaaaaaa/availability`).send({ isAvailable: false }).expect(404);
      await kitchen('patch', `/menu/items/${itemId}/options/zzz/availability`).send({ isAvailable: false }).expect(400);
    });
  });

  describe('GET /menu (customer view)', () => {
    it('groups by category in sortOrder, includes unavailable items, omits empty categories', async () => {
      const b = await mkCategory('Order B', { sortOrder: 2001 });
      const a = await mkCategory('Order A', { sortOrder: 2000 });
      await mkCategory('Order Empty', { sortOrder: 2002 });
      const i2 = (await admin('post', '/menu/items').send(itemBody(b.id, { name: 'B2', sortOrder: 2 })).expect(201)).body;
      await admin('post', '/menu/items').send(itemBody(b.id, { name: 'B1', sortOrder: 1 })).expect(201);
      await admin('post', '/menu/items').send(itemBody(a.id, { name: 'A1' })).expect(201);
      await admin('patch', `/menu/items/${i2.id}/availability`).send({ isAvailable: false }).expect(200);

      const menu = (await as(null, 'get', '/menu').expect(200)).body as {
        name: string;
        items: { name: string; isAvailable: boolean }[];
      }[];
      const mine = menu.filter((c) => c.name.startsWith('Order '));
      expect(mine.map((c) => c.name)).toEqual(['Order A', 'Order B']);
      expect(mine[1].items.map((i) => i.name)).toEqual(['B1', 'B2']);
      expect(mine[1].items.find((i) => i.name === 'B2')!.isAvailable).toBe(false);
    });
  });
});
