import { useCallback, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { showError } from '@/components/error-toast';
import { logEvent } from '@/lib/logger';

/** Admin-only documents stay inside the app, in memory, with short-lived URLs. */
export default function AdminDocument() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [attempt, setAttempt] = useState(0);
  const title = kind === 'owner' ? 'Owner verification' : kind === 'renter' ? 'Renter identity review' : kind === 'lgu' ? 'LGU certificate' : kind === 'ownership' ? 'Ownership proof' : kind === 'refund' ? 'Refund proof' : 'Payment proof';
  useFocusEffect(useCallback(() => {
    let active = true;
    let release: (() => Promise<void>) | undefined;
    const captureKey = 'admin-document-' + id;
    setUri(''); setError(''); setLoaded(false); setStatus('');
    const state = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    void (async () => {
      try {
        if (!['owner','renter','lgu','ownership','payment','refund'].includes(kind) || !/^[\da-f-]{36}$/i.test(id || '')) throw new Error('This document link is invalid.');
        if (Platform.OS === 'android') {
          const capture = await import('expo-screen-capture');
          await capture.preventScreenCaptureAsync(captureKey);
          release = () => capture.allowScreenCaptureAsync(captureKey);
        }
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) throw new Error('Sign in again to view this document.');
        const admin = await supabase.from('admins').select('admin_id').eq('admin_id',auth.user.id).maybeSingle();
        if (admin.error || !admin.data) throw new Error('Administrator access is required.');
        let path = '';
        if (kind === 'owner') {
          const result = await supabase.from('owner_verifications').select('document_url,status').eq('verification_id',id).single();
          if (result.error) throw result.error;
          path = result.data.document_url; if (active) setStatus(result.data.status);
        } else if (kind === 'lgu') {
          const result = await supabase.from('lgu_certification_requests').select('proof_path,status').eq('certification_id',id).single();
          if (result.error) throw result.error;
          path = result.data.proof_path; if (active) setStatus(result.data.status);
        } else if (kind === 'ownership') {
          const result = await supabase.from('dorms').select('ownership_proof_url').eq('dorm_id',id).single();
          if (result.error) throw result.error; path = result.data.ownership_proof_url;
        } else {
          const result = await supabase.from('rental_requests').select('payment_proof_url,refund_proof_url,renter_gov_id_url').eq('request_id',id).single();
          if (result.error) throw result.error; path = kind === 'renter' ? result.data.renter_gov_id_url : kind === 'refund' ? result.data.refund_proof_url : result.data.payment_proof_url;
          if (kind === 'renter' && active) setStatus('pending');
        }
        if (!path) throw new Error('No document was attached. Ask the sender to upload it again.');
        if (/^https?:/i.test(path)) throw new Error('This old document is not in protected storage. Ask the sender to upload it again.');
        const result = await supabase.storage.from('private_documents').createSignedUrl(path,60);
        if (result.error || !result.data?.signedUrl) throw new Error('The protected image cannot be accessed. Check your connection and retry; if this continues, ask for a replacement document.');
        if (active) setUri(result.data.signedUrl);
      } catch (caught: any) {
        if (active) setError(caught.message || 'Document loading failed.');
        logEvent('warn','admin_document_load_failed',{ entityId: id, kind });
      }
    })();
    return () => { active = false; state.remove(); setUri(''); if (release) void release().catch(() => {}); };
    // attempt deliberately reloads a failed short-lived document URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt,id,kind]));
  const review = async (approved: boolean) => {
    if (busy || !loaded || status !== 'pending') return;
    setBusy(true);
    try {
      const result = kind === 'owner'
        ? await supabase.rpc('review_owner_verification',{ p_verification_id: id,p_approved: approved,p_notes: notes.trim() || null })
        : kind === 'renter' ? await supabase.rpc('admin_review_renter_identity',{ p_request_id: id,p_approved: approved })
        : await supabase.rpc('review_lgu_certification',{ p_certification_id: id,p_approved: approved });
      if (result.error) throw result.error;
      router.back();
    } catch (caught: any) { showError('Could not review',caught.message || 'Try again. Your review note has been kept.'); }
    finally { setBusy(false); }
  };
  return <View style={[styles.screen,{ paddingBottom: insets.bottom }]}><Stack.Screen options={{ headerShown: true,title,headerStyle: { backgroundColor: AppColors.background },headerTintColor: AppColors.text }} /><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {error ? <View style={styles.empty}><Text style={styles.error}>{error}</Text><Pressable onPress={() => setAttempt((value) => value+1)} style={styles.button}><Text style={styles.buttonText}>Retry loading</Text></Pressable></View> : <View style={styles.preview}>{uri && foreground ? <Image source={{ uri }} contentFit="contain" cachePolicy="none" style={styles.image} onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setError('The image could not be displayed. Retry loading it before making a decision.'); }} /> : <ActivityIndicator color={AppColors.accent} />}</View>}
    {['owner','renter','lgu'].includes(kind) && status === 'pending' && <View style={styles.review}><Text style={styles.help}>Check the document clearly before deciding. Approval becomes available when the image has loaded.</Text>{kind === 'owner' && <TextInput value={notes} onChangeText={setNotes} placeholder="Review note for the owner" placeholderTextColor={AppColors.placeholder} multiline maxLength={1000} style={styles.input} textAlignVertical="top" />}
      <View style={styles.actions}><Pressable disabled={!loaded || busy} onPress={() => void review(false)} style={[styles.button,styles.secondary,(!loaded || busy) && styles.disabled]}><Text style={styles.error}>Decline</Text></Pressable><Pressable disabled={!loaded || busy} onPress={() => void review(true)} style={[styles.button,(!loaded || busy) && styles.disabled]}>{busy ? <ActivityIndicator color={AppColors.white} /> : <Text style={styles.buttonText}>Approve</Text>}</Pressable></View>
    </View>}
  </ScrollView></View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1,backgroundColor: AppColors.background },content: { flexGrow: 1,padding: Spacing.three,gap: Spacing.three },preview: { minHeight: 360,height: 440,alignItems: 'center',justifyContent: 'center',backgroundColor: AppColors.black },image: { width: '100%',height: '100%' },empty: { paddingVertical: Spacing.six,gap: Spacing.three },error: { color: AppColors.error,fontSize: 14,lineHeight: 20 },review: { gap: Spacing.three },help: { color: AppColors.textSecondary,fontSize: 14,lineHeight: 21 },input: { minHeight: 88,color: AppColors.text,backgroundColor: AppColors.input,borderRadius: BorderRadius.md,borderCurve: 'continuous',padding: Spacing.three,borderWidth: StyleSheet.hairlineWidth,borderColor: AppColors.inputBorder },actions: { flexDirection: 'row',gap: Spacing.two,flexWrap: 'wrap' },button: { flexGrow: 1,minHeight: 48,alignItems: 'center',justifyContent: 'center',backgroundColor: AppColors.accent,padding: Spacing.three,borderRadius: BorderRadius.md,borderCurve: 'continuous' },secondary: { backgroundColor: AppColors.surfaceElevated },buttonText: { color: AppColors.white,fontWeight: '600' },disabled: { opacity: 0.4 },
});
