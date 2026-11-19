import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { OrderStatus, Role } from '../common/enums';
import { checkCashCollected } from './cash';

const base = { role: Role.Rider, to: OrderStatus.Delivered, paymentMethod: 'cod', totalPaise: 23000 };

describe('checkCashCollected', () => {
  it('rider delivering COD must report cash', () => {
    expect(() => checkCashCollected({ ...base })).toThrow(BadRequestException);
  });
  it('exact amount is accepted and returned', () => {
    expect(checkCashCollected({ ...base, cashCollectedPaise: 23000 })).toBe(23000);
  });
  it('wrong amount (short or over) is refused with the amount due', () => {
    expect(() => checkCashCollected({ ...base, cashCollectedPaise: 22000 })).toThrow(UnprocessableEntityException);
    expect(() => checkCashCollected({ ...base, cashCollectedPaise: 24000 })).toThrow(/Collect exactly ₹230/);
  });
  it('kitchen/admin may omit it; if they send it, it is checked', () => {
    expect(checkCashCollected({ ...base, role: Role.Kitchen })).toBeUndefined();
    expect(() => checkCashCollected({ ...base, role: Role.Admin, cashCollectedPaise: 1 })).toThrow(UnprocessableEntityException);
  });
  it('is rejected for any status other than delivered', () => {
    expect(() => checkCashCollected({ ...base, to: OrderStatus.PickedUp, cashCollectedPaise: 23000 })).toThrow(BadRequestException);
    expect(checkCashCollected({ ...base, to: OrderStatus.PickedUp })).toBeUndefined();
  });
  it('is rejected for non-COD orders', () => {
    expect(() => checkCashCollected({ ...base, paymentMethod: 'online', cashCollectedPaise: 23000 })).toThrow(BadRequestException);
    expect(checkCashCollected({ ...base, paymentMethod: 'online' })).toBeUndefined();
  });
  it('formats paise with decimals only when needed', () => {
    expect(() => checkCashCollected({ ...base, totalPaise: 23050, cashCollectedPaise: 1 })).toThrow(/₹230.50/);
  });
});
