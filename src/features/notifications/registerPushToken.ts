import type { SupabaseClient } from '@supabase/supabase-js';

export async function savePushToken(
  client: SupabaseClient,
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await client.from('push_tokens').upsert({ token, user_id: userId });
  if (error) throw error;
}
