import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ComboDocument } from '../combos/schemas/combo.schema';
import { MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { OrderLineInputDto } from './dto/order.dto';
import { AppliedCombo, OrderLine } from './schemas/order.schema';

/**
 * Applies combo savings to lines that priceLines() has already priced. Lines are grouped by `comboRef` (a client
 * label, so two of the same combo in one cart stay separate). Each group must be a valid fill of its combo:
 * every line in a different slot, every required slot filled, the same quantity on every line (= how many combos).
 * Savings = discountPercent of the group's line totals, rounded down to the paisa.
 */
export function applyCombos(
  inputs: OrderLineInputDto[],
  lines: OrderLine[],
  menu: Map<string, MenuItemDocument>,
  combos: Map<string, ComboDocument>,
): { lines: OrderLine[]; combos: AppliedCombo[]; savingsPaise: number } {
  const groups = new Map<string, number[]>();
  inputs.forEach((input, idx) => {
    const at = `lines[${idx}]`;
    if (!input.comboId && !input.comboRef) return;
    if (!input.comboId || !input.comboRef) throw new BadRequestException(`${at}: comboId and comboRef go together`);
    groups.set(input.comboRef, [...(groups.get(input.comboRef) ?? []), idx]);
  });

  const out = [...lines];
  const applied: AppliedCombo[] = [];
  for (const [ref, idxs] of groups) {
    const at = `combo "${ref}"`;
    const comboIds = new Set(idxs.map((i) => inputs[i].comboId));
    if (comboIds.size !== 1) throw new BadRequestException(`${at}: every line must have the same comboId`);
    const combo = combos.get([...comboIds][0]!);
    if (!combo) throw new BadRequestException(`${at}: combo not found`);
    if (!combo.isActive) throw new UnprocessableEntityException(`${at}: "${combo.name}" is not available right now`);

    const quantities = new Set(idxs.map((i) => inputs[i].quantity));
    if (quantities.size !== 1) throw new BadRequestException(`${at}: every item in a combo must have the same quantity`);

    const used = new Set<string>();
    for (const i of idxs) {
      const item = menu.get(inputs[i].menuItemId);
      const slot = item && combo.slots.find((s) => s.category.equals(item.category));
      if (!item || !slot) throw new BadRequestException(`${at}: "${lines[i].name}" does not fit any slot of "${combo.name}"`);
      const sid = slot._id.toHexString();
      if (used.has(sid)) throw new BadRequestException(`${at}: two items for the "${slot.label}" slot`);
      used.add(sid);
    }
    const missing = combo.slots.find((s) => !s.isOptional && !used.has(s._id.toHexString()));
    if (missing) throw new BadRequestException(`${at}: choose a ${missing.label.toLowerCase()}`);

    const itemsPaise = idxs.reduce((sum, i) => sum + lines[i].lineTotalPaise, 0);
    const savingsPaise = Math.floor((itemsPaise * combo.discountPercent) / 100);
    for (const i of idxs) out[i] = { ...out[i], comboRef: ref, comboName: combo.name };
    applied.push({
      comboId: combo._id as Types.ObjectId,
      comboRef: ref,
      name: combo.name,
      discountPercent: combo.discountPercent,
      quantity: [...quantities][0]!,
      itemsPaise,
      savingsPaise,
    });
  }
  return { lines: out, combos: applied, savingsPaise: applied.reduce((s, c) => s + c.savingsPaise, 0) };
}
