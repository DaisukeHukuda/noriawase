import {
  createRequest, acceptRequest, cancelRequest, completeRequest,
  getRequest, listMyRequests, listOpenRequests,
} from './rideRequestApi';
import type { RideRequest } from './types';

const sample: RideRequest = {
  id: 'r1', community_id: 'c1', rider_id: 'u1',
  depart_at: '2026-07-01T00:30:00.000Z', origin_text: '自宅', destination_text: '体育館',
  note: null, status: 'open', driver_id: null, created_at: 't', updated_at: 't',
};

function rpcClient(result: { data: unknown; error: unknown }) {
  return { rpc: jest.fn().mockResolvedValue(result) } as any;
}
function insertClient(result: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  const from = jest.fn().mockReturnValue({ insert });
  return { client: { from } as any, from, insert };
}
function selectSingleClient(result: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as any, from };
}
function selectListClient(result: { data: unknown; error: unknown }) {
  const order = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select };
}
function updateClient(result: { error: unknown }) {
  const eq = jest.fn().mockResolvedValue(result);
  const update = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ update });
  return { client: { from } as any, update, eq };
}

describe('createRequest', () => {
  test('ride_requests に insert して返す', async () => {
    const { client, from } = insertClient({ data: sample, error: null });
    const res = await createRequest(client, 'u1', {
      communityId: 'c1', departAt: sample.depart_at, originText: '自宅', destinationText: '体育館',
    });
    expect(from).toHaveBeenCalledWith('ride_requests');
    expect(res).toEqual(sample);
  });
});

describe('acceptRequest', () => {
  test('rpc accept_ride_request を呼ぶ', async () => {
    const client = rpcClient({ data: { ...sample, status: 'matched', driver_id: 'd1' }, error: null });
    const res = await acceptRequest(client, 'r1');
    expect(client.rpc).toHaveBeenCalledWith('accept_ride_request', { p_request: 'r1' });
    expect(res.status).toBe('matched');
  });
  test('error は throw', async () => {
    const client = rpcClient({ data: null, error: { message: 'x' } });
    await expect(acceptRequest(client, 'r1')).rejects.toBeDefined();
  });
});

describe('cancel/complete', () => {
  test('cancelRequest は status=cancelled で update', async () => {
    const { client, update, eq } = updateClient({ error: null });
    await cancelRequest(client, 'r1');
    expect(update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(eq).toHaveBeenCalledWith('id', 'r1');
  });
  test('completeRequest は status=completed で update', async () => {
    const { client, update } = updateClient({ error: null });
    await completeRequest(client, 'r1');
    expect(update).toHaveBeenCalledWith({ status: 'completed' });
  });
});

describe('getRequest', () => {
  test('1件取得', async () => {
    const { client, from } = selectSingleClient({ data: sample, error: null });
    await expect(getRequest(client, 'r1')).resolves.toEqual(sample);
    expect(from).toHaveBeenCalledWith('ride_requests');
  });
});

describe('listMyRequests / listOpenRequests', () => {
  test('listMyRequests は rider_id で引く', async () => {
    const { client, from } = selectListClient({ data: [sample], error: null });
    await expect(listMyRequests(client, 'u1')).resolves.toEqual([sample]);
    expect(from).toHaveBeenCalledWith('ride_requests');
  });
  test('listOpenRequests は status=open で引く', async () => {
    const { client, from } = selectListClient({ data: [sample], error: null });
    await expect(listOpenRequests(client)).resolves.toEqual([sample]);
    expect(from).toHaveBeenCalledWith('ride_requests');
  });
});
