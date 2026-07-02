import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, FlatList, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import {
  addWatcherByEmail, listMyWatchers, removeWatcher, type Watcher,
} from '../../../src/features/watcher/watcherApi';

export default function Watchers() {
  const { session } = useAuth();
  const [items, setItems] = useState<Watcher[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      setItems(await listMyWatchers(supabase, session.user.id));
    } catch (e) {
      Alert.alert('読み込みエラー', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onAdd() {
    if (email.trim().length < 3) { Alert.alert('入力エラー', 'メールアドレスを入力してください'); return; }
    setBusy(true);
    try {
      await addWatcherByEmail(supabase, email.trim());
      setEmail('');
      Alert.alert('登録しました', '乗合の成立・到着をこの家族に通知します。');
      await load();
    } catch (e) {
      Alert.alert('登録できませんでした', 'このメールアドレスのアプリ利用者が見つかりません。家族が先にアプリで登録している必要があります。');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    try {
      await removeWatcher(supabase, id);
      await load();
    } catch (e) {
      Alert.alert('削除エラー', (e as Error).message);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>見守り家族</Text>
      <Text style={{ color: '#86868b' }}>
        登録した家族に、乗合の成立と到着を自動で通知します。家族もこのアプリの登録が必要です。
      </Text>
      <Text>家族のメールアドレス</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="family@example.com"
        style={{ borderWidth: 1, borderColor: '#d1d1d6', borderRadius: 8, padding: 12 }}
      />
      <Button title={busy ? '登録中…' : '見守り家族に追加'} onPress={onAdd} disabled={busy} />
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(w) => w.id}
          ListEmptyComponent={<Text style={{ color: '#86868b' }}>まだ登録がありません</Text>}
          renderItem={({ item }) => (
            <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee', flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, fontSize: 16 }}>{item.watcher?.full_name ?? '（氏名未取得）'}</Text>
              <Button title="解除" color="#ff3b30" onPress={() => onRemove(item.id)} />
            </View>
          )}
        />
      )}
    </View>
  );
}
