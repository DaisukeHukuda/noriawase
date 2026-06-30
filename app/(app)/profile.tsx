import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Button, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../src/features/auth/useAuth';
import { supabase } from '../../src/lib/supabase';
import { getProfile, updateProfile } from '../../src/features/profile/profileApi';
import type { Profile } from '../../src/features/profile/types';

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    getProfile(supabase, session.user.id)
      .then((p) => {
        setProfile(p);
        setFullName(p.full_name);
        setPhone(p.phone ?? '');
      })
      .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
      .finally(() => setLoading(false));
  }, [session]);

  async function onSave() {
    if (!session) return;
    setSaving(true);
    try {
      const updated = await updateProfile(supabase, session.user.id, {
        full_name: fullName.trim(),
        phone: phone.trim() || null,
      });
      setProfile(updated);
      Alert.alert('保存しました');
    } catch (e) {
      Alert.alert('保存エラー', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>プロフィール</Text>
      <Text>氏名（実名）</Text>
      <TextInput value={fullName} onChangeText={setFullName} style={inputStyle} />
      <Text>電話番号（任意）</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        style={inputStyle}
      />
      <Button title={saving ? '保存中…' : '保存'} onPress={onSave} disabled={saving} />

      <View style={{ height: 16 }} />
      <Button title="コミュニティ" onPress={() => router.push('/(app)/communities')} />
      <View style={{ height: 8 }} />
      <Button
        title={profile?.is_driver ? 'ドライバー情報を編集' : 'ドライバー登録'}
        onPress={() => router.push('/(app)/driver/register')}
      />

      <View style={{ height: 16 }} />
      <Button title="ログアウト" color="#ff3b30" onPress={signOut} />
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: '#d1d1d6',
  borderRadius: 8,
  padding: 12,
} as const;
