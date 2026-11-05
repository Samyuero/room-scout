import { useCallback, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';

/** Owner-only, in-memory ID preview. Never opens a browser or offers file export. */
export default function ViewId() {
  const { requestId, document } = useLocalSearchParams<{ requestId: string; document?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useFocusEffect(useCallback(() => {
    let active = true;
    const key = 'roomscout-owner-id';
    let releaseCapture: (() => Promise<void>) | null = null;
    setUri('');
    setError('');
    const appState = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    void (async () => {
      try {
        if (Platform.OS !== 'android') throw new Error('Protected ID viewing is available in the Android app.');
        const ScreenCapture = await import('expo-screen-capture');
        releaseCapture = () => ScreenCapture.allowScreenCaptureAsync(key);
        await ScreenCapture.preventScreenCaptureAsync(key);
        if (!active) { await ScreenCapture.allowScreenCaptureAsync(key); return; }
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError || !auth.user) throw new Error('Sign in to view this document.');
        const { data, error: requestError } = await supabase.from('rental_requests').select('owner_id,renter_gov_id_url,payment_proof_url').eq('request_id', requestId).eq('owner_id', auth.user.id).single();
        const path = document === 'payment' ? data?.payment_proof_url : data?.renter_gov_id_url;
        if (requestError || !path) throw new Error('This ID is unavailable or you do not own this request.');
        // Only private object paths are accepted; external URLs cannot bypass the protected viewer.
        if (/^https?:/i.test(path)) throw new Error('This legacy ID must be uploaded to secure storage again.');
        const { data: signed, error: storageError } = await supabase.storage.from('private_documents').createSignedUrl(path, 60);
        if (storageError || !signed?.signedUrl) throw new Error('The ID could not be loaded. Please try again.');
        if (active) setUri(signed.signedUrl);
      } catch (caught) {
        if (active) {
          const message = caught instanceof Error ? caught.message : 'Protected viewing could not start.';
          setError(/native module|cannot find|not available/i.test(message) ? 'Install the latest Android build to enable protected ID viewing.' : message);
        }
      }
    })();
    return () => {
      active = false;
      appState.remove();
      setUri('');
      if (releaseCapture) void releaseCapture().catch(() => {});
    };
  }, [requestId, document]));
  return <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <View style={styles.header}><Text style={styles.title}>{document === 'payment' ? 'Payment proof' : 'Government ID'}</Text><Pressable accessibilityLabel="Close protected ID" hitSlop={12} onPress={() => router.back()}><Ionicons name="close" color="#fff" size={28} /></Pressable></View>
    {error ? <Text style={styles.error}>{error}</Text> : uri && foreground ? <Image source={{ uri }} cachePolicy="none" contentFit="contain" style={styles.image} onError={() => setError('The ID image could not be displayed. Close and try again.')} /> : <View style={styles.loading}><ActivityIndicator color="#fff" /></View>}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  image: { flex: 1 },
  error: { color: '#fff', padding: 24, textAlign: 'center' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
