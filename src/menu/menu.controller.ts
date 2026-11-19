import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalParseObjectIdPipe, ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { Role } from '../common/enums';
import { CategoryDto, CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import {
  CreateMenuItemDto,
  MenuCategoryDto,
  MenuItemDto,
  SetAvailabilityDto,
  UpdateMenuItemDto,
} from './dto/menu-item.dto';
import { toCategoryDto, toMenuItemDto } from './menu.mapper';
import { MenuService } from './menu.service';

@ApiTags('menu')
@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  // ---------- public reads ----------

  @Public()
  @Get()
  @ApiOkResponse({ type: [MenuCategoryDto], description: 'Customer menu. Categories with no items are omitted.' })
  async getMenu(): Promise<MenuCategoryDto[]> {
    return (await this.menu.getMenu()).map(({ category, items }) => ({
      ...toCategoryDto(category),
      items: items.map(toMenuItemDto),
    }));
  }

  @Public()
  @Get('categories')
  @ApiOkResponse({ type: [CategoryDto] })
  async listCategories(): Promise<CategoryDto[]> {
    return (await this.menu.listCategories()).map(toCategoryDto);
  }

  @Public()
  @Get('items')
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiOkResponse({ type: [MenuItemDto] })
  async listItems(@Query('categoryId', OptionalParseObjectIdPipe) categoryId?: string): Promise<MenuItemDto[]> {
    return (await this.menu.listItems(categoryId)).map(toMenuItemDto);
  }

  @Public()
  @Get('items/:id')
  @ApiOkResponse({ type: MenuItemDto })
  async getItem(@Param('id', ParseObjectIdPipe) id: string): Promise<MenuItemDto> {
    return toMenuItemDto(await this.menu.getItem(id));
  }

  // ---------- admin writes: categories ----------

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Post('categories')
  @ApiCreatedResponse({ type: CategoryDto })
  async createCategory(@Body() dto: CreateCategoryDto): Promise<CategoryDto> {
    return toCategoryDto(await this.menu.createCategory(dto));
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Patch('categories/:id')
  @ApiOkResponse({ type: CategoryDto })
  async updateCategory(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryDto> {
    return toCategoryDto(await this.menu.updateCategory(id, dto));
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Delete('categories/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async deleteCategory(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    await this.menu.deleteCategory(id);
  }

  // ---------- admin writes: items ----------

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Post('items')
  @ApiCreatedResponse({ type: MenuItemDto })
  async createItem(@Body() dto: CreateMenuItemDto): Promise<MenuItemDto> {
    return toMenuItemDto(await this.menu.createItem(dto));
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Patch('items/:id')
  @ApiOkResponse({ type: MenuItemDto })
  async updateItem(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateMenuItemDto): Promise<MenuItemDto> {
    return toMenuItemDto(await this.menu.updateItem(id, dto));
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Delete('items/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async deleteItem(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    await this.menu.deleteItem(id);
  }

  // ---------- availability: admin + kitchen ----------

  @ApiBearerAuth()
  @Roles(Role.Admin, Role.Kitchen)
  @Patch('items/:id/availability')
  @ApiOkResponse({ type: MenuItemDto })
  async setItemAvailability(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<MenuItemDto> {
    return toMenuItemDto(await this.menu.setItemAvailability(id, dto.isAvailable));
  }

  @ApiBearerAuth()
  @Roles(Role.Admin, Role.Kitchen)
  @Patch('items/:id/options/:optionId/availability')
  @ApiOkResponse({ type: MenuItemDto })
  async setOptionAvailability(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('optionId', ParseObjectIdPipe) optionId: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<MenuItemDto> {
    return toMenuItemDto(await this.menu.setOptionAvailability(id, optionId, dto.isAvailable));
  }
}
