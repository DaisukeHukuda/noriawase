import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile, ProfilePatch } from './types';

export async function getProfile(
  client: SupabaseClient,
  userId: string,
): Promise<Profile> {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(
  client: SupabaseClient,
  userId: string,
  patch: ProfilePatch,
): Promise<Profile> {
  const { data, error } = await client
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as Profile;
}
