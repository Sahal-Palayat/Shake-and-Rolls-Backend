import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MenuModule } from '../menu/menu.module';
import { CombosController } from './combos.controller';
import { CombosService } from './combos.service';
import { Combo, ComboSchema } from './schemas/combo.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Combo.name, schema: ComboSchema }]), MenuModule],
  controllers: [CombosController],
  providers: [CombosService],
  exports: [CombosService], // orders price combo discounts
})
export class CombosModule {}
