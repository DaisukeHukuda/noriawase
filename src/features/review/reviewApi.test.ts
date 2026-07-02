import { submitReview, getMyReviewForRide } from './reviewApi';

describe('submitReview', () => {
  test('reviews に insert する', async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn().mockReturnValue({ insert });
    const client = { from } as any;
    await submitReview(client, {
      rideRequestId: 'r1', reviewerId: 'u1', revieweeId: 'u2',
      rating: 'good', comment: 'ありがとうございました',
    });
    expect(from).toHaveBeenCalledWith('reviews');
    expect(insert).toHaveBeenCalledWith({
      ride_request_id: 'r1', reviewer_id: 'u1', reviewee_id: 'u2',
      rating: 'good', comment: 'ありがとうございました',
    });
  });
  test('error は throw', async () => {
    const insert = jest.fn().mockResolvedValue({ error: { message: 'x' } });
    const from = jest.fn().mockReturnValue({ insert });
    const client = { from } as any;
    await expect(submitReview(client, {
      rideRequestId: 'r1', reviewerId: 'u1', revieweeId: 'u2', rating: 'problem',
    })).rejects.toBeDefined();
  });
});

describe('getMyReviewForRide', () => {
  test('自分のレビューを1件取得（無ければ null）', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    const eq2 = jest.fn().mockReturnValue({ maybeSingle });
    const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
    const select = jest.fn().mockReturnValue({ eq: eq1 });
    const from = jest.fn().mockReturnValue({ select });
    const client = { from } as any;
    await expect(getMyReviewForRide(client, 'r1', 'u1')).resolves.toBeNull();
    expect(from).toHaveBeenCalledWith('reviews');
  });
});
