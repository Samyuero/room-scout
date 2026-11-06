import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { showError } from '@/components/error-toast';
import { logEvent } from '@/lib/logger';

type Tab = 'verifications' | 'dorms' | 'payments' | 'support' | 'users';
const tabs: { key: Tab; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'verifications', title: 'Owner checks', icon: 'shield-checkmark-outline' },
  { key: 'dorms', title: 'Listings', icon: 'home-outline' },
  { key: 'payments', title: 'Payments', icon: 'receipt-outline' },
  { key: 'support', title: 'Support', icon: 'chatbubbles-outline' },
  { key: 'users', title: 'Accounts', icon: 'people-outline' },
];
let channelSequence = 0;
const money = (value: unknown) => '₱' + Number(value || 0).toLocaleString('en-PH');
const date = (value: string) => Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : 'Date unavailable';

export default function AdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ tab?: string; itemId?: string }>();
  const [tab, setTab] = useState<Tab>('verifications');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [dorms, setDorms] = useState<any[]>([]);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [certifications, setCertifications] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [identityReviews, setIdentityReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const version = useRef(0);

  useEffect(() => {
    if (tabs.some((item) => item.key === params.tab)) setTab(params.tab as Tab);
    setExpandedId(params.itemId || null); setQuery(''); setFilter('all');
  }, [params.tab, params.itemId]);
  const load = useCallback(async () => {
    if (!user) { setIsAdmin(false); setLoading(false); return; }
    const current = ++version.current;
    try {
      const role = await supabase.from('admins').select('admin_id').eq('admin_id', user.id).maybeSingle();
      if (role.error) throw role.error;
      if (current !== version.current) return;
      setIsAdmin(!!role.data);
      if (!role.data) return;
      // Fetch all queue counts before tabs are opened; keep successful data when one queue fails.
      const results = await Promise.all([
        supabase.from('owner_verifications').select('*, owners(full_name,username)').eq('status', 'pending').order('created_at', { ascending: false }),
        supabase.from('dorms').select('*').order('created_at', { ascending: false }),
        supabase.from('rental_requests').select('*, dorms:dorm_id(name,address), renters:user_id(full_name,username)').order('updated_at', { ascending: false }),
        supabase.from('support_tickets').select('*').order('updated_at', { ascending: false }),
        supabase.from('lgu_certification_requests').select('*').order('created_at', { ascending: false }),
        supabase.rpc('admin_list_accounts'),
        supabase.from('renter_verifications').select('user_id,status,reviewed_at'),
      ]);
      if (current !== version.current) return;
      const setters = [setVerifications, setDorms, setPayments, setTickets, setCertifications, setAccounts, setIdentityReviews];
      results.forEach((result, index) => { if (!result.error) setters[index](result.data || []); });
      const failure = results.find((result) => result.error)?.error;
      setError(failure?.message || '');
      if (failure) logEvent('warn', 'admin_dashboard_refresh_failed', { userId: user.id, code: failure.code });
    } catch (caught: any) { if (current === version.current) setError(caught.message || 'Could not load the admin panel.'); }
    finally { if (current === version.current) { setLoading(false); setRefreshing(false); } }
  }, [user]);
  useFocusEffect(useCallback(() => { if (!authLoading) void load(); }, [authLoading, load]));
  useEffect(() => {
    if (isAdmin !== true) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 400); };
    const channel = supabase.channel('admin-queues-' + ++channelSequence);
    for (const table of ['owner_verifications', 'dorms', 'rental_requests', 'support_tickets', 'lgu_certification_requests', 'account_access']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    channel.subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [isAdmin, load]);
  const act = async (id: string, action: () => PromiseLike<{ error: any }>) => {
    if (busy) return;
    setBusy(id);
    try { const result = await action(); if (result.error) throw result.error; await load(); }
    catch (caught: any) { showError('Could not save', caught.message || 'Please try again.'); }
    finally { setBusy(null); }
  };
  const flags = (item: any, changes: Record<string, boolean>) => act(item.dorm_id, () => supabase.rpc('admin_set_listing_flags', { p_dorm_id: item.dorm_id, ...changes }));
  const document = (kind: string, id: string) => router.push({ pathname: '/admin-document', params: { kind, id } } as never);
  const toggleLgu = (item: any) => {
    if (item.lgu_certified) return Alert.alert('Remove LGU badge?', 'The listing stays published and its certification record is retained.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void flags(item, { p_lgu_certified: false }) }]);
    const proof = certifications.find((entry) => entry.dorm_id === item.dorm_id && entry.status === 'pending');
    if (proof) document('lgu', proof.certification_id);
    else if (certifications.some((entry) => entry.dorm_id === item.dorm_id && entry.status === 'approved')) void flags(item, { p_lgu_certified: true });
    else showError('LGU proof required', 'The owner must submit an LGU certificate for admin review first.');
  };
  const archive = (item: any) => Alert.alert(item.status === 'active' ? 'Remove this listing?' : 'Restore listing?', item.status === 'active' ? 'It will be hidden from discovery. Requests, payments, tenants, and history stay saved.' : 'The listing will appear in discovery again.', [{ text: 'Cancel', style: 'cancel' }, { text: item.status === 'active' ? 'Remove listing' : 'Restore', style: item.status === 'active' ? 'destructive' : 'default', onPress: () => void flags(item, { p_active: item.status !== 'active' }) }]);
  const moderateAccount = (item: any, operation: 'access' | 'admin' | 'owner_verification') => {
    const restore = item.access_status === 'suspended';
    Alert.alert(operation === 'access' ? restore ? 'Restore account access?' : 'Suspend account access?' : 'Revoke this privilege?', 'This changes RoomScout access without deleting the account or transaction history.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: 'destructive', onPress: () => void act(item.user_id, () => operation === 'access' ? supabase.rpc('admin_set_account_access', { p_user_id: item.user_id, p_status: restore ? 'active' : 'suspended', p_reason: restore ? null : 'Access suspended following administrator review.' }) : supabase.rpc('admin_revoke_privilege', { p_user_id: item.user_id, p_privilege: operation })) }]);
  };
  const rows = useMemo(() => {
    const source = tab === 'verifications' ? verifications : tab === 'dorms' ? dorms : tab === 'payments' ? payments : tab === 'support' ? tickets : accounts;
    const term = query.trim().toLowerCase();
    return source.filter((item) => {
      const text = [item.name,item.address,item.subject,item.full_name,item.username,item.email,item.request_id,item.dorms?.name,item.renters?.username,item.renters?.full_name,item.owners?.full_name,item.owners?.username].filter(Boolean).join(' ').toLowerCase();
      if (term && !text.includes(term)) return false;
      if (filter === 'all') return true;
      if (tab === 'dorms') return filter === 'lgu_pending' ? certifications.some((entry) => entry.dorm_id === item.dorm_id && entry.status === 'pending') : filter === 'featured' ? item.is_featured : item.status === filter;
      if (tab === 'payments') return ['cash','qr'].includes(filter) ? item.payment_method === filter : filter === 'refunds' ? String(item.status).startsWith('refund_') : item.payment_status === filter;
      if (tab === 'users') return filter === 'owners' ? item.is_owner : filter === 'admins' ? item.is_admin : item.access_status === filter;
      return item.status === filter;
    });
  }, [accounts,certifications,dorms,filter,payments,query,tab,tickets,verifications]);
  const filters = tab === 'dorms' ? [['all','All'],['active','Published'],['inactive','Removed'],['featured','Featured'],['lgu_pending','LGU review']] : tab === 'payments' ? [['all','All history'],['qr','QR'],['cash','Cash'],['pending_verification','To owner'],['paid','Confirmed'],['refunds','Refunds']] : tab === 'support' ? [['all','All tickets'],['open','Open'],['in_progress','In review'],['resolved','Resolved'],['closed','Closed']] : tab === 'users' ? [['all','All'],['owners','Owners'],['admins','Admins'],['suspended','Suspended']] : [];
  const counts = { verifications: verifications.length, dorms: dorms.length, payments: payments.length, support: tickets.filter((item) => ['open','in_progress'].includes(item.status)).length, users: accounts.length };
  const button = (title: string, onPress: () => void, danger = false) => <Pressable accessibilityRole="button" disabled={!!busy} onPress={onPress} style={({ pressed }) => [styles.button,danger && styles.dangerButton,(pressed || !!busy) && styles.dim]}><Text style={[styles.buttonText,danger && { color: AppColors.error }]}>{title}</Text></Pressable>;
  const renderItem = ({ item }: { item: any }) => {
    if (tab === 'verifications') return <View style={styles.row}><View style={styles.grow}><Text style={styles.rowTitle}>{item.owners?.full_name || 'Dorm owner'}</Text><Text style={styles.secondary}>@{item.owners?.username || 'account'} · {date(item.created_at)}</Text>{button('Review document', () => document('owner',item.verification_id))}</View></View>;
    if (tab === 'support') return <Pressable onPress={() => router.push({ pathname: '/support-ticket',params: { ticketId: item.ticket_id } } as never)} style={({ pressed }) => [styles.row,pressed && styles.dim]}><Ionicons name="chatbubble-ellipses-outline" color={AppColors.accent} size={24} /><View style={styles.grow}><Text style={styles.rowTitle}>{item.subject}</Text><Text style={styles.secondary}>{item.status.replace('_',' ')} · {date(item.updated_at)}</Text>{item.related_request_id && <Text style={styles.accent}>Transaction report</Text>}</View><Ionicons name="chevron-forward" size={20} color={AppColors.textSecondary} /></Pressable>;
    if (tab === 'users') {
      const identityRequest = payments.find((request) => request.user_id === item.user_id && request.renter_gov_id_url);
      const identity = identityReviews.find((review) => review.user_id === item.user_id);
      return <View style={styles.expandingRow}><Pressable onPress={() => setExpandedId(expandedId === item.user_id ? null : item.user_id)} style={styles.horizontal}><View style={styles.grow}><Text style={styles.rowTitle}>{item.full_name}</Text><Text style={styles.accent}>@{item.username || 'account'}</Text><Text style={styles.secondary}>{item.email}</Text><Text style={[styles.secondary,item.access_status === 'suspended' && { color: AppColors.error }]}>{item.is_admin ? 'Administrator' : item.is_owner ? 'Dorm owner' : 'Renter'} · {item.access_status}</Text></View><Ionicons name={expandedId === item.user_id ? 'chevron-up' : 'chevron-down'} color={AppColors.textSecondary} size={22} /></Pressable>{expandedId === item.user_id && <View style={styles.actions}><Text style={styles.secondary}>Renter identity: {identity?.status || (identityRequest ? 'Not reviewed' : 'No request ID submitted')}</Text>{identityRequest && button('Review renter ID',() => document('renter',identityRequest.request_id))}{button(item.access_status === 'suspended' ? 'Restore access' : 'Suspend access',() => moderateAccount(item,'access'),item.access_status !== 'suspended')}{item.is_owner && item.owner_verified && button('Revoke owner verification',() => moderateAccount(item,'owner_verification'),true)}{item.is_admin && button('Revoke admin privilege',() => moderateAccount(item,'admin'),true)}</View>}</View>;
    }
    if (tab === 'payments') return <View style={styles.expandingRow}><Pressable style={styles.horizontal} onPress={() => setExpandedId(expandedId === item.request_id ? null : item.request_id)}><View style={styles.grow}><Text style={styles.rowTitle}>{item.dorms?.name || 'Dormitory'}</Text><Text style={styles.secondary}>{item.renters?.full_name || item.renters?.username || 'Renter'} · {item.payment_method === 'cash' ? 'Cash in person' : 'QR payment'}</Text><Text style={styles.accent}>{money(item.required_amount)} · {String(item.payment_status).replaceAll('_',' ')}</Text><Text style={styles.secondary}>{date(item.updated_at)}</Text></View><Ionicons name={expandedId === item.request_id ? 'chevron-up' : 'chevron-down'} color={AppColors.textSecondary} size={22} /></Pressable>{expandedId === item.request_id && <View style={styles.actions}><Text selectable style={styles.secondary}>Request {item.request_id}</Text><Text style={styles.secondary}>{item.request_type} · {String(item.status).replaceAll('_',' ')}</Text>{item.payment_verified_at && <Text style={styles.secondary}>Owner confirmed {date(item.payment_verified_at)}</Text>}{item.refund_amount != null && <Text style={styles.secondary}>Refund {money(item.refund_amount)} · Deduction {money(item.refund_deduction)}</Text>}{item.payment_proof_url && button('View payment proof',() => document('payment',item.request_id))}{item.refund_proof_url && button('View refund proof',() => document('refund',item.request_id))}</View>}</View>;
    const expanded = expandedId === item.dorm_id;
    const pending = certifications.some((entry) => entry.dorm_id === item.dorm_id && entry.status === 'pending');
    return <View style={[styles.expandingRow,item.dorm_id === params.itemId && styles.highlight]}><Pressable onPress={() => setExpandedId(expanded ? null : item.dorm_id)} style={styles.horizontal}>{item.images?.[0] ? <Image source={{ uri: item.images[0] }} contentFit="cover" style={styles.thumbnail} /> : <View style={[styles.thumbnail,{ alignItems: 'center', justifyContent: 'center' }]}>
<Ionicons name="home-outline" size={28} color={AppColors.textMuted} /></View>}<View style={styles.grow}><Text style={styles.rowTitle}>{item.name}</Text><Text numberOfLines={2} style={styles.secondary}>{item.address}</Text><Text style={styles.accent}>{money(item.price)}/month</Text><Text style={styles.secondary}>{item.status === 'active' ? 'Published' : 'Removed'}{item.is_featured ? ' · Featured' : ''}{pending ? ' · LGU review' : ''}</Text></View><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={AppColors.textSecondary} /></Pressable>{expanded && <View style={styles.actions}><View style={styles.wrap}>{button('Edit listing',() => router.push({ pathname: '/add-dorm',params: { dormId: item.dorm_id } } as never))}{button(item.is_featured ? 'Unfeature' : 'Feature',() => void flags(item,{ p_featured: !item.is_featured }))}{button(item.lgu_certified ? 'Remove LGU badge' : pending ? 'Review LGU proof' : 'Grant LGU badge',() => toggleLgu(item))}</View>{item.ownership_proof_url && button('View ownership proof',() => document('ownership',item.dorm_id))}{button(item.status === 'active' ? 'Remove listing' : 'Restore listing',() => archive(item),item.status === 'active')}</View>}</View>;
  };
  return <View style={[styles.screen,{ paddingBottom: insets.bottom }]}><Stack.Screen options={{ headerShown: true,title: 'Admin dashboard',headerStyle: { backgroundColor: AppColors.background },headerTintColor: AppColors.text }} />{loading || authLoading ? <View style={styles.center}><ActivityIndicator color={AppColors.accent} /><Text style={styles.secondary}>Loading administration…</Text></View> : !isAdmin ? <View style={styles.center}><Ionicons name="lock-closed-outline" size={32} color={AppColors.textSecondary} /><Text style={styles.rowTitle}>Administrator access required</Text>{error && <Text style={styles.error}>{error}</Text>}{button('Back to profile',() => router.replace('/(tabs)/profile' as never))}</View> : <><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabContent}>{tabs.map((item) => <Pressable key={item.key} onPress={() => { setTab(item.key); setQuery(''); setFilter('all'); setExpandedId(null); }} style={({ pressed }) => [styles.tab,tab === item.key && styles.tabSelected,pressed && styles.dim]}><Ionicons name={item.icon} size={20} color={tab === item.key ? AppColors.accent : AppColors.textSecondary} /><Text style={[styles.secondary,tab === item.key && styles.accent]}>{item.title} ({counts[item.key]})</Text></Pressable>)}</ScrollView><View style={styles.search}><Ionicons name="search" size={20} color={AppColors.textSecondary} /><TextInput value={query} onChangeText={setQuery} placeholder={'Search ' + tabs.find((item) => item.key === tab)?.title.toLowerCase()} placeholderTextColor={AppColors.placeholder} style={styles.input} autoCapitalize="none" accessibilityLabel="Search admin records" /></View>{filters.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterContent}>{filters.map(([key,title]) => <Pressable key={key} onPress={() => setFilter(key)} style={({ pressed }) => [styles.chip,filter === key && styles.chipSelected,pressed && styles.dim]}><Text style={[styles.secondary,filter === key && styles.accent]}>{title}</Text></Pressable>)}</ScrollView>}{error ? <Pressable onPress={() => void load()} style={styles.errorBox}><Text style={styles.error}>{error} Tap to retry.</Text></Pressable> : null}{tab === 'verifications' && <Text style={styles.caption}>Owner checks are requests to verify an owner’s ID or business permit. An administrator must approve the submitted document.</Text>}{tab === 'payments' && <Text style={styles.caption}>Read-only history. Dorm owners confirm payments.</Text>}<FlatList data={rows} keyExtractor={(item) => String(tab === 'dorms' ? item.dorm_id : item.verification_id || item.ticket_id || item.request_id || item.user_id)} renderItem={renderItem} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={AppColors.accent} />} ListEmptyComponent={<View style={styles.empty}><Ionicons name="file-tray-outline" size={32} color={AppColors.textMuted} /><Text style={styles.rowTitle}>{query || filter !== 'all' ? 'No matching records' : tab === 'verifications' ? 'No owner checks pending' : 'Nothing here yet'}</Text><Text style={styles.secondary}>{query || filter !== 'all' ? 'Try another search or filter.' : tab === 'verifications' ? 'When a dorm owner submits an ID or business permit, it will appear here for admin approval. Verified owners are listed under Accounts.' : 'New records will appear here automatically.'}</Text></View>} /></>}</View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1,backgroundColor: AppColors.background }, center: { flex: 1,alignItems: 'center',justifyContent: 'center',padding: Spacing.four,gap: Spacing.three },
  tabs: { flexGrow: 0,flexShrink: 0,borderBottomWidth: StyleSheet.hairlineWidth,borderBottomColor: AppColors.borderSubtle },tabContent: { paddingHorizontal: Spacing.two,gap: Spacing.two },tab: { padding: Spacing.three,alignItems: 'center',gap: Spacing.one,borderBottomWidth: 2,borderBottomColor: 'transparent' },tabSelected: { borderBottomColor: AppColors.accent },
  search: { flexDirection: 'row',alignItems: 'center',gap: Spacing.two,margin: Spacing.three,backgroundColor: AppColors.input,borderRadius: BorderRadius.md,borderCurve: 'continuous',paddingHorizontal: Spacing.three },input: { flex: 1,minWidth: 0,minHeight: 48,color: AppColors.text,fontSize: 15 },
  filters: { flexGrow: 0,flexShrink: 0 },filterContent: { paddingHorizontal: Spacing.three,gap: Spacing.two,paddingBottom: Spacing.two },chip: { paddingHorizontal: Spacing.three,paddingVertical: Spacing.two,borderRadius: BorderRadius.full,backgroundColor: AppColors.surface },chipSelected: { backgroundColor: AppColors.surfaceElevated },
  list: { paddingHorizontal: Spacing.three,paddingBottom: Spacing.four,flexGrow: 1 },row: { flexDirection: 'row',alignItems: 'center',gap: Spacing.three,paddingVertical: Spacing.three,borderBottomWidth: StyleSheet.hairlineWidth,borderBottomColor: AppColors.borderSubtle },expandingRow: { paddingVertical: Spacing.three,borderBottomWidth: StyleSheet.hairlineWidth,borderBottomColor: AppColors.borderSubtle },horizontal: { flexDirection: 'row',alignItems: 'center',gap: Spacing.three },grow: { flex: 1,minWidth: 0,gap: Spacing.one },
  rowTitle: { color: AppColors.text,fontSize: 16,fontWeight: '600' },secondary: { color: AppColors.textSecondary,fontSize: 13,lineHeight: 19,flexShrink: 1 },accent: { color: AppColors.accent,fontSize: 13,fontWeight: '600' },thumbnail: { width: 64,height: 64,borderRadius: BorderRadius.sm,backgroundColor: AppColors.surfaceElevated },actions: { gap: Spacing.two,paddingTop: Spacing.two },wrap: { flexDirection: 'row',flexWrap: 'wrap',gap: Spacing.two },
  button: { alignItems: 'center',justifyContent: 'center',alignSelf: 'flex-start',minHeight: 44,paddingHorizontal: Spacing.three,paddingVertical: Spacing.two,borderRadius: BorderRadius.md,borderCurve: 'continuous',backgroundColor: AppColors.surfaceElevated },buttonText: { color: AppColors.accent,fontWeight: '600',fontSize: 14 },dangerButton: { backgroundColor: AppColors.errorBg },dim: { opacity: 0.6 },empty: { alignItems: 'center',gap: Spacing.two,paddingVertical: Spacing.six },error: { color: AppColors.error,lineHeight: 20 },errorBox: { marginHorizontal: Spacing.three,marginBottom: Spacing.two,padding: Spacing.two,backgroundColor: AppColors.errorBg,borderRadius: BorderRadius.sm },caption: { color: AppColors.textSecondary,fontSize: 12,paddingHorizontal: Spacing.three,paddingBottom: Spacing.two },highlight: { backgroundColor: AppColors.surfaceElevated },
});
