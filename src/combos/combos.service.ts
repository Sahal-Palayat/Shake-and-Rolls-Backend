import { BadRequestException, ConflictException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MenuService } from '../menu/menu.service';
import { MenuItemDocument } from '../menu/schemas/menu-item.schema';
import { ComboSlotInputDto, CreateComboDto, UpdateComboDto } from './dto/combo.dto';
import { Combo, ComboDocument, ComboSlot } from './schemas/combo.schema';

const BY_ORDER = { sortOrder: 1, createdAt: 1, _id: 1 } as const;

const isDuplicateKey = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

@Injectable()
export class CombosService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(Combo.name) private readonly combos: Model<ComboDocument>,
    private readonly menu: MenuService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.combos.init();
  }

  listAll(): Promise<ComboDocument[]> {
    return this.combos.find().sort(BY_ORDER);
  }

  /** Bulk lookup for order pricing. Missing ids are simply absent. */
  findByIds(ids: string[]): Promise<ComboDocument[]> {
    return this.combos.find({ _id: { $in: ids } });
  }

  /**
   * Active combos with the items that can fill each slot. A combo is left out when a required slot has nothing
   * available, so the customer is never shown a combo they cannot complete.
   */
  async listPublic(): Promise<{ combo: ComboDocument; slots: { slot: ComboSlot; items: MenuItemDocument[] }[] }[]> {
    const [combos, menu] = await Promise.all([this.combos.find({ isActive: true }).sort(BY_ORDER), this.menu.getMenu()]);
    const byCat = new Map(menu.map((g) => [g.category.id as string, g.items.filter((i) => i.isAvailable)]));
    return combos
      .map((combo) => ({ combo, slots: combo.slots.map((slot) => ({ slot, items: byCat.get(slot.category.toHexString()) ?? [] })) }))
      .filter((c) => c.slots.every((s) => s.slot.isOptional || s.items.length > 0));
  }

  async create(dto: CreateComboDto): Promise<ComboDocument> {
    const slots = await this.toSlots(dto.slots);
    try {
      return await this.combos.create({ ...dto, slots });
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException('A combo with this name already exists');
      throw e;
    }
  }

  async update(id: string, dto: UpdateComboDto): Promise<ComboDocument> {
    const { slots, ...rest } = dto;
    const patch: Record<string, unknown> = { ...rest };
    if (slots !== undefined) patch.slots = await this.toSlots(slots);
    try {
      const doc = await this.combos.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true });
      if (!doc) throw new NotFoundException('Combo not found');
      return doc;
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException('A combo with this name already exists');
      throw e;
    }
  }

  async remove(id: string): Promise<void> {
    const res = await this.combos.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Combo not found');
  }

  private async toSlots(inputs: ComboSlotInputDto[]): Promise<Partial<ComboSlot>[]> {
    if (inputs.length < 2) throw new BadRequestException('A combo needs at least 2 slots');
    if (!inputs.some((s) => !s.isOptional)) throw new BadRequestException('A combo needs at least one required slot');
    const catIds = inputs.map((s) => s.categoryId);
    if (new Set(catIds).size !== catIds.length) throw new BadRequestException('Each slot must use a different category');
    const known = new Set((await this.menu.listCategories()).map((c) => c.id as string));
    for (const s of inputs) if (!known.has(s.categoryId)) throw new BadRequestException(`Slot "${s.label}": categoryId does not match any category`);
    return inputs.map((s) => ({
      ...(s.id && { _id: new Types.ObjectId(s.id) }),
      label: s.label,
      category: new Types.ObjectId(s.categoryId),
      isOptional: s.isOptional ?? false,
    })) as Partial<ComboSlot>[];
  }
}
