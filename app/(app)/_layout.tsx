import { Stack } from 'expo-router';
import { usePushRegistration } from '../../src/features/notifications/usePushRegistration';

export default function AppLayout() {
  usePushRegistration();
  return <Stack screenOptions={{ headerShown: true }} />;
}
