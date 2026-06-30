import { useContext } from 'react';
import { AuthContext } from './AuthProvider';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth は AuthProvider の内側で使ってください');
  }
  return ctx;
}
