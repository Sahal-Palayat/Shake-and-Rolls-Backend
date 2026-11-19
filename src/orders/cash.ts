import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { OrderStatus, Role } from '../common/enums';

export type CashCheckInput = {
  role: Role;
  to: OrderStatus;
  paymentMethod: string;
  totalPaise: number;
  /** What the client sent (paise). */
  cashCollectedPaise?: number;
};

const rupees = (paise: number) => `₹${Number.isInteger(paise / 100) ? paise / 100 : (paise / 100).toFixed(2)}`;

/**
 * The cash rule for COD delivery. Returns the amount to record, or undefined when there is nothing to record.
 *  - A rider marking a COD order delivered MUST report the cash, and it must equal the order total.
 *  - Kitchen/admin may omit it (counter hand-over, admin fix-ups); if they send it, it is checked the same way.
 *  - It is rejected for any other status, and for non-COD orders.
 */
export function checkCashCollected(i: CashCheckInput): number | undefined {
  const sent = i.cashCollectedPaise;
  const delivering = i.to === OrderStatus.Delivered;
  const cod = i.paymentMethod === 'cod';

  if (sent !== undefined && !delivering) throw new BadRequestException('cashCollectedPaise is only allowed when marking an order delivered');
  if (sent !== undefined && !cod) throw new BadRequestException('cashCollectedPaise is only for cash-on-delivery orders');

  if (!delivering || !cod) return undefined;
  if (sent === undefined) {
    if (i.role === Role.Rider) throw new BadRequestException('Enter the cash you collected (cashCollectedPaise) to mark this delivered');
    return undefined;
  }
  if (sent !== i.totalPaise) {
    throw new UnprocessableEntityException(`Collect exactly ${rupees(i.totalPaise)} for this order. You entered ${rupees(sent)}.`);
  }
  return sent;
}

export { rupees as formatRupees };
