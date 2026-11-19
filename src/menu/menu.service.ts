import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CreateMenuItemDto, OptionGroupInputDto, UpdateMenuItemDto } from './dto/menu-item.dto';
import { Category, CategoryDocument } from './schemas/category.schema';
import { MenuItem, MenuItemDocument, OptionGroup } from './schemas/menu-item.schema';

const BY_ORDER = { sortOrder: 1, createdAt: 1, _id: 1 } as const;

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** Shape check Mongoose can't express: min <= max <= option count, no duplicate ids. */
function toGroups(inputs: OptionGroupInputDto[]): Partial<OptionGroup>[] {
  const seen = new Set<string>();
  const claim = (id?: string) => {
    if (!id) return;
    if (seen.has(id)) throw new BadRequestException(`Duplicate option/group id ${id}`);
    seen.add(id);
  };
  return inputs.map((g) => {
    if (g.minSelect > g.maxSelect) throw new BadRequestException(`"${g.name}": minSelect cannot exceed maxSelect`);
    if (g.maxSelect > g.options.length) throw new BadRequestException(`"${g.name}": maxSelect exceeds number of options`);
    claim(g.id);
    return {
      ...(g.id && { _id: new Types.ObjectId(g.id) }),
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => {
        claim(o.id);
        return {
          ...(o.id && { _id: new Types.ObjectId(o.id) }),
          name: o.name,
          priceDeltaPaise: o.priceDeltaPaise,
          isAvailable: o.isAvailable ?? true,
        };
      }),
    };
  }) as Partial<OptionGroup>[];
}

@Injectable()
export class MenuService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(Category.name) private readonly categories: Model<CategoryDocument>,
    @InjectModel(MenuItem.name) private readonly items: Model<MenuItemDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([this.categories.init(), this.items.init()]); // indexes before traffic
  }

  // ---------- categories ----------

  listCategories(): Promise<CategoryDocument[]> {
    return this.categories.find().sort(BY_ORDER);
  }

  async createCategory(dto: CreateCategoryDto): Promise<CategoryDocument> {
    try {
      return await this.categories.create(dto);
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException('Category name already exists');
      throw e;
    }
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<CategoryDocument> {
    try {
      const doc = await this.categories.findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true });
      if (!doc) throw new NotFoundException('Category not found');
      return doc;
    } catch (e) {
      if (isDuplicateKey(e)) throw new ConflictException('Category name already exists');
      throw e;
    }
  }

  async deleteCategory(id: string): Promise<void> {
    if (await this.items.exists({ category: id })) {
      throw new ConflictException('Category still has items. Move or delete them first.');
    }
    const res = await this.categories.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Category not found');
  }

  // ---------- items ----------

  /** Customer menu: categories in order, each with its items. Empty categories are omitted. */
  async getMenu(): Promise<{ category: CategoryDocument; items: MenuItemDocument[] }[]> {
    const [cats, items] = await Promise.all([this.categories.find().sort(BY_ORDER), this.items.find().sort(BY_ORDER)]);
    const byCat = new Map<string, MenuItemDocument[]>();
    for (const i of items) {
      const key = i.category.toHexString();
      byCat.set(key, [...(byCat.get(key) ?? []), i]);
    }
    return cats
      .map((category) => ({ category, items: byCat.get(category.id as string) ?? [] }))
      .filter((g) => g.items.length > 0);
  }

  listItems(categoryId?: string): Promise<MenuItemDocument[]> {
    return this.items.find(categoryId ? { category: categoryId } : {}).sort(BY_ORDER);
  }

  /** Bulk lookup for order pricing. Missing ids are simply absent from the result. */
  findItemsByIds(ids: string[]): Promise<MenuItemDocument[]> {
    return this.items.find({ _id: { $in: ids } });
  }

  async getItem(id: string): Promise<MenuItemDocument> {
    const doc = await this.items.findById(id);
    if (!doc) throw new NotFoundException('Menu item not found');
    return doc;
  }

  async createItem(dto: CreateMenuItemDto): Promise<MenuItemDocument> {
    await this.assertCategoryExists(dto.categoryId);
    const { categoryId, optionGroups, ...rest } = dto;
    return this.items.create({
      ...rest,
      category: new Types.ObjectId(categoryId),
      optionGroups: toGroups(optionGroups ?? []),
    });
  }

  async updateItem(id: string, dto: UpdateMenuItemDto): Promise<MenuItemDocument> {
    const { categoryId, optionGroups, ...rest } = dto;
    const patch: Record<string, unknown> = { ...rest };
    if (categoryId !== undefined) {
      await this.assertCategoryExists(categoryId);
      patch.category = new Types.ObjectId(categoryId);
    }
    if (optionGroups !== undefined) patch.optionGroups = toGroups(optionGroups);

    const doc = await this.items.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true });
    if (!doc) throw new NotFoundException('Menu item not found');
    return doc;
  }

  async deleteItem(id: string): Promise<void> {
    const res = await this.items.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Menu item not found');
  }

  /** Touches ONLY isAvailable. This is the one write kitchen is allowed. */
  async setItemAvailability(id: string, isAvailable: boolean): Promise<MenuItemDocument> {
    const doc = await this.items.findByIdAndUpdate(id, { $set: { isAvailable } }, { new: true });
    if (!doc) throw new NotFoundException('Menu item not found');
    return doc;
  }

  /** Kitchen marks a single add-on sold out without hiding the whole item. */
  async setOptionAvailability(itemId: string, optionId: string, isAvailable: boolean): Promise<MenuItemDocument> {
    const doc = await this.items.findOneAndUpdate(
      { _id: itemId, 'optionGroups.options._id': optionId },
      { $set: { 'optionGroups.$[].options.$[o].isAvailable': isAvailable } },
      { new: true, arrayFilters: [{ 'o._id': new Types.ObjectId(optionId) }] },
    );
    if (!doc) throw new NotFoundException('Menu item or option not found');
    return doc;
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    if (!(await this.categories.exists({ _id: categoryId }))) {
      throw new BadRequestException('categoryId does not match any category');
    }
  }
}
