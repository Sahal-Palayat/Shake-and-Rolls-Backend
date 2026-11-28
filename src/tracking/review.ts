import { OrderStatus } from '../common/enums';
import { MAX_REVIEW_COMMENT_LENGTH } from './tracking.constants';

/** Pure review rules (no Nest, no DB). */

/** The moment the order was delivered: the last status-log entry that moved it to Delivered. Falls back to updatedAt. */
export function deliveredAtOf(order: { statusLog: { to: OrderStatus; at: Date }[]; updatedAt: Date }): Date {
  for (let i = order.statusLog.length - 1; i >= 0; i--) {
    if (order.statusLog[i].to === OrderStatus.Delivered) return order.statusLog[i].at;
  }
  return order.updatedAt;
}

/** The last instant a review is accepted through a review token. */
export function reviewDeadline(deliveredAt: Date, windowDays: number): Date {
  return new Date(deliveredAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
}

/** Trim, drop control characters (keeps newlines), collapse blank-line runs, cap the length. Empty becomes undefined. */
export function normalizeComment(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_REVIEW_COMMENT_LENGTH)
    .trim();
  return cleaned || undefined;
}
