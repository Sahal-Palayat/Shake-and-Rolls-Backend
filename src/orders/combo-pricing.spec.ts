import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ComboDocument } from '../combos/schemas/combo.schema';
import { MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { applyCombos } from './combo-pricing';
import { priceLines } from './pricing';

const oid = () => new Types.ObjectId();
const rolls = oid();
const shakes = oid();
const fries = oid();
const mk = (name: string, cat: Types.ObjectId, pricePaise: number) => ({ _id: oid(), category: cat, name, isVeg: true, pricePaise, isAvailable: true, optionGroups: [] });
const roll = mk('Roll', rolls, 14000);
const shake = mk('Shake', shakes, 10000);
const fry = mk('Fries', fries, 9000);
const roll2 = mk('Roll 2', rolls, 15000);
const menu = new Map([roll, shake, fry, roll2].map((i) => [i._id.toHexString(), i as unknown as MenuItemDocument]));
const combo = {
  _id: oid(),
  name: 'Student combo',
  discountPercent: 15,
  isActive: true,
  slots: [
    { _id: oid(), label: 'Roll', category: rolls, isOptional: false },
    { _id: oid(), label: 'Shake', category: shakes, isOptional: false },
    { _id: oid(), label: 'Fries', category: fries, isOptional: true },
  ],
};
const cid = combo._id.toHexString();
const combos = new Map([[cid, combo as unknown as ComboDocument]]);
const line = (i: { _id: Types.ObjectId }, q = 1, ref?: string) => ({ menuItemId: i._id.toHexString(), quantity: q, ...(ref && { comboId: cid, comboRef: ref }) });
const run = (inputs: ReturnType<typeof line>[], c = combos) => applyCombos(inputs, priceLines(inputs, menu).lines, menu, c);

describe('applyCombos', () => {
  it('takes the percent off the combo lines only, rounded down', () => {
    const r = run([line(roll, 1, 'a'), line(shake, 1, 'a'), line(fry, 1, 'a'), line(roll2)]);
    expect(r.savingsPaise).toBe(Math.floor((14000 + 10000 + 9000) * 0.15));
    expect(r.lines[0]).toMatchObject({ comboRef: 'a', comboName: 'Student combo' });
    expect(r.lines[3].comboRef).toBeUndefined();
  });
  it('optional slot may be skipped; quantity multiplies', () => {
    const r = run([line(roll, 2, 'a'), line(shake, 2, 'a')]);
    expect(r.savingsPaise).toBe(Math.floor((14000 + 10000) * 2 * 0.15));
    expect(r.combos[0]).toMatchObject({ quantity: 2, itemsPaise: 48000 });
  });
  it('two groups of the same combo are priced separately', () => {
    const r = run([line(roll, 1, 'a'), line(shake, 1, 'a'), line(roll2, 1, 'b'), line(shake, 1, 'b')]);
    expect(r.combos).toHaveLength(2);
  });
  it('rejects a missing required slot, a doubled slot, mixed quantities, half-tagged lines', () => {
    expect(() => run([line(roll, 1, 'a'), line(fry, 1, 'a')])).toThrow(BadRequestException);
    expect(() => run([line(roll, 1, 'a'), line(roll2, 1, 'a'), line(shake, 1, 'a')])).toThrow(BadRequestException);
    expect(() => run([line(roll, 1, 'a'), line(shake, 2, 'a')])).toThrow(BadRequestException);
    expect(() => run([{ menuItemId: roll._id.toHexString(), quantity: 1, comboRef: 'a' } as never])).toThrow(BadRequestException);
  });
  it('unknown combo => 400, inactive => 422', () => {
    expect(() => run([line(roll, 1, 'a'), line(shake, 1, 'a')], new Map())).toThrow(BadRequestException);
    const off = new Map([[cid, { ...combo, isActive: false } as unknown as ComboDocument]]);
    expect(() => run([line(roll, 1, 'a'), line(shake, 1, 'a')], off)).toThrow(UnprocessableEntityException);
  });
});
