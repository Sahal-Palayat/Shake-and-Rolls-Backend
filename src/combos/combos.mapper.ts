import { ComboDto, ComboSlotDto } from './dto/combo.dto';
import { ComboDocument, ComboSlot } from './schemas/combo.schema';

export const toComboSlotDto = (s: ComboSlot): ComboSlotDto => ({
  id: s._id.toHexString(),
  label: s.label,
  categoryId: s.category.toHexString(),
  isOptional: s.isOptional,
});

export function toComboDto(c: ComboDocument): ComboDto {
  return {
    id: c.id as string,
    name: c.name,
    description: c.description,
    discountPercent: c.discountPercent,
    slots: c.slots.map(toComboSlotDto),
    isActive: c.isActive,
    sortOrder: c.sortOrder,
  };
}
