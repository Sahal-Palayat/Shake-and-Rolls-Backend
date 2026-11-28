import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { Role } from '../common/enums';
import { toMenuItemDto } from '../menu/menu.mapper';
import { ComboDto, CreateComboDto, PublicComboDto, UpdateComboDto } from './dto/combo.dto';
import { toComboDto, toComboSlotDto } from './combos.mapper';
import { CombosService } from './combos.service';

@ApiTags('combos')
@Controller('combos')
export class CombosController {
  constructor(private readonly combos: CombosService) {}

  @Public()
  @Get()
  @ApiOkResponse({ type: [PublicComboDto], description: 'Active combos the customer can complete right now, with the items for each slot.' })
  async listPublic(): Promise<PublicComboDto[]> {
    return (await this.combos.listPublic()).map(({ combo, slots }) => ({
      id: combo.id as string,
      name: combo.name,
      description: combo.description,
      discountPercent: combo.discountPercent,
      slots: slots.map(({ slot, items }) => ({ ...toComboSlotDto(slot), items: items.map(toMenuItemDto) })),
    }));
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Get('all')
  @ApiOkResponse({ type: [ComboDto], description: 'Every combo, including inactive ones.' })
  async listAll(): Promise<ComboDto[]> {
    return (await this.combos.listAll()).map(toComboDto);
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Post()
  @ApiCreatedResponse({ type: ComboDto })
  async create(@Body() dto: CreateComboDto): Promise<ComboDto> {
    return toComboDto(await this.combos.create(dto));
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Patch(':id')
  @ApiOkResponse({ type: ComboDto })
  async update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateComboDto): Promise<ComboDto> {
    return toComboDto(await this.combos.update(id, dto));
  }

  @ApiBearerAuth()
  @Roles(Role.Admin)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    await this.combos.remove(id);
  }
}
