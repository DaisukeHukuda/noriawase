import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../../lib/supabase';
import { savePushToken } from './registerPushToken';
import { useAuth } from '../auth/useAuth';

// ログイン後にプッシュ権限を求め、Expoトークンを取得して push_tokens に保存する。
// ベストエフォート: 権限拒否・projectId未設定・Expo Go 等で失敗しても黙って無視する。
export function usePushRegistration() {
  const { session } = useAuth();
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await Notifications.getPermissionsAsync();
        let granted = current.granted;
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.granted;
        }
        if (!granted) return;
        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          Constants.easConfig?.projectId;
        const tokenResp = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        if (!cancelled && tokenResp?.data) {
          await savePushToken(supabase, session.user.id, tokenResp.data);
        }
      } catch {
        // best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);
}
