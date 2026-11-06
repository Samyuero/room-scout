import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Host, Picker, Switch } from '@expo/ui';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { showError } from '@/components/error-toast';

let ticketSequence = 0;
const statuses = [{ value: 'open',label: 'Open' },{ value: 'in_progress',label: 'In review' },{ value: 'resolved',label: 'Resolved' },{ value: 'closed',label: 'Closed' }];
export default function SupportTicketScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user,loading: authLoading } = useAuth();
  const [ticket,setTicket] = useState<any>(null);
  const [messages,setMessages] = useState<any[]>([]);
  const [accounts,setAccounts] = useState<any[]>([]);
  const [isAdmin,setIsAdmin] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [body,setBody] = useState('');
  const [internal,setInternal] = useState(false);
  const [sending,setSending] = useState(false);
  const [saving,setSaving] = useState(false);
  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const [ticketResult,messageResult,roleResult] = await Promise.all([
      supabase.from('support_tickets').select('*').eq('ticket_id',ticketId).single(),
      supabase.from('support_messages').select('*').eq('ticket_id',ticketId).order('created_at',{ ascending: true }).order('message_id'),
      supabase.from('admins').select('admin_id').eq('admin_id',user.id).maybeSingle(),
    ]);
    if (ticketResult.error || messageResult.error) setError(ticketResult.error ? 'This report is unavailable or does not belong to your account.' : 'Replies could not be loaded. Check your connection and retry.');
    else { setTicket(ticketResult.data); setMessages(messageResult.data || []); setError(''); }
    const admin = !!roleResult.data && !roleResult.error;
    setIsAdmin(admin);
    if (admin) {
      const directory = await supabase.rpc('admin_list_accounts');
      if (!directory.error) setAccounts(directory.data || []);
    }
    setLoading(false);
  },[ticketId,user]);
  useFocusEffect(useCallback(() => { if (!authLoading) void load(); },[authLoading,load]));
  useEffect(() => {
    if (!user || !ticketId) return;
    const channel = supabase.channel('support-conversation-' + ++ticketSequence)
      .on('postgres_changes',{ event: '*',schema: 'public',table: 'support_messages',filter: 'ticket_id=eq.' + ticketId },() => void load())
      .on('postgres_changes',{ event: '*',schema: 'public',table: 'support_tickets',filter: 'ticket_id=eq.' + ticketId },() => void load()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  },[load,ticketId,user]);
  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const result = await supabase.rpc('send_support_message',{ p_ticket_id: ticketId,p_body: body.trim(),p_internal: isAdmin && internal });
      if (result.error) throw result.error;
      setBody(''); await load();
    } catch (caught: any) { showError('Message not sent',caught.message || 'Your draft has been kept. Please retry.'); }
    finally { setSending(false); }
  };
  const saveTicket = async (status: string,adminId: string | null) => {
    if (saving || !isAdmin) return;
    setSaving(true);
    try {
      const result = await supabase.rpc('admin_update_support_ticket',{ p_ticket_id: ticketId,p_status: status,p_assigned_admin: adminId });
      if (result.error) throw result.error;
      setTicket((current: any) => ({ ...current,status,admin_id: adminId }));
    } catch (caught: any) { showError('Could not update ticket',caught.message || 'Try again.'); }
    finally { setSaving(false); }
  };
  const header = ticket ? <View style={styles.header}><Text style={styles.title}>{ticket.subject}</Text><Text style={styles.help}>{statuses.find((item) => item.value === ticket.status)?.label || ticket.status} · {new Date(ticket.created_at).toLocaleString()}</Text><Text selectable style={styles.description}>{ticket.description}</Text>{ticket.related_request_id && <Text selectable style={styles.reference}>Related request: {ticket.related_request_id}</Text>}{isAdmin && ticket.related_request_id && <Pressable onPress={() => router.push({ pathname: '/admin', params: { tab: 'payments', itemId: ticket.related_request_id } } as never)}><Text style={styles.link}>View payment history →</Text></Pressable>}{isAdmin && <View style={styles.adminControls}><View style={styles.setting}><Text style={styles.help}>Status</Text><Host matchContents colorScheme="dark" seedColor={AppColors.accent}><Picker selectedValue={ticket.status} enabled={!saving} onValueChange={(value) => void saveTicket(String(value),ticket.admin_id)}>{statuses.map((item) => <Picker.Item key={item.value} value={item.value} label={item.label} />)}</Picker></Host></View><View style={styles.setting}><Text style={styles.help}>Assigned to</Text><Host matchContents colorScheme="dark" seedColor={AppColors.accent}><Picker selectedValue={ticket.admin_id || ''} enabled={!saving} onValueChange={(value) => void saveTicket(ticket.status,String(value) || null)}><Picker.Item value="" label="Unassigned" />{accounts.filter((item) => item.is_admin && item.access_status === 'active').map((item) => <Picker.Item key={item.user_id} value={item.user_id} label={item.full_name || item.username || 'Administrator'} />)}</Picker></Host></View></View>}<Text style={styles.sectionTitle}>Conversation</Text></View> : null;
  return <KeyboardAvoidingView style={[styles.screen,{ paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}><Stack.Screen options={{ headerShown: true,title: 'Support report',headerStyle: { backgroundColor: AppColors.background },headerTintColor: AppColors.text }} />{loading || authLoading ? <View style={styles.empty}><ActivityIndicator color={AppColors.accent} /></View> : !user || (!ticket && error) ? <View style={styles.empty}><Text style={styles.error}>{error || 'Sign in to view this report.'}</Text><Pressable onPress={() => void load()}><Text style={styles.link}>Retry</Text></Pressable></View> : <>{error ? <Pressable onPress={() => void load()} style={styles.errorBox}><Text style={styles.error}>{error}</Text></Pressable> : null}<FlatList data={messages} keyExtractor={(item) => item.message_id} contentContainerStyle={styles.content} ListHeaderComponent={header} ListEmptyComponent={<Text style={styles.help}>Replies will appear here. You can add more details below.</Text>} renderItem={({ item }) => {
    const mine = item.sender_id === user?.id;
    const sender = accounts.find((account) => account.user_id === item.sender_id);
    return <View style={[styles.message,mine && styles.myMessage,item.internal && styles.internalMessage]}><View style={styles.messageHeading}><Text style={styles.author}>{mine ? 'You' : isAdmin ? sender?.full_name || 'Reporter' : 'SNAP support'}{item.internal ? ' · Internal note' : ''}</Text><Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text></View><Text selectable style={styles.body}>{item.body}</Text></View>;
  }} />{ticket && (ticket.status !== 'closed' || isAdmin) && <View style={styles.composer}>{isAdmin && <View style={styles.internalToggle}><Text style={styles.help}>Internal admin note</Text><Host matchContents colorScheme="dark" seedColor={AppColors.accent}><Switch value={internal} onValueChange={setInternal} /></Host></View>}<View style={styles.composerRow}><TextInput value={body} onChangeText={setBody} placeholder={internal && isAdmin ? 'Write a private note' : 'Write a reply'} placeholderTextColor={AppColors.placeholder} multiline maxLength={4000} style={styles.input} accessibilityLabel="Support reply" editable={!sending} /><Pressable accessibilityLabel="Send reply" disabled={sending || !body.trim()} onPress={() => void send()} style={({ pressed }) => [styles.send,(pressed || sending || !body.trim()) && styles.dim]}>{sending ? <ActivityIndicator color={AppColors.white} /> : <Ionicons name="arrow-up" size={24} color={AppColors.white} />}</Pressable></View></View>}</>}</KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1,backgroundColor: AppColors.background },content: { padding: Spacing.three,paddingBottom: Spacing.four },header: { gap: Spacing.two,paddingBottom: Spacing.three },title: { color: AppColors.text,fontSize: 22,fontWeight: '700' },help: { color: AppColors.textSecondary,fontSize: 14,lineHeight: 21 },description: { color: AppColors.text,fontSize: 15,lineHeight: 23,paddingVertical: Spacing.two },reference: { color: AppColors.textMuted,fontSize: 12 },sectionTitle: { color: AppColors.text,fontSize: 16,fontWeight: '600',paddingTop: Spacing.three },adminControls: { gap: Spacing.two,paddingVertical: Spacing.two,borderTopWidth: StyleSheet.hairlineWidth,borderTopColor: AppColors.borderSubtle },setting: { flexDirection: 'row',justifyContent: 'space-between',alignItems: 'center',flexWrap: 'wrap',gap: Spacing.two },message: { padding: Spacing.three,gap: Spacing.two,backgroundColor: AppColors.surface,borderRadius: BorderRadius.md,borderCurve: 'continuous',marginBottom: Spacing.two },myMessage: { backgroundColor: AppColors.surfaceElevated },internalMessage: { borderWidth: StyleSheet.hairlineWidth,borderColor: AppColors.warning },messageHeading: { gap: Spacing.one },author: { color: AppColors.accent,fontWeight: '600',fontSize: 13 },time: { color: AppColors.textMuted,fontSize: 11 },body: { color: AppColors.text,fontSize: 15,lineHeight: 23 },composer: { padding: Spacing.three,gap: Spacing.two,borderTopWidth: StyleSheet.hairlineWidth,borderTopColor: AppColors.borderSubtle,backgroundColor: AppColors.background },composerRow: { flexDirection: 'row',gap: Spacing.two,alignItems: 'flex-end' },input: { flex: 1,minWidth: 0,minHeight: 48,maxHeight: 120,padding: Spacing.three,backgroundColor: AppColors.input,color: AppColors.text,borderRadius: BorderRadius.md,borderCurve: 'continuous',fontSize: 15 },send: { width: 48,height: 48,alignItems: 'center',justifyContent: 'center',backgroundColor: AppColors.accent,borderRadius: BorderRadius.full },internalToggle: { flexDirection: 'row',justifyContent: 'space-between',alignItems: 'center' },dim: { opacity: 0.5 },empty: { flex: 1,padding: Spacing.four,alignItems: 'center',justifyContent: 'center',gap: Spacing.three },error: { color: AppColors.error,lineHeight: 20 },link: { color: AppColors.accent,fontWeight: '600' },errorBox: { padding: Spacing.three,backgroundColor: AppColors.errorBg },
});
