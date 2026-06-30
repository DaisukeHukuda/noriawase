import { getDriverProfile, saveDriverProfile } from './driverApi';

describe('getDriverProfile', () => {
  test('行が無ければ null', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const client = { from } as any;
    await expect(getDriverProfile(client, 'u1')).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith('driver_profiles');
  });
});

describe('saveDriverProfile', () => {
  test('driver_profiles を upsert し profiles.is_driver を true に更新', async () => {
    const saved = {
      id: 'u1', vehicle_model: '軽トラ', license_plate: '宇都宮 480 あ 12-34',
      insurance_confirmed: true,
    };
    const dpSingle = jest.fn().mockResolvedValue({ data: saved, error: null });
    const dpSelect = jest.fn().mockReturnValue({ single: dpSingle });
    const upsert = jest.fn().mockReturnValue({ select: dpSelect });
    const pEq = jest.fn().mockResolvedValue({ error: null });
    const pUpdate = jest.fn().mockReturnValue({ eq: pEq });
    const from = jest.fn().mockImplementation((table: string) => {
      if (table === 'driver_profiles') return { upsert };
      if (table === 'profiles') return { update: pUpdate };
      throw new Error('unexpected table ' + table);
    });
    const client = { from } as any;
    const res = await saveDriverProfile(client, 'u1', {
      vehicleModel: '軽トラ',
      licensePlate: '宇都宮 480 あ 12-34',
      insuranceConfirmed: true,
    });
    expect(res).toEqual(saved);
    expect(upsert).toHaveBeenCalledWith({
      id: 'u1',
      vehicle_model: '軽トラ',
      license_plate: '宇都宮 480 あ 12-34',
      insurance_confirmed: true,
    });
    expect(pUpdate).toHaveBeenCalledWith({ is_driver: true });
    expect(pEq).toHaveBeenCalledWith('id', 'u1');
  });
});
