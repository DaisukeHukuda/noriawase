import { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/features/auth/useAuth';

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace('/(app)/profile');
    } catch (e) {
      Alert.alert('ログインできませんでした', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: 'center' }}>
      <Text style={{ fontSize: 22, fontWeight: '600' }}>ログイン</Text>
      <Text>メールアドレス</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        style={inputStyle}
      />
      <Text>パスワード</Text>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry style={inputStyle} />
      <Button title={busy ? 'ログイン中…' : 'ログイン'} onPress={onSubmit} disabled={busy} />
      <Link href="/(auth)/sign-up" style={{ marginTop: 12, color: '#0071e3' }}>
        新規登録はこちら
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
