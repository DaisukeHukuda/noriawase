import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/features/auth/useAuth';

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    try {
      await signUp({ fullName, email, password });
      router.replace('/(app)/profile');
    } catch (e) {
      Alert.alert('登録できませんでした', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>新規登録</Text>
      <Text>実名（本人確認のため必須）</Text>
      <TextInput
        value={fullName}
        onChangeText={setFullName}
        placeholder="例: 田中 花子"
        style={inputStyle}
      />
      <Text>メールアドレス</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="hanako@example.com"
        style={inputStyle}
      />
      <Text>パスワード（8文字以上）</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={inputStyle}
      />
      <Button title={busy ? '登録中…' : '登録する'} onPress={onSubmit} disabled={busy} />
      <Link href="/(auth)/sign-in" style={{ marginTop: 12, color: '#0071e3' }}>
        すでに登録済みの方はこちら
      </Link>
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: '#d1d1d6',
  borderRadius: 8,
  padding: 12,
} as const;
