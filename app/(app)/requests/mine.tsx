import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { listMyRequests } from '../../../src/features/ride/rideRequestApi';
import type { RideRequest } from '../../../src/features/ride/types';

const STATUS_LABEL: Record<string, string> = {
  open: '募集中', matched: '成立', completed: '完了', cancelled: 'キャンセル',
};

export default function MyRequests() {
  const { session } = useAuth();
  const [items, setItems] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      setLoading(true);
      listMyRequests(supabase, session.user.id)
        .then((rows) => { if (active) setItems(rows); })
        .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [session]),
  );

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>自分のリクエスト</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={<Text style={{ color: '#86868b' }}>まだリクエストがありません</Text>}
          renderItem={({ item }) => (
            <Link href={`/(app)/requests/${item.id}`} asChild>
              <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                <Text style={{ fontSize: 16 }}>{item.origin_text} → {item.destination_text}</Text>
                <Text style={{ color: '#86868b' }}>
                  {new Date(item.depart_at).toLocaleString('ja-JP')}（{STATUS_LABEL[item.status] ?? item.status}）
                </Text>
              </View>
            </Link>
          )}
        />
      )}
    </View>
  );
}
