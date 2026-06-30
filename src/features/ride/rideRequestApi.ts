import type { SupabaseClient } from '@supabase/supabase-js';
import type { RideRequest } from './types';

export type CreateRideInput = {
  communityId: string;
  departAt: string;
  originText: string;
  destinationText: string;
  note?: string;
};

export async function createRequest(
  client: SupabaseClient,
  riderId: string,
  input: CreateRideInput,
): Promise<RideRequest> {
  const { data, error } = await client
    .from('ride_requests')
    .insert({
      community_id: input.communityId,
      rider_id: riderId,
      depart_at: input.departAt,
      origin_text: input.originText,
      destination_text: input.destinationText,
      note: input.note ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as RideRequest;
}

export async function acceptRequest(
  client: SupabaseClient,
  requestId: string,
): Promise<RideRequest> {
  const { data, error } = await client.rpc('accept_ride_request', { p_request: requestId });
  if (error) throw error;
  return data as RideRequest;
}

export async function cancelRequest(client: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await client.from('ride_requests').update({ status: 'cancelled' }).eq('id', requestId);
  if (error) throw error;
}

export async function completeRequest(client: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await client.from('ride_requests').update({ status: 'completed' }).eq('id', requestId);
  if (error) throw error;
}

export async function getRequest(client: SupabaseClient, id: string): Promise<RideRequest> {
  const { data, error } = await client.from('ride_requests').select('*').eq('id', id).single();
  if (error) throw error;
  return data as RideRequest;
}

export async function listMyRequests(
  client: SupabaseClient,
  riderId: string,
): Promise<RideRequest[]> {
  const { data, error } = await client
    .from('ride_requests')
    .select('*')
    .eq('rider_id', riderId)
    .order('depart_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RideRequest[];
}

export async function listOpenRequests(client: SupabaseClient): Promise<RideRequest[]> {
  const { data, error } = await client
    .from('ride_requests')
    .select('*')
    .eq('status', 'open')
    .order('depart_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RideRequest[];
}
