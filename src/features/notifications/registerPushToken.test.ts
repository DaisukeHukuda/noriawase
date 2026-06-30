import { savePushToken } from './registerPushToken';

describe('savePushToken', () => {
  test('push_tokens に upsert する', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ upsert });
    const client = { from } as any;
    await savePushToken(client, 'u1', 'ExponentPushToken[abc]');
    expect(from).toHaveBeenCalledWith('push_tokens');
    expect(upsert).toHaveBeenCalledWith({ token: 'ExponentPushToken[abc]', user_id: 'u1' });
  });
  test('error は throw', async () => {
    const upsert = jest.fn().mockResolvedValue({ error: { message: 'x' } });
    const from = jest.fn().mockReturnValue({ upsert });
    const client = { from } as any;
    await expect(savePushToken(client, 'u1', 't')).rejects.toBeDefined();
  });
});
