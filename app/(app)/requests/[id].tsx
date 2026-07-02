import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import {
  getRequest, acceptRequest, cancelRequest, completeRequest,
} from '../../../src/features/ride/rideRequestApi';
import type { RideRequest } from '../../../src/features/ride/types';
import {
  getMyReviewForRide, submitReview, type Review, type ReviewRating,
} from '../../../src/features/review/reviewApi';

const STATUS_LABEL: Record<string, string> = {
  open: '募集中', matched: '成立', completed: '完了', cancelled: 'キャンセル',
};

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [req, setReq] = useState<RideRequest | null>(null);
  const [myReview, setMyReview] = useState<Review | null>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await getRequest(supabase, id);
      setReq(r);
      if (session && r.status === 'completed'
          && (r.rider_id === session.user.id || r.driver_id === session.user.id)) {
        setMyReview(await getMyReviewForRide(supabase, r.id, session.user.id));
      }
    } catch (e) {
      Alert.alert('読み込みエラー', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, session]);

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

  async function onReview(rating: ReviewRating) {
    if (!req || !session) return;
    const revieweeId = session.user.id === req.rider_id ? req.driver_id : req.rider_id;
    if (!revieweeId) return;
    await act(
      () => submitReview(supabase, {
        rideRequestId: req.id,
        reviewerId: session.user.id,
        revieweeId,
        rating,
        comment: comment.trim() || undefined,
      }),
      rating === 'good' ? 'ありがとうございました' : '報告しました。主催者が確認します',
    );
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
  const isParticipant = isRider || isDriver;

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
      {req.status === 'matched' && isParticipant && (
        <Button title={busy ? '処理中…' : '完了にする'} disabled={busy}
          onPress={() => act(() => completeRequest(supabase, req.id), '完了しました')} />
      )}
      {isRider && (req.status === 'open' || req.status === 'matched') && (
        <Button title={busy ? '処理中…' : 'キャンセル'} color="#ff3b30" disabled={busy}
          onPress={() => act(() => cancelRequest(supabase, req.id), 'キャンセルしました')} />
      )}

      {req.status === 'completed' && isParticipant && (
        myReview ? (
          <View style={{ marginTop: 12, gap: 4 }}>
            <Text style={{ fontWeight: '600' }}>評価済み</Text>
            <Text>{myReview.rating === 'good' ? '無事着きました' : '問題を報告しました'}</Text>
            {myReview.comment ? <Text style={{ color: '#86868b' }}>{myReview.comment}</Text> : null}
          </View>
        ) : (
          <View style={{ marginTop: 12, gap: 8 }}>
            <Text style={{ fontWeight: '600' }}>今回の乗合はいかがでしたか？</Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="コメント（任意）"
              style={{ borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12 }}
            />
            <Button title={busy ? '送信中…' : '無事着きました'} disabled={busy}
              onPress={() => onReview('good')} />
            <Button title={busy ? '送信中…' : '問題を報告する'} color="#ff3b30" disabled={busy}
              onPress={() => onReview('problem')} />
          </View>
        )
      )}
    </View>
  );
}
