import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { sha256 } from 'js-sha256';
import * as Crypto from 'expo-crypto';

// Polyfill WebCrypto API for Supabase Auth PKCE flow on React Native / Expo
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {};
}

const gCrypto = globalThis.crypto as any;

if (!gCrypto.getRandomValues) {
  gCrypto.getRandomValues = Crypto.getRandomValues;
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

// Keep dot notation: Expo replaces these references inside the APK bundle.
const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const clientKey = supabasePublishableKey.trim();

function hasValidConnectionSettings() {
  try {
    const url = new URL(supabaseUrl);
    const localDevelopment = __DEV__ && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname);
    return (url.protocol === 'https:' || (localDevelopment && url.protocol === 'http:'))
      && !url.username && !url.password && !url.search && !url.hash && ['', '/'].includes(url.pathname)
      && !/placeholder|your[_-]?project|example|\.invalid$|\.test$/i.test(url.hostname)
      && (__DEV__ || !['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname))
      && (/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(clientKey) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(clientKey));
  } catch { return false; }
}

export const isSupabaseConfigured = hasValidConnectionSettings();
export const supabaseConfigurationMessage = isSupabaseConfigured
  ? null
  : 'This build is missing valid Supabase settings. Configure the EAS preview environment and rebuild the APK. For local development, check .env.';

// An invalid build is stopped at the root layout. The SDK still needs a URL to
// construct its client, but this reserved address is NEVER sent to the network.
const blockedFetch: typeof fetch = async () => { throw new Error(supabaseConfigurationMessage || 'RoomScout is not configured.'); };
export const supabase = createClient(isSupabaseConfigured ? supabaseUrl : 'https://not-configured.invalid', isSupabaseConfigured ? clientKey : 'not-configured', {
  ...(!isSupabaseConfigured ? { global: { fetch: blockedFetch } } : {}),

  auth: {
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    flowType: 'pkce',
    autoRefreshToken: isSupabaseConfigured,
    persistSession: isSupabaseConfigured,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

if (Platform.OS !== 'web' && isSupabaseConfigured) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
