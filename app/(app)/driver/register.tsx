import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Button, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../../src/features/auth/useAuth';
import { supabase } from '../../../src/lib/supabase';
import { getDriverProfile, saveDriverProfile } from '../../../src/features/driver/driverApi';

export default function DriverRegister() {
  const { session } = useAuth();
  const router = useRouter();
  const [vehicleModel, setVehicleModel] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [insurance, setInsurance] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let active = true;
      setLoading(true);
      getDriverProfile(supabase, session.user.id)
        .then((d) => {
          if (!active || !d) return;
          setVehicleModel(d.vehicle_model ?? '');
          setLicensePlate(d.license_plate ?? '');
          setInsurance(d.insurance_confirmed);
        })
        .catch((e) => Alert.alert('読み込みエラー', (e as Error).message))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [session]),
  );

  async function onSave() {
    if (!session) return;
    if (vehicleModel.trim().length < 1 || licensePlate.trim().length < 1) {
      Alert.alert('入力エラー', '車種とナンバーを入力してください');
      return;
    }
    if (!insurance) {
      Alert.alert('確認', '安全のため、任意保険への加入確認が必要です');
      return;
    }
    setSaving(true);
    try {
      await saveDriverProfile(supabase, session.user.id, {
        vehicleModel: vehicleModel.trim(),
        licensePlate: licensePlate.trim(),
        insuranceConfirmed: insurance,
      });
      Alert.alert('登録しました', 'ドライバーとして登録されました');
      router.back();
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
      <Text style={{ fontSize: 22, fontWeight: '600' }}>ドライバー登録</Text>
      <Text>車種</Text>
      <TextInput
        value={vehicleModel}
        onChangeText={setVehicleModel}
        placeholder="例: 軽トラック / プリウス"
        style={inputStyle}
      />
      <Text>ナンバー</Text>
      <TextInput
        value={licensePlate}
        onChangeText={setLicensePlate}
        placeholder="例: 宇都宮 480 あ 12-34"
        style={inputStyle}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <Switch value={insurance} onValueChange={setInsurance} />
        <Text style={{ flex: 1 }}>任意保険に加入していることを確認しました</Text>
      </View>
      <Button title={saving ? '保存中…' : '登録する'} onPress={onSave} disabled={saving} />
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: '#d1d1d6',
  borderRadius: 8,
  padding: 12,
} as const;
