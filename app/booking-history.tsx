import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/context/notification-context';
import { AppColors } from '@/constants/theme';
import { BookingDocument } from '@/components/booking-document';
import { ErrorToast, showError } from '@/components/error-toast';
import { bookingRefundWarning, bookingStatusLabel, canCancelRentalRequest, canRequestBookingRefund, rentalCancellationWarning } from '@/lib/rental-workflow';
import { getSafeImageExtension, uploadPrivateImage } from '@/utils/imageUpload';
import { logEvent } from '@/lib/logger';

const money = (amount: unknown) => '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BookingHistoryScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId?: string }>();
  const { user } = useAuth();
  const { refreshUnreadCount } = useNotifications();
  const insets = useSafeAreaInsets();
  const [bookings, setBookings] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string[]>(requestId ? [requestId] : []);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refund, setRefund] = useState<any | null>(null);
  const [gcashName, setGcashName] = useState('');
  const [gcashNumber, setGcashNumber] = useState('');
  const [refundQr, setRefundQr] = useState('');
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setRefreshing(true);
    try {
      const { data, error: fetchError } = await supabase.rpc('get_renter_booking_history');
      if (fetchError) throw fetchError;
      setBookings(Array.isArray(data) ? data : []); setError('');
    } catch { setError('Could not refresh your bookings. Pull down or tap Retry.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [user]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel('booking-history-' + user.id + '-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_requests', filter: 'user_id=eq.' + user.id }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, user]);
  const mutate = async (rpc: string, args: Record<string, unknown>, event: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc(rpc, args);
      if (rpcError) throw rpcError;
      logEvent('info', event, { userId: user?.id, requestId: String(args.p_request_id || '') });
      await Promise.all([load(), refreshUnreadCount()]);
    } catch (cause: any) { showError('Could not update booking', cause.message || 'Please retry.'); throw cause; }
    finally { setBusy(false); }
  };
  const cancel = (item: any) => Alert.alert('Cancel this request?', rentalCancellationWarning, [
    { text: 'Keep request', style: 'cancel' },
    { text: 'Cancel request', style: 'destructive', onPress: () => void mutate('cancel_rental_request', { p_request_id: item.request_id }, 'booking_cancelled').catch(() => {}) },
  ]);
  const chooseQr = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') throw new Error('Allow gallery access to select your GCash QR.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled && result.assets[0]) setRefundQr(result.assets[0].uri);
    } catch (cause: any) { showError('Image not selected', cause.message); }
  };
  const submitRefund = () => {
    if (!refund || busy) return;
    const phone = gcashNumber.replace(/[\s()-]/g, '');
    if (gcashName.trim().length < 2 || gcashName.trim().length > 120 || !/^(\+63|0)9\d{9}$/.test(phone) || !refundQr) {
      showError('Check refund details', 'Enter your GCash account name, valid mobile number and QR image.'); return;
    }
    Alert.alert('Confirm cancellation & refund', bookingRefundWarning, [{ text: 'Go back', style: 'cancel' }, { text: 'Request 90% refund', style: 'destructive', onPress: () => {
      setBusy(true);
      void (async () => {
        try {
          const path = await uploadPrivateImage(`${user!.id}/refund-qr/${Date.now()}.${getSafeImageExtension(refundQr)}`, refundQr);
          const { error: rpcError } = await supabase.rpc('request_booking_refund', { p_request_id: refund.request_id, p_refund_qr_path: path, p_gcash_name: gcashName.trim(), p_gcash_number: phone, p_reason: reason.trim() || null });
          if (rpcError) throw rpcError;
          logEvent('info', 'booking_refund_requested', { userId: user?.id, requestId: refund.request_id });
          setRefund(null); setRefundQr(''); setReason('');
          await Promise.all([load(), refreshUnreadCount()]);
          Alert.alert('Refund requested', 'The owner has been notified. Confirm receipt only after the money reaches your GCash account.');
        } catch (cause: any) { showError('Refund request failed', cause.message || 'Your details are kept. Please retry.'); }
        finally { setBusy(false); }
      })();
    } }]);
  };
  const dispute = async (item: any) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error: ticketError } = await supabase.rpc('create_support_ticket', { p_subject: 'Booking / refund review', p_description: `Please review my ${item.request_type} for ${item.dorms?.name || 'this dorm'}. Current status: ${bookingStatusLabel(item.status)}.`, p_related_request_id: item.request_id });
      if (ticketError) throw ticketError;
      router.push({ pathname: '/support-ticket', params: { ticketId: String(data) } } as never);
    } catch (cause: any) { showError('Could not create report', cause.message); }
    finally { setBusy(false); }
  };
  const renderItem = ({ item }: { item: any }) => {
    const isOpen = expanded.includes(item.request_id);
    return <View style={styles.card}>
      <Pressable accessibilityLabel="Show booking details" style={styles.row} onPress={() => setExpanded((ids) => isOpen ? ids.filter((id) => id !== item.request_id) : [...ids, item.request_id])}>
        <View style={styles.grow}><Text style={styles.title}>{item.dorms?.name || 'Dormitory'}</Text><Text style={styles.status}>{bookingStatusLabel(item.status)}</Text><Text style={styles.muted}>{item.request_type === 'reservation' ? 'Reservation' : 'Rental'} · {new Date(item.created_at).toLocaleDateString()}</Text></View>
        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} color={AppColors.textSecondary} size={22} />
      </Pressable>
      {isOpen && <View style={styles.details}>
        <Text style={styles.body}>{item.dorms?.address}</Text>
        <Text style={styles.body}>{item.payment_method === 'cash' ? 'Cash in person' : 'QR payment'} · {item.payment_status?.replace(/_/g, ' ')}</Text>
        {!!item.required_amount && <Text style={styles.body}>Recorded amount: {money(item.required_amount)}</Text>}
        {item.converted_at && <Text style={styles.body}>Reservation converted to tenancy on {new Date(item.converted_at).toLocaleDateString()}.</Text>}
        {item.tenancy && <Text style={styles.body}>Stay: {new Date(item.tenancy.start_date).toLocaleDateString()}{item.tenancy.end_date ? ' — ' + new Date(item.tenancy.end_date).toLocaleDateString() : item.tenancy.planned_end_date ? ' · Planned end ' + new Date(item.tenancy.planned_end_date).toLocaleDateString() : ' · Ongoing'}</Text>}
        {item.status === 'cancelled' && item.payment_status === 'pending_verification' && <Text style={styles.body}>Your receipt is still being reviewed by the owner. A confirmed payment can then enter the refund process.</Text>}
        {item.refund_amount != null && <View style={styles.summary}><Text style={styles.body}>Refund (90%): <Text style={styles.emphasis}>{money(item.refund_amount)}</Text></Text><Text style={styles.muted}>Deduction (10%): {money(item.refund_deduction)}</Text><Text style={styles.muted}>GCash: {item.renter_gcash_name} · {item.renter_gcash_number}</Text></View>}
        {item.status === 'refund_requested' && <Text style={styles.body}>Waiting for the owner to send your refund and upload transfer proof.</Text>}
        <BookingDocument path={item.refund_proof_url} label="Owner refund transfer proof" />
        {item.status === 'refund_sent' && <Pressable disabled={busy} style={styles.primary} onPress={() => Alert.alert('Did the money arrive?', `Confirm only after receiving ${money(item.refund_amount)} in your GCash account. A screenshot alone does not prove receipt.`, [{ text: 'Not yet', style: 'cancel' }, { text: 'I received the refund', onPress: () => void mutate('confirm_booking_refund', { p_request_id: item.request_id }, 'booking_refund_received').catch(() => {}) }])}><Text style={styles.primaryText}>Confirm refund received</Text></Pressable>}
        <View style={styles.actions}>
          <Pressable style={styles.secondary} onPress={() => router.push({ pathname: '/(tabs)/[dormId]', params: { dormId: item.dorm_id } } as never)}><Text style={styles.link}>View dorm</Text></Pressable>
          {canCancelRentalRequest(item) && item.payment_status !== 'paid' && <Pressable disabled={busy} style={styles.secondary} onPress={() => cancel(item)}><Text style={styles.danger}>Cancel request</Text></Pressable>}
          {canRequestBookingRefund(item) && <Pressable disabled={busy} style={styles.secondary} onPress={() => { setRefund(item); setGcashName(item.renter_gcash_name || ''); setGcashNumber(item.renter_gcash_number || ''); }}><Text style={styles.danger}>Cancel & request refund</Text></Pressable>}
          {item.payment_status === 'paid' && <Pressable disabled={busy} style={styles.secondary} onPress={() => void dispute(item)}><Text style={styles.link}>Report a problem</Text></Pressable>}
        </View>
      </View>}
    </View>;
  };
  return <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
    {error ? <Pressable style={styles.error} onPress={() => void load()}><Text style={styles.danger}>{error} Retry</Text></Pressable> : null}
    {loading ? <View style={styles.center}><ActivityIndicator color={AppColors.accent} /><Text style={styles.muted}>Loading your bookings…</Text></View> : <FlatList data={bookings} renderItem={renderItem} keyExtractor={(item) => item.request_id} onRefresh={() => void load()} refreshing={refreshing} contentContainerStyle={styles.list} ListHeaderComponent={<Text style={styles.intro}>Your requests, reservations, stays and refunds in one place.</Text>} ListEmptyComponent={<View style={styles.center}><Ionicons name="receipt-outline" size={38} color={AppColors.textMuted} /><Text style={styles.title}>No bookings yet</Text><Text style={styles.body}>Your rental and reservation requests will appear here.</Text></View>} />}
    <Modal visible={Boolean(refund)} transparent animationType="slide" onRequestClose={() => { if (!busy) setRefund(null); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.modal}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
            <Text style={styles.heading}>Cancel & request refund</Text><Text style={styles.body}>90% refund · 10% deduction. The owner sends the money; RoomScout tracks the proof and confirmation.</Text>
            <Text style={styles.label}>GCash account name</Text><TextInput style={styles.input} placeholder="Name on your GCash account" placeholderTextColor={AppColors.placeholder} value={gcashName} onChangeText={setGcashName} maxLength={120} />
            <Text style={styles.label}>GCash mobile number</Text><TextInput style={styles.input} placeholder="09XXXXXXXXX" placeholderTextColor={AppColors.placeholder} value={gcashNumber} onChangeText={setGcashNumber} keyboardType="phone-pad" maxLength={20} />
            <Text style={styles.label}>Refund QR</Text><Pressable style={styles.secondary} onPress={() => void chooseQr()}>{refundQr ? <Image source={{ uri: refundQr }} style={{ width: '100%', height: 150, resizeMode: 'contain' }} /> : <Ionicons name="image-outline" size={28} color={AppColors.accent} />}<Text style={styles.link}>{refundQr ? 'Change QR image' : 'Choose GCash QR image'}</Text></Pressable>
            <Text style={styles.label}>Reason</Text><TextInput style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]} placeholder="Tell the owner why you are cancelling" placeholderTextColor={AppColors.placeholder} value={reason} onChangeText={setReason} multiline maxLength={500} />
            <Text style={styles.emphasis}>Expected refund: {money(Number(refund?.required_amount || 0) * 0.9)}</Text>
          </ScrollView>
          <View style={styles.actions}><Pressable disabled={busy} style={styles.secondary} onPress={() => setRefund(null)}><Text style={styles.link}>Go back</Text></Pressable><Pressable disabled={busy} style={[styles.primary, styles.grow]} onPress={submitRefund}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Continue</Text>}</Pressable></View>
        </View>
        <ErrorToast />
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AppColors.background }, list: { padding: 16, gap: 12, flexGrow: 1 }, card: { backgroundColor: AppColors.surface, borderRadius: 14, padding: 16, borderColor: AppColors.borderSubtle, borderWidth: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, grow: { flex: 1, minWidth: 0 }, title: { color: AppColors.text, fontSize: 17, fontWeight: '700' }, status: { color: AppColors.accent, marginVertical: 6, fontWeight: '600' }, muted: { color: AppColors.textSecondary, fontSize: 12, lineHeight: 19 }, body: { color: AppColors.textSecondary, fontSize: 14, lineHeight: 21 }, details: { paddingTop: 18, gap: 14 }, summary: { gap: 8, backgroundColor: AppColors.surfaceElevated, padding: 12, borderRadius: 10 }, emphasis: { color: AppColors.text, fontWeight: '700' }, actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }, primary: { padding: 14, borderRadius: 10, backgroundColor: AppColors.accent, alignItems: 'center', minHeight: 48, justifyContent: 'center' }, primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' }, secondary: { paddingHorizontal: 12, paddingVertical: 12, minHeight: 44, justifyContent: 'center', borderRadius: 10, backgroundColor: AppColors.surfaceElevated, gap: 6, alignItems: 'center' }, link: { color: AppColors.accent, fontWeight: '600' }, danger: { color: AppColors.error }, error: { margin: 16, padding: 12, backgroundColor: AppColors.errorBg, borderRadius: 10 }, center: { flex: 1, padding: 28, gap: 14, alignItems: 'center', justifyContent: 'center' }, intro: { color: AppColors.textSecondary, lineHeight: 22, marginBottom: 18 }, overlay: { flex: 1, backgroundColor: AppColors.overlay, justifyContent: 'center', paddingHorizontal: 16 }, modal: { maxHeight: '100%', width: '100%', maxWidth: 520, alignSelf: 'center', padding: 20, borderRadius: 18, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.border, gap: 16 }, form: { gap: 10 }, heading: { color: AppColors.text, fontSize: 21, fontWeight: '700' }, label: { color: AppColors.textSecondary, fontWeight: '600', marginTop: 8 }, input: { backgroundColor: AppColors.input, borderWidth: 1, borderColor: AppColors.inputBorder, padding: 12, borderRadius: 10, color: AppColors.text, minHeight: 46 },
});
