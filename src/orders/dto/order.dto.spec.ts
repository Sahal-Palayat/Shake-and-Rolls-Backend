import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrderDto, QuoteOrderDto } from './order.dto';

const line = { menuItemId: '64b7f0c2a1b2c3d4e5f60718', quantity: 2 };
const base = { lines: [line], paymentMethod: 'cod', contactName: 'Asha', contactPhone: '9876500000' };
const errs = async (cls: any, plain: object) => (await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('CreateOrderDto', () => {
  it('delivery (explicit or default) requires an address', async () => {
    expect(await errs(CreateOrderDto, { ...base })).toContain('deliveryAddress');
    expect(await errs(CreateOrderDto, { ...base, fulfillment: 'delivery' })).toContain('deliveryAddress');
  });
  it('pickup needs no address', async () => {
    expect(await errs(CreateOrderDto, { ...base, fulfillment: 'pickup' })).toEqual([]);
  });
  it('delivery with an address is valid', async () => {
    expect(await errs(CreateOrderDto, { ...base, deliveryAddress: { line1: '12 Main Rd' } })).toEqual([]);
  });
  it('rejects an unknown fulfillment and any client price field', async () => {
    expect(await errs(CreateOrderDto, { ...base, fulfillment: 'drone', deliveryAddress: { line1: 'x' } })).toContain('fulfillment');
    expect(await errs(CreateOrderDto, { ...base, fulfillment: 'pickup', totalPaise: 1 })).toContain('totalPaise');
  });
});

describe('QuoteOrderDto', () => {
  it('needs only lines', async () => expect(await errs(QuoteOrderDto, { lines: [line] })).toEqual([]));
  it('rejects an empty cart', async () => expect(await errs(QuoteOrderDto, { lines: [] })).toContain('lines'));
});
