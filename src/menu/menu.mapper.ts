import { CategoryDto } from './dto/category.dto';
import { MenuItemDto } from './dto/menu-item.dto';
import { CategoryDocument } from './schemas/category.schema';
import { MenuItemDocument } from './schemas/menu-item.schema';

export function toCategoryDto(c: CategoryDocument): CategoryDto {
  return { id: c.id as string, name: c.name, description: c.description, sortOrder: c.sortOrder };
}

export function toMenuItemDto(i: MenuItemDocument): MenuItemDto {
  return {
    id: i.id as string,
    categoryId: i.category.toHexString(),
    name: i.name,
    description: i.description,
    pricePaise: i.pricePaise,
    imageUrl: i.imageUrl,
    isVeg: i.isVeg,
    isAvailable: i.isAvailable,
    sortOrder: i.sortOrder,
    optionGroups: i.optionGroups.map((g) => ({
      id: g._id.toHexString(),
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options.map((o) => ({
        id: o._id.toHexString(),
        name: o.name,
        priceDeltaPaise: o.priceDeltaPaise,
        isAvailable: o.isAvailable,
      })),
    })),
  };
}
