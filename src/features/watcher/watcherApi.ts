import type { SupabaseClient } from '@supabase/supabase-js';

export type Watcher = {
  id: string;
  user_id: string;
  watcher_user_id: string;
  created_at: string;
  watcher: { full_name: string } | null;
};

export async function addWatcherByEmail(
  client: SupabaseClient,
  email: string,
): Promise<void> {
  const { error } = await client.rpc('add_watcher_by_email', { p_email: email });
  if (error) throw error;
}

export async function listMyWatchers(
  client: SupabaseClient,
  userId: string,
): Promise<Watcher[]> {
  const { data, error } = await client
    .from('watchers')
    .select('*, watcher:profiles!watchers_watcher_user_id_fkey(full_name)')
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as Watcher[];
}

export async function removeWatcher(
  client: SupabaseClient,
  watcherId: string,
): Promise<void> {
  const { error } = await client.from('watchers').delete().eq('id', watcherId);
  if (error) throw error;
}
