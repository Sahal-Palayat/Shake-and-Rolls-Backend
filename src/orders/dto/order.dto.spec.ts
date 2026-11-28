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
  it('delivery with an address and a GPS point is valid', async () => {
    expect(await errs(CreateOrderDto, { ...base, deliveryAddress: { line1: '12 Main Rd', latitude: 11.8745, longitude: 75.3704 } })).toEqual([]);
  });
  it('delivery needs the GPS point: an address alone is not enough', async () => {
    const r = await validate(plainToInstance(CreateOrderDto, { ...base, deliveryAddress: { line1: '12 Main Rd' } }), { whitelist: true, forbidNonWhitelisted: true });
    expect(JSON.stringify(r)).toMatch(/latitude/);
    expect(JSON.stringify(r)).toMatch(/longitude/);
  });
  it('rejects out-of-range or non-numeric coordinates', async () => {
    for (const bad of [{ latitude: 91, longitude: 75 }, { latitude: 11, longitude: 181 }, { latitude: '11.8', longitude: 75 }, { latitude: NaN, longitude: 75 }]) {
      const r = await validate(plainToInstance(CreateOrderDto, { ...base, deliveryAddress: { line1: 'x', ...bad } }), { whitelist: true, forbidNonWhitelisted: true });
      expect(r.length).toBeGreaterThan(0);
    }
  });
  it('accepts the optional door details and location metadata', async () => {
    const deliveryAddress = { line1: '12 Main Rd', latitude: 11.8745, longitude: 75.3704, locationSource: 'pin', placeId: 'abc', formattedAddress: '12 Main Rd, Kannur', houseName: 'Rose Villa', buildingName: 'Sea View', floor: '3', landmark: 'Old Bank' };
    expect(await errs(CreateOrderDto, { ...base, deliveryAddress })).toEqual([]);
    const r = await validate(plainToInstance(CreateOrderDto, { ...base, deliveryAddress: { ...deliveryAddress, locationSource: 'teleport' } }), { whitelist: true, forbidNonWhitelisted: true });
    expect(r.length).toBeGreaterThan(0);
  });
  it('rejects an unknown fulfillment and any client price field', async () => {
    expect(await errs(CreateOrderDto, { ...base, fulfillment: 'drone', deliveryAddress: { line1: 'x', latitude: 11, longitude: 75 } })).toContain('fulfillment');
    expect(await errs(CreateOrderDto, { ...base, fulfillment: 'pickup', totalPaise: 1 })).toContain('totalPaise');
  });
});

describe('QuoteOrderDto', () => {
  it('needs only lines', async () => expect(await errs(QuoteOrderDto, { lines: [line] })).toEqual([]));
  it('rejects an empty cart', async () => expect(await errs(QuoteOrderDto, { lines: [] })).toContain('lines'));
});
