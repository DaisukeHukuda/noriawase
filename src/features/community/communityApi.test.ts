import { createCommunity, joinByCode, getCommunity, listMyCommunities } from './communityApi';
import type { Community } from './types';

const sample: Community = {
  id: 'c1', name: '日光FC', invite_code: 'ABCD1234',
  owner_id: 'u1', created_at: 't', updated_at: 't',
};

function mockRpc(result: { data: unknown; error: unknown }) {
  return { rpc: jest.fn().mockResolvedValue(result) } as any;
}

function mockFromSingle(result: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, eq };
}

function mockFromList(result: { data: unknown; error: unknown }) {
  const eq = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, eq };
}

describe('createCommunity', () => {
  test('rpc create_community を呼び Community を返す', async () => {
    const client = mockRpc({ data: sample, error: null });
    await expect(createCommunity(client, '日光FC')).resolves.toEqual(sample);
    expect(client.rpc).toHaveBeenCalledWith('create_community', { p_name: '日光FC' });
  });
  test('error は throw', async () => {
    const client = mockRpc({ data: null, error: { message: 'x' } });
    await expect(createCommunity(client, '日光FC')).rejects.toBeDefined();
  });
});

describe('joinByCode', () => {
  test('rpc join_community_by_code を呼ぶ', async () => {
    const client = mockRpc({ data: sample, error: null });
    await expect(joinByCode(client, 'abcd1234')).resolves.toEqual(sample);
    expect(client.rpc).toHaveBeenCalledWith('join_community_by_code', { p_code: 'abcd1234' });
  });
});

describe('getCommunity', () => {
  test('communities を1件取得', async () => {
    const { client, from } = mockFromSingle({ data: sample, error: null });
    await expect(getCommunity(client, 'c1')).resolves.toEqual(sample);
    expect(from).toHaveBeenCalledWith('communities');
  });
});

describe('listMyCommunities', () => {
  test('memberships を user_id で引き community を埋め込んで返す', async () => {
    const rows = [{ status: 'approved', role: 'owner', community: sample }];
    const { client, from } = mockFromList({ data: rows, error: null });
    const res = await listMyCommunities(client, 'u1');
    expect(from).toHaveBeenCalledWith('community_memberships');
    expect(res).toEqual([{ status: 'approved', role: 'owner', community: sample }]);
  });
});
