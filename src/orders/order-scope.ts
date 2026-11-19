import { Types } from 'mongoose';
import { Role } from '../common/enums';
import { AuthUser } from './current-user.decorator';

/** Ownership filter. Shared by REST (OrdersService) and Socket.IO (order:join) so the rule lives in one place. */
export function orderScope(user: AuthUser): Record<string, unknown> {
  switch (user.role) {
    case Role.Customer:
      return { customerId: new Types.ObjectId(user.id) };
    case Role.Rider:
      return { riderId: new Types.ObjectId(user.id) };
    default:
      return {};
  }
}
