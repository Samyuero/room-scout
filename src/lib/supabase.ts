import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://dufanvbkysilzvuhpxqi.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_wWO83iqSA4HEHNaoJdMAOQ_UvYbpHPf';

/**
 * Cross-platform storage adapter for Supabase Auth.
 *
 * - Web: uses window.localStorage (always available in browsers).
 * - Native (Expo Go / dev build): uses an in-memory Map.
 *   @react-native-async-storage/async-storage v3.x ships a native module
 *   that isn't included in Expo Go, so importing it crashes with
 *   "Native module is null". A memory store avoids the crash entirely.
 *   Sessions won't survive an app restart, but auth-state-change listeners
 *   still work within a session.
 */
const createStorage = (): any => {
  if (Platform.OS === 'web') {
    // Supabase defaults to localStorage on web when storage is undefined
    return undefined;
  }

  // In-memory storage for native — no native-module dependency
  const memoryStore = new Map<string, string>();
  return {
    getItem: (key: string): string | null => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string): void => { memoryStore.set(key, value); },
    removeItem: (key: string): void => { memoryStore.delete(key); },
  };
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: createStorage(),
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});