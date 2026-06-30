import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, Text, View } from 'react-native';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { listMyCommunities } from '../../../src/features/community/communityApi';
import type { MyCommunity } from '../../../src/features/community/types';

const STATUS_LABEL: Record<string, string> = {
  pending: '申請中',
  approved: '参加中',
  suspended: '停止中',
};

export default function CommunitiesIndex() {
  const { session } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<MyCommunity[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      setLoading(true);
      listMyCommunities(supabase, session.user.id)
        .then((rows) => { if (active) setItems(rows); })
        .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [session]),
  );

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>コミュニティ</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Button title="作成" onPress={() => router.push('/(app)/communities/create')} />
        <Button title="参加" onPress={() => router.push('/(app)/communities/join')} />
      </View>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.community.id}
          ListEmptyComponent={<Text style={{ color: '#86868b' }}>まだコミュニティがありません</Text>}
          renderItem={({ item }) => (
            <Link href={`/(app)/communities/${item.community.id}`} asChild>
              <Text style={{ paddingVertical: 12, fontSize: 16 }}>
                {item.community.name}（{STATUS_LABEL[item.status] ?? item.status}
                {item.role === 'owner' ? '・主催者' : ''}）
              </Text>
            </Link>
          )}
        />
      )}
    </View>
  );
}
