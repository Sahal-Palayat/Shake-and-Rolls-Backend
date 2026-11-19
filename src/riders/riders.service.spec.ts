import { Types } from 'mongoose';
import { RidersService } from './riders.service';

const id = new Types.ObjectId();

function setup(row: { isOnline: boolean } | null) {
  const calls: any[] = [];
  const model: any = {
    findOne: async () => row,
    findOneAndUpdate: async (f: any, u: any, o: any) => { calls.push({ f, u, o }); return { isOnline: u.$set.isOnline }; },
    find: async () => [{ riderId: id, isOnline: true }],
  };
  return { svc: new RidersService(model), calls };
}

describe('RidersService', () => {
  it('a rider with no row is offline', async () => {
    expect(await setup(null).svc.get(id.toHexString())).toEqual({ riderId: id.toHexString(), isOnline: false });
  });
  it('reads the stored flag', async () => {
    expect((await setup({ isOnline: true }).svc.get(id.toHexString())).isOnline).toBe(true);
  });
  it('set upserts one row for this rider only', async () => {
    const { svc, calls } = setup(null);
    expect((await svc.set(id.toHexString(), true)).isOnline).toBe(true);
    expect(calls[0].f.riderId.equals(id)).toBe(true);
    expect(calls[0].o.upsert).toBe(true);
  });
  it('lists online riders as string ids', async () => {
    expect(await setup(null).svc.listOnline()).toEqual([{ riderId: id.toHexString(), isOnline: true }]);
  });
});
