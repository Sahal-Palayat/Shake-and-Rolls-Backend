import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { OrderLineInputDto } from './dto/order.dto';
import { OrderLine } from './schemas/order.schema';
import { Types } from 'mongoose';

/**
 * The ONLY place an order total is computed. Inputs from the client are ids and quantities;
 * every price comes from the menu documents passed in.
 */
export function priceLines(
  inputs: OrderLineInputDto[],
  menu: Map<string, MenuItemDocument>,
): { lines: OrderLine[]; totalPaise: number } {
  let totalPaise = 0;

  const lines = inputs.map((input, idx): OrderLine => {
    const at = `lines[${idx}]`;
    const item = menu.get(input.menuItemId);
    if (!item) throw new BadRequestException(`${at}: menu item not found`);
    if (!item.isAvailable) throw new UnprocessableEntityException(`${at}: "${item.name}" is currently unavailable`);

    const optionIds = input.optionIds ?? [];
    if (new Set(optionIds).size !== optionIds.length) throw new BadRequestException(`${at}: duplicate optionIds`);

    // Resolve every chosen id against THIS item's groups; anything else is a client error.
    const byId = new Map<string, { groupId: string; groupName: string; option: MenuItemDocument['optionGroups'][number]['options'][number] }>();
    for (const g of item.optionGroups) {
      for (const o of g.options) byId.set(o._id.toHexString(), { groupId: g._id.toHexString(), groupName: g.name, option: o });
    }
    const picked = optionIds.map((id) => {
      const hit = byId.get(id);
      if (!hit) throw new BadRequestException(`${at}: option ${id} does not belong to "${item.name}"`);
      if (!hit.option.isAvailable) throw new UnprocessableEntityException(`${at}: "${hit.option.name}" is currently unavailable`);
      return hit;
    });

    for (const g of item.optionGroups) {
      const n = picked.filter((p) => p.groupId === g._id.toHexString()).length;
      if (n < g.minSelect) throw new BadRequestException(`${at}: choose at least ${g.minSelect} from "${g.name}"`);
      if (n > g.maxSelect) throw new BadRequestException(`${at}: choose at most ${g.maxSelect} from "${g.name}"`);
    }

    const unit = item.pricePaise + picked.reduce((sum, p) => sum + p.option.priceDeltaPaise, 0);
    const lineTotalPaise = unit * input.quantity;
    totalPaise += lineTotalPaise;

    return {
      menuItemId: item._id as Types.ObjectId,
      name: item.name,
      isVeg: item.isVeg,
      unitPricePaise: item.pricePaise,
      options: picked.map((p) => ({
        optionId: p.option._id,
        groupName: p.groupName,
        name: p.option.name,
        priceDeltaPaise: p.option.priceDeltaPaise,
      })),
      quantity: input.quantity,
      lineTotalPaise,
      ...(input.note?.trim() && { note: input.note.trim() }),
    };
  });

  return { lines, totalPaise };
}
