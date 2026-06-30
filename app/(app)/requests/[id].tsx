import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import {
  getRequest, acceptRequest, cancelRequest, completeRequest,
} from '../../../src/features/ride/rideRequestApi';
import type { RideRequest } from '../../../src/features/ride/types';

const STATUS_LABEL: Record<string, string> = {
  open: '募集中', matched: '成立', completed: '完了', cancelled: 'キャンセル',
};

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [req, setReq] = useState<RideRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setReq(await getRequest(supabase, id));
    } catch (e) {
      Alert.alert('読み込みエラー', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function act(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true);
    try {
      await fn();
      Alert.alert(okMsg);
      await load();
    } catch (e) {
      Alert.alert('操作エラー', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }
  if (!req) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text>見つかりません</Text></View>;
  }

  const me = session?.user.id;
  const isRider = me === req.rider_id;
  const isDriver = me === req.driver_id;

  return (
    <View style={{ flex: 1, padding: 24, gap: 10 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>{req.origin_text} → {req.destination_text}</Text>
      <Text>{new Date(req.depart_at).toLocaleString('ja-JP')}</Text>
      <Text>状態：{STATUS_LABEL[req.status] ?? req.status}</Text>
      {req.note ? <Text>メモ：{req.note}</Text> : null}

      {req.status === 'open' && !isRider && (
        <Button title={busy ? '処理中…' : '乗せます'} disabled={busy}
          onPress={() => act(() => acceptRequest(supabase, req.id), '成立しました')} />
      )}
      {req.status === 'matched' && (isRider || isDriver) && (
        <Button title={busy ? '処理中…' : '完了にする'} disabled={busy}
          onPress={() => act(() => completeRequest(supabase, req.id), '完了しました')} />
      )}
      {isRider && (req.status === 'open' || req.status === 'matched') && (
        <Button title={busy ? '処理中…' : 'キャンセル'} color="#ff3b30" disabled={busy}
          onPress={() => act(() => cancelRequest(supabase, req.id), 'キャンセルしました')} />
      )}
    </View>
  );
}
