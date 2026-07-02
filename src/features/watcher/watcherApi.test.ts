import { addWatcherByEmail, listMyWatchers, removeWatcher } from './watcherApi';

describe('addWatcherByEmail', () => {
  test('rpc add_watcher_by_email を呼ぶ', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    const client = { rpc } as any;
    await addWatcherByEmail(client, 'family@example.com');
    expect(rpc).toHaveBeenCalledWith('add_watcher_by_email', { p_email: 'family@example.com' });
  });
  test('error は throw', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: { message: 'user not found' } });
    const client = { rpc } as any;
    await expect(addWatcherByEmail(client, 'x@example.com')).rejects.toBeDefined();
  });
});

describe('listMyWatchers', () => {
  test('watchers を user_id で引き watcher の氏名を埋め込む', async () => {
    const rows = [
      { id: 'w1', user_id: 'u1', watcher_user_id: 'u2', created_at: 't',
        watcher: { full_name: '家族花子' } },
    ];
    const eq = jest.fn().mockResolvedValue({ data: rows, error: null });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    const client = { from } as any;
    const res = await listMyWatchers(client, 'u1');
    expect(from).toHaveBeenCalledWith('watchers');
    expect(res).toEqual(rows);
  });
});

describe('removeWatcher', () => {
  test('delete().eq() を呼ぶ', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ delete: del });
    const client = { from } as any;
    await removeWatcher(client, 'w1');
    expect(eq).toHaveBeenCalledWith('id', 'w1');
  });
});
