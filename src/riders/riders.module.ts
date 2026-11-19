import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RidersController } from './riders.controller';
import { RidersService } from './riders.service';
import { RiderPresence, RiderPresenceSchema } from './schemas/rider-presence.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: RiderPresence.name, schema: RiderPresenceSchema }])],
  controllers: [RidersController],
  providers: [RidersService],
})
export class RidersModule {}
