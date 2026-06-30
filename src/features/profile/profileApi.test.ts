import { getProfile, updateProfile } from './profileApi';
import type { Profile } from './types';

const sample: Profile = {
  id: 'u1',
  full_name: '田中花子',
  phone: null,
  avatar_url: null,
  is_driver: false,
};

// Supabase のクエリビルダ（.from().select().eq().single() 等）を最小限モック
function makeClient(result: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(result);
  const eqSelect = { select: jest.fn().mockReturnValue({ single }) };
  const eq = jest.fn().mockReturnValue({ single, ...eqSelect });
  const builder = {
    select: jest.fn().mockReturnValue({ eq }),
    update: jest.fn().mockReturnValue({ eq }),
  };
  const from = jest.fn().mockReturnValue(builder);
  return { from } as any;
}

describe('getProfile', () => {
  test('成功時に Profile を返す', async () => {
    const client = makeClient({ data: sample, error: null });
    await expect(getProfile(client, 'u1')).resolves.toEqual(sample);
    expect(client.from).toHaveBeenCalledWith('profiles');
  });

  test('error があれば throw する', async () => {
    const client = makeClient({ data: null, error: { message: 'boom' } });
    await expect(getProfile(client, 'u1')).rejects.toBeDefined();
  });
});

describe('updateProfile', () => {
  test('成功時に更新後の Profile を返す', async () => {
    const updated = { ...sample, full_name: '田中はな' };
    const client = makeClient({ data: updated, error: null });
    await expect(
      updateProfile(client, 'u1', { full_name: '田中はな' }),
    ).resolves.toEqual(updated);
  });
});
