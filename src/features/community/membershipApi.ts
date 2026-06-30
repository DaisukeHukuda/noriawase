import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommunityMembership, MembershipStatus } from './types';

export type MembershipWithProfile = CommunityMembership & {
  profile: { full_name: string } | null;
};

export async function listMemberships(
  client: SupabaseClient,
  communityId: string,
): Promise<MembershipWithProfile[]> {
  const { data, error } = await client
    .from('community_memberships')
    .select('*, profile:profiles(full_name)')
    .eq('community_id', communityId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MembershipWithProfile[];
}

export async function setMembershipStatus(
  client: SupabaseClient,
  membershipId: string,
  status: MembershipStatus,
): Promise<void> {
  const { error } = await client
    .from('community_memberships')
    .update({ status })
    .eq('id', membershipId);
  if (error) throw error;
}

export async function removeMembership(
  client: SupabaseClient,
  membershipId: string,
): Promise<void> {
  const { error } = await client
    .from('community_memberships')
    .delete()
    .eq('id', membershipId);
  if (error) throw error;
}
