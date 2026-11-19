import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { priceLines } from './pricing';

const oid = () => new Types.ObjectId();
const cheese = { _id: oid(), name: 'Extra cheese', priceDeltaPaise: 2000, isAvailable: true };
const jalap = { _id: oid(), name: 'Jalapeños', priceDeltaPaise: 1000, isAvailable: true };
const gone = { _id: oid(), name: 'Gone', priceDeltaPaise: 500, isAvailable: false };
const third = { _id: oid(), name: 'Sauce', priceDeltaPaise: 500, isAvailable: true };
const group = { _id: oid(), name: 'Add-ons', minSelect: 0, maxSelect: 2, options: [cheese, jalap, third, gone] };
const wrap = { _id: oid(), name: 'Paneer Wrap', isVeg: true, pricePaise: 14900, isAvailable: true, optionGroups: [group] };
const menu = new Map([[wrap._id.toHexString(), wrap as unknown as MenuItemDocument]]);
const id = wrap._id.toHexString();

describe('priceLines', () => {
  it('(base + options) x qty, from menu data only', () => {
    const r = priceLines([{ menuItemId: id, quantity: 2, optionIds: [cheese._id.toHexString(), jalap._id.toHexString()] }], menu);
    expect(r.totalPaise).toBe((14900 + 2000 + 1000) * 2);
    expect(r.lines[0]).toMatchObject({ unitPricePaise: 14900, lineTotalPaise: 35800, name: 'Paneer Wrap' });
  });
  it('sums multiple lines', () => {
    expect(priceLines([{ menuItemId: id, quantity: 1 }, { menuItemId: id, quantity: 3 }], menu).totalPaise).toBe(14900 * 4);
  });
  it('unknown item / foreign option / duplicate option => 400', () => {
    expect(() => priceLines([{ menuItemId: oid().toHexString(), quantity: 1 }], menu)).toThrow(BadRequestException);
    expect(() => priceLines([{ menuItemId: id, quantity: 1, optionIds: [oid().toHexString()] }], menu)).toThrow(BadRequestException);
    const c = cheese._id.toHexString();
    expect(() => priceLines([{ menuItemId: id, quantity: 1, optionIds: [c, c] }], menu)).toThrow(BadRequestException);
  });
  it('too many options => 400', () => {
    const ids = [cheese, jalap, third].map((o) => o._id.toHexString());
    expect(() => priceLines([{ menuItemId: id, quantity: 1, optionIds: ids }], menu)).toThrow(BadRequestException);
  });
  it('sold-out option / item => 422', () => {
    expect(() => priceLines([{ menuItemId: id, quantity: 1, optionIds: [gone._id.toHexString()] }], menu)).toThrow(UnprocessableEntityException);
    const off = new Map([[id, { ...wrap, isAvailable: false } as unknown as MenuItemDocument]]);
    expect(() => priceLines([{ menuItemId: id, quantity: 1 }], off)).toThrow(UnprocessableEntityException);
  });
  it('required group (min 1) enforced', () => {
    const req = { ...wrap, optionGroups: [{ ...group, minSelect: 1 }] } as unknown as MenuItemDocument;
    expect(() => priceLines([{ menuItemId: id, quantity: 1 }], new Map([[id, req]]))).toThrow(BadRequestException);
  });
});
