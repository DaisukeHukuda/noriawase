import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { createRequest } from '../../../src/features/ride/rideRequestApi';
import { parseDepartAt, validateRideText } from '../../../src/features/ride/validation';

export default function CreateRequest() {
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const [departAt, setDepartAt] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    if (!session || !communityId) return;
    const t = parseDepartAt(departAt);
    if (!t.ok) { Alert.alert('入力エラー', t.error); return; }
    const v = validateRideText(origin, destination);
    if (!v.ok) { Alert.alert('入力エラー', v.error); return; }
    setBusy(true);
    try {
      const req = await createRequest(supabase, session.user.id, {
        communityId,
        departAt: t.iso,
        originText: origin.trim(),
        destinationText: destination.trim(),
        note: note.trim() || undefined,
      });
      Alert.alert('依頼を出しました', 'コミュニティのドライバーに届きました。');
      router.replace(`/(app)/requests/${req.id}`);
    } catch (e) {
      Alert.alert('依頼できませんでした', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>「乗せて」と頼む</Text>
      <Text>希望日時（例: 2026-07-01 09:30）</Text>
      <TextInput value={departAt} onChangeText={setDepartAt} placeholder="2026-07-01 09:30" style={inputStyle} />
      <Text>出発地</Text>
      <TextInput value={origin} onChangeText={setOrigin} placeholder="例: 自宅" style={inputStyle} />
      <Text>目的地</Text>
      <TextInput value={destination} onChangeText={setDestination} placeholder="例: 日光総合体育館" style={inputStyle} />
      <Text>メモ（任意）</Text>
      <TextInput value={note} onChangeText={setNote} placeholder="補足があれば" style={inputStyle} />
      <Button title={busy ? '送信中…' : 'この内容で頼む'} onPress={onSubmit} disabled={busy} />
    </View>
  );
}

const inputStyle = { borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12 } as const;
