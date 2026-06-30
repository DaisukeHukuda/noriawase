import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { listOpenRequests } from '../../../src/features/ride/rideRequestApi';
import type { RideRequest } from '../../../src/features/ride/types';

export default function OpenRequests() {
  const { session } = useAuth();
  const [items, setItems] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      listOpenRequests(supabase)
        .then((rows) => {
          if (!active) return;
          const mine = session?.user.id;
          setItems(rows.filter((r) => r.rider_id !== mine));
        })
        .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [session]),
  );

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>募集中の乗合</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={<Text style={{ color: '#86868b' }}>いまは募集がありません</Text>}
          renderItem={({ item }) => (
            <Link href={`/(app)/requests/${item.id}`} asChild>
              <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
                <Text style={{ fontSize: 16 }}>{item.origin_text} → {item.destination_text}</Text>
                <Text style={{ color: '#86868b' }}>{new Date(item.depart_at).toLocaleString('ja-JP')}</Text>
              </View>
            </Link>
          )}
        />
      )}
    </View>
  );
}
