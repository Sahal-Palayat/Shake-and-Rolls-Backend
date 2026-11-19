import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RiderAvailabilityDto } from './dto/rider-availability.dto';
import { RiderPresence, RiderPresenceDocument } from './schemas/rider-presence.schema';

@Injectable()
export class RidersService {
  constructor(@InjectModel(RiderPresence.name) private readonly presence: Model<RiderPresenceDocument>) {}

  /** No row yet = offline. A rider must switch themselves on. */
  async get(riderId: string): Promise<RiderAvailabilityDto> {
    const row = await this.presence.findOne({ riderId: new Types.ObjectId(riderId) });
    return { riderId, isOnline: row?.isOnline ?? false };
  }

  async set(riderId: string, isOnline: boolean): Promise<RiderAvailabilityDto> {
    const row = await this.presence.findOneAndUpdate(
      { riderId: new Types.ObjectId(riderId) },
      { $set: { isOnline } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return { riderId, isOnline: row.isOnline };
  }

  /** Riders who are online. Riders with no row are offline, so they are simply absent. */
  async listOnline(): Promise<RiderAvailabilityDto[]> {
    const rows = await this.presence.find({ isOnline: true });
    return rows.map((r) => ({ riderId: r.riderId.toHexString(), isOnline: true }));
  }
}
