import {
  listMemberships,
  setMembershipStatus,
  removeMembership,
} from './membershipApi';

describe('listMemberships', () => {
  test('community_id で引き profile を埋め込む', async () => {
    const rows = [
      { id: 'm1', community_id: 'c1', user_id: 'u2', status: 'pending', role: 'member',
        created_at: 't', updated_at: 't', profile: { full_name: '田中花子' } },
    ];
    const order = jest.fn().mockResolvedValue({ data: rows, error: null });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const client = { from } as any;
    const res = await listMemberships(client, 'c1');
    expect(from).toHaveBeenCalledWith('community_memberships');
    expect(res).toEqual(rows);
  });
});

describe('setMembershipStatus', () => {
  test('update().eq() を呼ぶ', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ update });
    const client = { from } as any;
    await setMembershipStatus(client, 'm1', 'approved');
    expect(update).toHaveBeenCalledWith({ status: 'approved' });
    expect(eq).toHaveBeenCalledWith('id', 'm1');
  });
  test('error は throw', async () => {
    const eq = jest.fn().mockResolvedValue({ error: { message: 'x' } });
    const update = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ update });
    const client = { from } as any;
    await expect(setMembershipStatus(client, 'm1', 'suspended')).rejects.toBeDefined();
  });
});

describe('removeMembership', () => {
  test('delete().eq() を呼ぶ', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ delete: del });
    const client = { from } as any;
    await removeMembership(client, 'm1');
    expect(eq).toHaveBeenCalledWith('id', 'm1');
  });
});
