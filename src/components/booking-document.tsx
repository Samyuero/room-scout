import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

/** Private booking evidence: short-lived access, no disk cache or export action. */
export function BookingDocument({ path, label }: { path?: string | null; label: string }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let release: (() => Promise<void>) | undefined;
    setUrl(''); setError('');
    if (!path) return;
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    void (async () => {
      try {
        if (Platform.OS !== 'android') throw new Error('Open the Android app to view protected booking images.');
        if (/^https?:/i.test(path)) throw new Error('This legacy document must be uploaded to protected storage again.');
        const capture = await import('expo-screen-capture');
        const key = 'booking-document-' + path;
        await capture.preventScreenCaptureAsync(key);
        release = () => capture.allowScreenCaptureAsync(key);
        if (!active) { await release(); return; }
        const { data, error: signingError } = await supabase.storage.from('private_documents').createSignedUrl(path, 60);
        if (signingError || !data?.signedUrl) throw new Error('This image could not be accessed. Please retry.');
        if (active) setUrl(data.signedUrl);
      } catch (cause: any) { if (active) setError(cause.message || 'Image unavailable. Please retry.'); }
    })();
    return () => { active = false; subscription.remove(); if (release) void release().catch(() => {}); };
  }, [path, retry]);
  if (!path) return null;
  return <View style={styles.group}>
    <Text style={styles.label}>{label}</Text>
    {error ? <Pressable onPress={() => setRetry((n) => n + 1)}><Text style={styles.error}>{error} Tap to retry.</Text></Pressable>
      : url ? <Pressable accessibilityLabel={'View ' + label} onPress={() => { setRetry((n) => n + 1); setOpen(true); }}>
        {foreground && <Image source={{ uri: url }} cachePolicy="none" contentFit="contain" style={styles.preview} onError={() => setError('Image expired or unavailable.')} />}
      </Pressable> : <ActivityIndicator color={AppColors.accent} />}
    <Modal visible={open} onRequestClose={() => setOpen(false)} animationType="fade">
      <SafeAreaView style={styles.viewer}>
        <Pressable accessibilityLabel="Close image" style={styles.close} onPress={() => setOpen(false)}><Ionicons name="close" size={28} color={AppColors.text} /></Pressable>
        {foreground && url ? <Image source={{ uri: url }} cachePolicy="none" contentFit="contain" style={styles.fullImage} /> : <ActivityIndicator color={AppColors.accent} />}
      </SafeAreaView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  group: { gap: 8 }, label: { color: AppColors.textSecondary, fontSize: 13 }, error: { color: AppColors.error, lineHeight: 21 },
  preview: { height: 160, width: '100%', backgroundColor: AppColors.background }, viewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  close: { position: 'absolute', right: 12, top: 20, zIndex: 1, padding: 12 }, fullImage: { flex: 1, width: '100%' },
});
