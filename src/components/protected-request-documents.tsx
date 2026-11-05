import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { AppColors } from '@/constants/theme';
import { getPrivateDocumentUrl } from '@/utils/imageUpload';

export function ProtectedRequestDocuments({ requestId, idPath, paymentPath, onOpen }: { requestId: string; idPath: string; paymentPath?: string; onOpen: (document: 'id' | 'payment') => void }) {
  const [images, setImages] = useState<{ id: string; payment: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let release: (() => Promise<void>) | undefined;
    void (async () => {
      try {
        if (Platform.OS !== 'android') throw new Error('Protected previews require the Android app.');
        const capture = await import('expo-screen-capture');
        const key = 'request-preview-' + requestId;
        release = () => capture.allowScreenCaptureAsync(key);
        await capture.preventScreenCaptureAsync(key);
        if (!active) { await release(); return; }
        const [id, payment] = await Promise.all([getPrivateDocumentUrl(idPath), getPrivateDocumentUrl(paymentPath || '')]);
        if (active) setImages({ id, payment });
      } catch { if (active) setError('Install the latest Android build to view protected documents.'); }
    })();
    return () => { active = false; if (release) void release().catch(() => {}); };
  }, [requestId, idPath, paymentPath]);
  if (error) return <Text style={{ color: AppColors.textSecondary }}>{error}</Text>;
  if (!images) return <ActivityIndicator color={AppColors.accent} />;
  return <View style={{ gap: 12 }}>{(['id', 'payment'] as const).map((kind) => <View key={kind}><Text style={{ color: AppColors.textSecondary, marginBottom: 7 }}>{kind === 'id' ? 'Government ID' : 'Payment proof'}</Text>{images[kind] ? <Pressable onPress={() => onOpen(kind)}><Image source={{ uri: images[kind] }} cachePolicy="none" contentFit="contain" style={{ height: 150, width: '100%', backgroundColor: AppColors.background }} /></Pressable> : <Text style={{ color: AppColors.textMuted }}>Not provided</Text>}</View>)}</View>;
}
