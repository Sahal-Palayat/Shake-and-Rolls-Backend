import { UserSummaryDto } from '../auth/dto/auth-response.dto';
import { UserDocument } from './user.schema';

export function toUserSummary(u: UserDocument): UserSummaryDto {
  return { id: u.id as string, role: u.role, name: u.name, username: u.username, phone: u.phone, isActive: u.isActive };
}
