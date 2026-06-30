import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { getCommunity } from '../../../src/features/community/communityApi';
import {
  listMemberships,
  setMembershipStatus,
  removeMembership,
  type MembershipWithProfile,
} from '../../../src/features/community/membershipApi';
import type { Community } from '../../../src/features/community/types';

export default function CommunityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<MembershipWithProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const isOwner = !!community && !!session && community.owner_id === session.user.id;

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const c = await getCommunity(supabase, id);
      setCommunity(c);
      const m = await listMemberships(supabase, id);
      setMembers(m);
    } catch (e) {
      Alert.alert('読み込みエラー', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(fn: () => Promise<void>) {
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert('操作エラー', (e as Error).message);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!community) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text>コミュニティが見つかりません</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>{community.name}</Text>
      <Button
        title="「乗せて」と頼む"
        onPress={() => router.push(`/(app)/requests/create?communityId=${community.id}`)}
      />
      {isOwner && (
        <Text>
          招待コード：<Text selectable style={{ fontWeight: '700', letterSpacing: 2 }}>{community.invite_code}</Text>
        </Text>
      )}
      <Text style={{ fontSize: 16, fontWeight: '600', marginTop: 8 }}>
        メンバー{isOwner ? '（主催者として管理）' : ''}
      </Text>
      <FlatList
        data={members}
        keyExtractor={(m) => m.id}
        ListEmptyComponent={<Text style={{ color: '#86868b' }}>メンバーはいません</Text>}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', gap: 6 }}>
            <Text style={{ fontSize: 16 }}>
              {item.profile?.full_name ?? '（氏名未取得）'}
              {item.role === 'owner' ? '・主催者' : ''}（
              {item.status === 'pending' ? '申請中' : item.status === 'approved' ? '参加中' : '停止中'}）
            </Text>
            {isOwner && item.role !== 'owner' && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {item.status === 'pending' && (
                  <>
                    <Button title="承認" onPress={() => act(() => setMembershipStatus(supabase, item.id, 'approved'))} />
                    <Button title="却下" color="#ff3b30" onPress={() => act(() => removeMembership(supabase, item.id))} />
                  </>
                )}
                {item.status === 'approved' && (
                  <Button title="停止" color="#ff9f0a" onPress={() => act(() => setMembershipStatus(supabase, item.id, 'suspended'))} />
                )}
                {item.status === 'suspended' && (
                  <Button title="復帰" onPress={() => act(() => setMembershipStatus(supabase, item.id, 'approved'))} />
                )}
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}
