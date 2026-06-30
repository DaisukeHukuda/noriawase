import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { createCommunity } from '../../../src/features/community/communityApi';
import { validateCommunityName } from '../../../src/features/community/validation';
import type { Community } from '../../../src/features/community/types';

export default function CreateCommunity() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Community | null>(null);

  async function onCreate() {
    const v = validateCommunityName(name);
    if (!v.ok) { Alert.alert('入力エラー', v.error); return; }
    setBusy(true);
    try {
      const community = await createCommunity(supabase, name);
      setCreated(community);
    } catch (e) {
      Alert.alert('作成できませんでした', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>「{created.name}」を作成しました</Text>
        <Text>仲間に渡す招待コード：</Text>
        <Text selectable style={{ fontSize: 28, fontWeight: '700', letterSpacing: 2 }}>
          {created.invite_code}
        </Text>
        <Text style={{ color: '#86868b' }}>このコードを伝えると、相手は「参加」から申請できます。</Text>
        <Button title="コミュニティを開く" onPress={() => router.replace(`/(app)/communities/${created.id}`)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>コミュニティを作成</Text>
      <Text>コミュニティ名（例：日光FCスポーツ少年団）</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="コミュニティ名"
        style={{ borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12 }}
      />
      <Button title={busy ? '作成中…' : '作成する'} onPress={onCreate} disabled={busy} />
    </View>
  );
}
