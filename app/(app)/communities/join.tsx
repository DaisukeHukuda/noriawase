import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { joinByCode } from '../../../src/features/community/communityApi';
import { normalizeInviteCode } from '../../../src/features/community/validation';

export default function JoinCommunity() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function onJoin() {
    const normalized = normalizeInviteCode(code);
    if (normalized.length < 4) { Alert.alert('入力エラー', '招待コードを入力してください'); return; }
    setBusy(true);
    try {
      const community = await joinByCode(supabase, normalized);
      Alert.alert('申請しました', `「${community.name}」への参加を申請しました。主催者の承認をお待ちください。`);
      router.replace('/(app)/communities');
    } catch (e) {
      Alert.alert('参加できませんでした', '招待コードを確認してください。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>コミュニティに参加</Text>
      <Text>招待コード（主催者からもらったコード）</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        placeholder="例: ABCD1234"
        style={{ borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12, letterSpacing: 2 }}
      />
      <Button title={busy ? '申請中…' : '参加を申請'} onPress={onJoin} disabled={busy} />
    </View>
  );
}
