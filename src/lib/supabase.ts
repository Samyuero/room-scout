import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';

// Polyfill WebCrypto API for Supabase Auth PKCE flow on React Native / Expo
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {};
}

const gCrypto = globalThis.crypto as any;

if (!gCrypto.getRandomValues) {
  gCrypto.getRandomValues = (array: any) => {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
}

if (!gCrypto.subtle) {
  Object.defineProperty(gCrypto, 'subtle', {
    value: {
      digest: async (algorithm: string | { name: string }, data: any) => {
        const algoName = typeof algorithm === 'string' ? algorithm : algorithm?.name;
        if (algoName === 'SHA-256' || algoName === 'SHA256') {
          return sha256.arrayBuffer(data);
        }
        throw new Error(`Algorithm ${algoName} is not supported by Crypto polyfill.`);
      },
    },
    writable: true,
    configurable: true,
  });
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
export const supabaseConfigurationMessage = isSupabaseConfigured
  ? null
  : 'Supabase is not configured. Copy .env.example to .env and add the project URL and publishable key.';

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabasePublishableKey || 'placeholder-anon-key', {

  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
