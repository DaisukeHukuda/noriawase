import type { SupabaseClient } from '@supabase/supabase-js';
import type { Community, MyCommunity } from './types';

export async function createCommunity(
  client: SupabaseClient,
  name: string,
): Promise<Community> {
  const { data, error } = await client.rpc('create_community', { p_name: name });
  if (error) throw error;
  return data as Community;
}

export async function joinByCode(
  client: SupabaseClient,
  code: string,
): Promise<Community> {
  const { data, error } = await client.rpc('join_community_by_code', { p_code: code });
  if (error) throw error;
  return data as Community;
}

export async function getCommunity(
  client: SupabaseClient,
  id: string,
): Promise<Community> {
  const { data, error } = await client
    .from('communities')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as Community;
}

export async function listMyCommunities(
  client: SupabaseClient,
  userId: string,
): Promise<MyCommunity[]> {
  const { data, error } = await client
    .from('community_memberships')
    .select('status, role, community:communities(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    status: r.status,
    role: r.role,
    community: r.community,
  })) as MyCommunity[];
}
