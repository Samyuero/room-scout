import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { showError } from '@/components/error-toast';

let supportSequence = 0;
export default function SupportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();
  const { new: startNew, requestId } = useLocalSearchParams<{ new?: string; requestId?: string }>();
  const [tickets,setTickets] = useState<any[]>([]);
  const [loading,setLoading] = useState(true);
  const [refreshing,setRefreshing] = useState(false);
  const [error,setError] = useState('');
  const [composing,setComposing] = useState(startNew === '1' || !!requestId);
  const [subject,setSubject] = useState(requestId ? 'Transaction concern' : '');
  const [description,setDescription] = useState('');
  const [sending,setSending] = useState(false);
  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const result = await supabase.from('support_tickets').select('*').eq('user_id',user.id).order('updated_at',{ ascending: false });
    if (result.error) setError('Your reports could not be refreshed. Check your connection and retry.');
    else { setTickets(result.data || []); setError(''); }
    setLoading(false); setRefreshing(false);
  },[user]);
  useFocusEffect(useCallback(() => { if (!authLoading) void load(); },[authLoading,load]));
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel('my-support-' + ++supportSequence).on('postgres_changes',{ event: '*',schema: 'public',table: 'support_tickets',filter: 'user_id=eq.' + user.id },() => void load()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  },[load,user]);
  const send = async () => {
    if (sending) return;
    if (subject.trim().length < 3 || description.trim().length < 5) return showError('Add report details','Enter a subject and a description of what happened.');
    setSending(true);
    try {
      const result = await supabase.rpc('create_support_ticket',{ p_subject: subject.trim(),p_description: description.trim(),p_related_request_id: requestId || null });
      if (result.error) throw result.error;
      setSubject(''); setDescription(''); setComposing(false);
      router.push({ pathname: '/support-ticket',params: { ticketId: String(result.data) } } as never);
    } catch (caught: any) { showError('Report not sent',caught.message || 'Please try again. Your draft is still here.'); }
    finally { setSending(false); }
  };
  return <View style={[styles.screen,{ paddingBottom: insets.bottom }]}><Stack.Screen options={{ headerShown: true,title: 'Help & reports',headerStyle: { backgroundColor: AppColors.background },headerTintColor: AppColors.text }} />{authLoading || loading ? <View style={styles.empty}><ActivityIndicator color={AppColors.accent} /></View> : !user ? <View style={styles.empty}><Text style={styles.title}>Sign in to contact SNAP</Text><Text style={styles.help}>Your reports and support replies stay with your account.</Text></View> : <FlatList data={tickets} keyExtractor={(item) => item.ticket_id} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={AppColors.accent} />} ListHeaderComponent={<View style={styles.header}><View style={styles.heading}><View style={styles.grow}><Text style={styles.title}>My reports</Text><Text style={styles.help}>View replies and follow your report’s progress.</Text></View><Pressable accessibilityLabel={composing ? 'Hide new report form' : 'Create a new report'} onPress={() => setComposing(!composing)} style={styles.iconButton}><Ionicons name={composing ? 'close' : 'add'} size={26} color={AppColors.accent} /></Pressable></View>{error ? <Pressable onPress={() => void load()}><Text style={styles.error}>{error}</Text></Pressable> : null}{composing && <View style={styles.form}><Text style={styles.subtitle}>Report an issue</Text><TextInput value={subject} onChangeText={setSubject} maxLength={120} placeholder="Subject" placeholderTextColor={AppColors.placeholder} style={styles.input} accessibilityLabel="Report subject" /><TextInput value={description} onChangeText={setDescription} maxLength={4000} placeholder="Tell us what happened" placeholderTextColor={AppColors.placeholder} style={[styles.input,styles.description]} multiline textAlignVertical="top" accessibilityLabel="Report details" /><Text style={styles.help}>Do not include passwords or OTPs. For payment concerns, reference the transaction instead.</Text><Pressable disabled={sending} onPress={() => void send()} style={({ pressed }) => [styles.button,(pressed || sending) && styles.dim]}>{sending ? <ActivityIndicator color={AppColors.white} /> : <Text style={styles.buttonText}>Send report</Text>}</Pressable></View>}</View>} renderItem={({ item }) => <Pressable onPress={() => router.push({ pathname: '/support-ticket',params: { ticketId: item.ticket_id } } as never)} style={({ pressed }) => [styles.ticket,pressed && styles.dim]}><Ionicons name={['resolved','closed'].includes(item.status) ? 'checkmark-circle-outline' : 'chatbubble-ellipses-outline'} size={24} color={AppColors.accent} /><View style={styles.grow}><Text style={styles.subtitle}>{item.subject}</Text><Text style={styles.help}>{item.status.replace('_',' ')} · {new Date(item.updated_at).toLocaleDateString()}</Text></View><Ionicons name="chevron-forward" size={20} color={AppColors.textSecondary} /></Pressable>} ListEmptyComponent={!composing ? <View style={styles.empty}><Ionicons name="chatbubbles-outline" size={40} color={AppColors.textMuted} /><Text style={styles.subtitle}>No reports yet</Text><Text style={styles.help}>Tap + to reach the SNAP team.</Text></View> : null} />}</View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1,backgroundColor: AppColors.background },content: { padding: Spacing.three,paddingBottom: Spacing.four,flexGrow: 1 },header: { gap: Spacing.three,paddingBottom: Spacing.three },heading: { flexDirection: 'row',alignItems: 'center',gap: Spacing.two },grow: { flex: 1,minWidth: 0,gap: Spacing.one },title: { color: AppColors.text,fontSize: 22,fontWeight: '700' },subtitle: { color: AppColors.text,fontSize: 16,fontWeight: '600' },help: { color: AppColors.textSecondary,fontSize: 14,lineHeight: 21 },iconButton: { minWidth: 48,minHeight: 48,alignItems: 'center',justifyContent: 'center' },form: { gap: Spacing.three,paddingVertical: Spacing.three },input: { backgroundColor: AppColors.input,color: AppColors.text,borderRadius: BorderRadius.md,borderCurve: 'continuous',borderWidth: StyleSheet.hairlineWidth,borderColor: AppColors.inputBorder,padding: Spacing.three,minHeight: 48,fontSize: 15 },description: { minHeight: 120 },button: { minHeight: 48,backgroundColor: AppColors.accent,borderRadius: BorderRadius.md,borderCurve: 'continuous',padding: Spacing.three,alignItems: 'center',justifyContent: 'center' },buttonText: { color: AppColors.white,fontWeight: '600',fontSize: 15 },dim: { opacity: 0.6 },ticket: { flexDirection: 'row',gap: Spacing.three,alignItems: 'center',paddingVertical: Spacing.three,borderBottomWidth: StyleSheet.hairlineWidth,borderBottomColor: AppColors.borderSubtle },empty: { flex: 1,padding: Spacing.four,alignItems: 'center',justifyContent: 'center',gap: Spacing.three },error: { color: AppColors.error,lineHeight: 20 },
});
