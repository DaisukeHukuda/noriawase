import type { SupabaseClient } from '@supabase/supabase-js';

export type ReviewRating = 'good' | 'problem';

export type Review = {
  id: string;
  ride_request_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: ReviewRating;
  comment: string | null;
  created_at: string;
};

export type SubmitReviewInput = {
  rideRequestId: string;
  reviewerId: string;
  revieweeId: string;
  rating: ReviewRating;
  comment?: string;
};

export async function submitReview(
  client: SupabaseClient,
  input: SubmitReviewInput,
): Promise<void> {
  const { error } = await client.from('reviews').insert({
    ride_request_id: input.rideRequestId,
    reviewer_id: input.reviewerId,
    reviewee_id: input.revieweeId,
    rating: input.rating,
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
  });
  if (error) throw error;
}

export async function getMyReviewForRide(
  client: SupabaseClient,
  rideRequestId: string,
  userId: string,
): Promise<Review | null> {
  const { data, error } = await client
    .from('reviews')
    .select('*')
    .eq('ride_request_id', rideRequestId)
    .eq('reviewer_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as Review) ?? null;
}
