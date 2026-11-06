import { ProtectedRequestDocuments } from '@/components/protected-request-documents';
import { ErrorToast, showError } from '@/components/error-toast';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { Image as ExpoImage } from 'expo-image';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Alert, Modal, TextInput, ScrollView, Image, Keyboard, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppColors } from '@/constants/theme';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getSafeImageExtension, uploadPrivateImage } from '@/utils/imageUpload';
import { BookingDocument } from '@/components/booking-document';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bookingStatusLabel } from '@/lib/rental-workflow';
import { logEvent } from '@/lib/logger';

export default function OwnerPanelScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{ dormId?: string; tab?: string; requestId?: string }>();

  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [activeTab, setActiveTab] = useState<'requests' | 'tenants' | 'reservations' | 'history'>('requests');
  const [expandedRequests, setExpandedRequests] = useState<string[]>([]);
  const [expandedTenants, setExpandedTenants] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [dormFilter, setDormFilter] = useState(params.dormId || 'all');
  const [dormOptions, setDormOptions] = useState<{ dorm_id: string; name: string; address?: string; images?: string[] }[]>([]);
  const [dormPickerOpen, setDormPickerOpen] = useState(false);
  const [dormQuery, setDormQuery] = useState('');
  const [failedDormImages, setFailedDormImages] = useState<string[]>([]);
  useEffect(() => {
    setActiveTab(params.tab === 'tenants' ? 'tenants' : params.tab === 'reservations' ? 'reservations' : params.tab === 'history' ? 'history' : 'requests');
    if (params.requestId) setExpandedRequests([params.requestId]);
  },[params.tab,params.requestId]);
  useEffect(() => { setDormFilter(params.dormId || 'all'); }, [params.dormId]);

  const [rentalRequests, setRentalRequests] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [requestHistory, setRequestHistory] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // New states for manual offline tenant registration
  const [ownerDorms, setOwnerDorms] = useState<any[]>([]);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [offlineName, setOfflineName] = useState('');
  const [offlinePhone, setOfflinePhone] = useState('');
  const [selectedDormId, setSelectedDormId] = useState('');
  const [addingRenter, setAddingRenter] = useState(false);
  const [acceptingRequest, setAcceptingRequest] = useState<any | null>(null);
  const [requiredAmount, setRequiredAmount] = useState('');
  const [ownerQrUrl, setOwnerQrUrl] = useState('');
  const [contractUrl, setContractUrl] = useState('');
  const [uploadingAcceptance, setUploadingAcceptance] = useState(false);
  const [refundRequest, setRefundRequest] = useState<any | null>(null);
  const [refundProof, setRefundProof] = useState('');
  const [extendingTenant, setExtendingTenant] = useState<any | null>(null);
  const [endDate, setEndDate] = useState('');

  // Search and dorm selection only change the visible list, never the booking records or their counts.
  const activityRows = useMemo(() => {
    const records = activeTab === 'requests' ? rentalRequests : activeTab === 'reservations' ? reservations : activeTab === 'history' ? requestHistory : tenants;
    const term = searchText.trim().toLocaleLowerCase().replace(/^@/, '');
    return records.filter((item) => {
      if (dormFilter !== 'all' && item.dorm_id !== dormFilter) return false;
      const searchable = [item.renter_name, item.renter_phone, item.renters?.full_name, item.renters?.username, item.profiles?.full_name, item.profiles?.username, item.dorms?.name].filter(Boolean).join(' ').toLocaleLowerCase();
      return !term || searchable.includes(term);
    });
  }, [activeTab, dormFilter, rentalRequests, requestHistory, reservations, searchText, tenants]);
  const hasActiveFilters = Boolean(searchText.trim() || dormFilter !== 'all');
  const selectedFilterDorm = dormOptions.find((dorm) => dorm.dorm_id === dormFilter);
  const filteredDormOptions = useMemo(() => {
    const term = dormQuery.trim().toLocaleLowerCase();
    return dormOptions.filter((dorm) => !term || [dorm.name, dorm.address].filter(Boolean).join(' ').toLocaleLowerCase().includes(term));
  }, [dormOptions, dormQuery]);
  const closeDormPicker = () => { setDormPickerOpen(false); setDormQuery(''); Keyboard.dismiss(); };
  const chooseDormFilter = (dormId: string) => { setDormFilter(dormId); closeDormPicker(); };

  const pickQrImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showError('Permission Denied', 'Gallery access is required to pick the payment QR image.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setOwnerQrUrl(result.assets[0].uri);
      }
    } catch {
      showError('Error', 'Failed to pick QR code image.');
    }
  };

  const pickContractImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showError('Permission Denied', 'Gallery access is required to pick the contract photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setContractUrl(result.assets[0].uri);
      }
    } catch {
      showError('Error', 'Failed to pick contract document photo.');
    }
  };

  const checkOwnerRole = useCallback(async () => {
    if (!user) {
      setIsOwner(false);
      setLoadingRole(false);
      return;
    }
    try {
      // Check if the user exists in the owners table
      const [owner, verification] = await Promise.all([
        supabase.from('owners').select('owner_id, status').eq('owner_id', user.id).maybeSingle(),
        supabase.from('owner_verifications').select('status').eq('user_id', user.id).maybeSingle(),
      ]);
      if (owner.error || verification.error) throw owner.error || verification.error;
      setIsOwner(owner.data?.status === 'active' && verification.data?.status === 'approved');
    } catch (err) {
      console.error('Error checking owner role:', err);
      setIsOwner(false);
    } finally {
      setLoadingRole(false);
    }
  }, [user]);

  useEffect(() => {
    void checkOwnerRole();
  }, [checkOwnerRole]);

  const fetchOwnerDorms = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('dorms')
        .select('dorm_id, name')
        .eq('owner_id', user.id)
        .eq('available', true);
      
      if (error) throw error;
      setOwnerDorms(data || []);
      if (data && data.length > 0) {
        setSelectedDormId(data[0].dorm_id);
      } else {
        setSelectedDormId('');
      }
    } catch (err: any) {
      console.error('Error fetching owner dorms:', err);
    }
  };

  const handleAddOfflineTenant = async () => {
    if (!selectedDormId) {
      showError('Selection Error', 'Please select an available dormitory.');
      return;
    }
    if (!offlineName.trim()) {
      showError('Input Error', 'Please enter the renter\'s name.');
      return;
    }

    if (offlineName.trim().length > 120 || (offlinePhone.trim() && !/^\+?[0-9][0-9 ()-]{6,19}$/.test(offlinePhone.trim()))) {
      showError('Check tenant details', 'Use a name under 120 characters and a valid contact number.');
      return;
    }
    setAddingRenter(true);
    try {
      const { error } = await supabase.rpc('owner_add_offline_tenant', {
        p_dorm_id: selectedDormId,
        p_renter_name: offlineName.trim(),
        p_renter_phone: offlinePhone.trim() || null,
      });
      if (error) throw error;
      Alert.alert('Tenant added', 'The tenant list and available slots have been updated.');
      setIsAddModalVisible(false);
      setOfflineName('');
      setOfflinePhone('');
      fetchData(); // Refresh list
    } catch (err: any) {
      showError('Error Adding Tenant', err.message);
    } finally {
      setAddingRenter(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (isOwner !== true) return;
    setRefreshing(true);
    try {
      const [dashboard, listings] = await Promise.all([
        supabase.rpc('get_owner_rental_dashboard', { p_dorm_id: null }),
        supabase.from('dorms').select('dorm_id,name,address,images').eq('owner_id', user!.id).order('name'),
      ]);
      const { data, error } = dashboard;
      if (error) throw error;
      if (!listings.error) setDormOptions(listings.data || []);
      setRentalRequests((data?.requests || []).filter((request: any) => !['approved', 'reserved', 'rejected', 'refund_completed', 'completed'].includes(request.status)));
      setReservations((data?.requests || []).filter((request: any) => request.status === 'reserved'));
      setRequestHistory((data?.requests || []).filter((request: any) => ['completed','refund_completed','rejected','cancelled'].includes(request.status)));
      setTenants(data?.tenants || []);
      setLoadError('');
    } catch {
      setLoadError('Could not refresh owner activity. Tap to retry.');
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [isOwner, user]);

  useFocusEffect(useCallback(() => { if (isOwner) void fetchData(); }, [fetchData, isOwner]));
  useEffect(() => {
    if (!user?.id || !isOwner) return;
    const channel = supabase.channel('owner-workflow-' + user.id + '-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_requests', filter: 'owner_id=eq.' + user.id }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rentals' }, () => void fetchData())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, isOwner, fetchData]);

  const handleDecision = async (requestId: string, approve: boolean, userId: string, dormName: string, dormId: string) => {
    if (approve) {
      const request = rentalRequests.find((item) => item.request_id === requestId);
      if (request?.payment_method === 'cash') {
        setActionLoading(requestId);
        try {
          const { error } = await supabase.rpc('owner_accept_cash_request', { p_request_id: requestId });
          if (error) throw error;
          await fetchData();
          Alert.alert('Cash request accepted', 'The request is pending until you confirm cash was received.');
        } catch (error: any) {
          showError('Could not accept request', error.message || 'Check your connection and try again.');
          await fetchData();
        } finally { setActionLoading(null); }
        return;
      }
      setAcceptingRequest(request);
      setRequiredAmount(String(request?.request_type === 'reservation' ? request?.dorms?.reservation_fee || '' : request?.dorms?.price || ''));
      setOwnerQrUrl('');
      setContractUrl('');
      return;
    }

    setActionLoading(requestId);
    try {
      const newStatus = 'rejected';
      
      const { error } = await supabase
        .from('rental_requests')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('request_id', requestId).eq('owner_id', user!.id).eq('status', 'pending').select('request_id').single();

      if (error) throw error;

      Alert.alert('Success', `Rental request has been ${newStatus}.`);
      setRentalRequests(prev => prev.filter(item => item.request_id !== requestId));
    } catch (err: any) {
      showError('Error', err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const submitAcceptance = async () => {
    if (!acceptingRequest) return;
    const amount = Number(requiredAmount);
    if (!Number.isFinite(amount) || amount <= 0 || (acceptingRequest.payment_method !== 'cash' && !ownerQrUrl.trim()) || !contractUrl.trim()) {
      showError('Missing acceptance details', 'Enter a valid amount and select the contract. QR payments also require a QR image.');
      return;
    }

    setActionLoading(acceptingRequest.request_id);
    setUploadingAcceptance(true);
    try {
      let finalQrUrl = ownerQrUrl.trim();
      let finalContractUrl = contractUrl.trim();

      // Upload QR photo to Supabase Storage if selected from local gallery
      if (ownerQrUrl.startsWith('file:') || ownerQrUrl.startsWith('content:')) {
        const ext = getSafeImageExtension(ownerQrUrl);
        const fileName = `${user!.id}/qrcodes/${Date.now()}.${ext}`;
        finalQrUrl = await uploadPrivateImage(fileName, ownerQrUrl);
      }

      // Upload Contract photo to Supabase Storage if selected from local gallery
      if (contractUrl.startsWith('file:') || contractUrl.startsWith('content:')) {
        const ext = getSafeImageExtension(contractUrl);
        const fileName = `${user!.id}/contracts/${Date.now()}.${ext}`;
        finalContractUrl = await uploadPrivateImage(fileName, contractUrl);
      }

      const { error } = await supabase
        .from('rental_requests')
        .update({
          status: 'awaiting_payment',
          required_amount: amount,
          owner_payment_qr_url: finalQrUrl,
          contract_url: finalContractUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', acceptingRequest.request_id)
        .eq('owner_id', user!.id).eq('status', 'pending').select('request_id').single();
      if (error) throw error;

      setAcceptingRequest(null);
      await fetchData();
      Alert.alert('Payment step opened', 'The renter can now review the contract and follow their selected payment method.');
    } catch (err: any) {
      showError('Could not accept request', err.code === 'PGRST116' ? 'This request has changed or was cancelled. The list will refresh.' : err.message || 'Please try again.');
      await fetchData();
    } finally {
      setActionLoading(null);
      setUploadingAcceptance(false);
    }
  };

  const handleEndRental = async (rentalId: string, userId: string | null, dormName: string, dormId: string) => {
    Alert.alert(
      'End Rental Agreement',
      `Are you sure you want to end the rental agreement for this tenant?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Rental',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(rentalId);
            try {
              const { error } = await supabase.rpc('owner_end_rental', { p_rental_id: rentalId });
              if (error) throw error;
              Alert.alert('Success', 'Rental agreement ended and tenant removed.');
              setTenants(prev => prev.filter(item => (item.rental_id || item.request_id) !== rentalId));
            } catch (err: any) {
              showError('Error', err.message);
            } finally {
              setActionLoading(null);
            }
          }
        }
      ]
    );
  };

  const confirmCashPayment = async (requestId: string) => {
    setActionLoading(requestId);
    try {
      const { error } = await supabase.rpc('owner_confirm_cash_payment', { p_request_id: requestId });
      if (error) throw error;
    } catch (error: any) {
      showError('Confirmation failed', error.message || 'Check your connection and refresh this request.');
    } finally {
      await fetchData();
      setActionLoading(null);
    }
  };

  const ownerAction = async (rpc: string, args: Record<string, unknown>) => {
    if (actionLoading) return;
    const id = String(args.p_request_id || args.p_rental_id || 'action');
    setActionLoading(id);
    try {
      const { error } = await supabase.rpc(rpc, args);
      if (error) throw error;
      logEvent('info', rpc, { userId: user?.id, requestId: String(args.p_request_id || ''), rentalId: String(args.p_rental_id || '') });
      await fetchData();
      return true;
    } catch (error: any) { showError('Action could not be completed', error.message || 'Refresh and try again.'); return false; }
    finally { setActionLoading(null); }
  };

  const selectRefundProof = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') throw new Error('Allow gallery access to select the transfer receipt.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled && result.assets[0]) setRefundProof(result.assets[0].uri);
    } catch (error: any) { showError('Image unavailable', error.message); }
  };
  const sendRefundProof = async () => {
    if (!refundRequest || !refundProof || actionLoading) { if (!refundProof) showError('Proof required', 'Choose the receipt for the GCash refund you sent.'); return; }
    setActionLoading(refundRequest.request_id);
    try {
      const path = await uploadPrivateImage(`${user!.id}/refund-proof/${Date.now()}.${getSafeImageExtension(refundProof)}`, refundProof);
      const { error } = await supabase.rpc('owner_submit_refund', { p_request_id: refundRequest.request_id, p_proof_path: path });
      if (error) throw error;
      logEvent('info', 'owner_refund_proof_sent', { userId: user?.id, requestId: refundRequest.request_id });
      setRefundRequest(null); setRefundProof(''); await fetchData();
    } catch (error: any) { showError('Could not submit refund proof', error.message || 'Your selection is kept. Please retry.'); }
    finally { setActionLoading(null); }
  };
  const extendStay = async () => {
    if (!extendingTenant || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { showError('Check date', 'Enter a valid date in YYYY-MM-DD format.'); return; }
    const date = new Date(endDate + 'T23:59:59+08:00');
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) !== endDate) { showError('Check date', 'Choose a real future date.'); return; }
    if (await ownerAction('owner_extend_rental', { p_rental_id: extendingTenant.rental_id, p_end_date: date.toISOString() })) setExtendingTenant(null);
  };

  if (loadingRole) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#10b981" />
        <Text style={styles.loadingText}>Authenticating owner session...</Text>
      </View>
    );
  }

  if (isOwner !== true) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.deniedTitle}>Access Denied</Text>
        <Text style={styles.deniedText}>
          Only verified Dorm Owners can access this panel.
        </Text>
        <Pressable style={styles.backButton} onPress={() => router.replace('/(tabs)/profile' as any)}>
          <Text style={styles.backButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  const renderRequestItem = ({ item }: { item: any }) => {
    const expanded = expandedRequests.includes(item.request_id);
    return <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={(expanded ? 'Collapse' : 'Expand') + ' request details'} accessibilityState={{ expanded }} onPress={() => setExpandedRequests((current) => expanded ? current.filter((id) => id !== item.request_id) : [...current, item.request_id])} style={({ pressed }) => [styles.summaryRow, pressed && styles.pressed]}>
        <View style={styles.summaryInfo}><Text style={styles.cardTitle}>{item.profiles?.full_name || 'Renter'}</Text><Text style={styles.cardSubtitle}>@{item.profiles?.username || 'renter'}</Text><Text style={styles.cardDorm}>{item.dorms?.name}</Text><Text style={styles.cardDetail}>{new Date(item.created_at).toLocaleDateString()}</Text></View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={AppColors.textSecondary} />
      </Pressable>
      {item.status === 'cancelled' && <Text style={styles.cardDetail}>Cancelled · {item.payment_status === 'pending_verification' ? 'Receipt awaiting review' : item.payment_status === 'paid' ? 'Payment recorded' : 'Closed'}</Text>}
      {expanded && <View style={{ gap: 14, paddingTop: 18 }}>
        <Text style={styles.documentText}>{item.payment_method === 'cash' ? 'Cash in person' : 'QR payment'} · {bookingStatusLabel(item.status)}</Text>
        {item.status === 'cancelled' && <Text style={styles.documentText}>Request cancelled. {item.payment_status === 'pending_verification' ? 'Review the submitted receipt below; confirmation will not reopen the request or allocate a bed. ' : item.payment_status === 'paid' ? 'The renter may request a 90% refund through their booking history. ' : ''}</Text>}
        <ProtectedRequestDocuments requestId={item.request_id} idPath={item.renter_gov_id_url || ''} paymentPath={item.payment_proof_url} onOpen={(document) => router.push({ pathname: '/view-id', params: { requestId: item.request_id, document } } as never)} />
        {item.message ? <Text style={styles.documentText}>{item.message}</Text> : null}
        {item.status === 'pending' && <View style={styles.buttonRow}><Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleDecision(item.request_id, true, item.user_id, item.dorms?.name, item.dorm_id)}><Text style={styles.actionBtnText}>Accept</Text></Pressable><Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleDecision(item.request_id, false, item.user_id, item.dorms?.name, item.dorm_id)}><Text style={styles.actionBtnText}>Decline</Text></Pressable></View>}
        {item.status === 'awaiting_cash' && <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => Alert.alert('Confirm cash received?', 'Confirm only after receiving the payment in person. This records the tenancy and updates available slots.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Confirm payment', onPress: () => void confirmCashPayment(item.request_id) }])}><Text style={styles.actionBtnText}>Confirm cash received</Text></Pressable>}
        {(item.status === 'payment_submitted' || (item.status === 'cancelled' && item.payment_status === 'pending_verification')) && <View style={styles.buttonRow}>
          <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => Alert.alert('Confirm QR payment?', `Confirm only after checking the actual payment in your account. ${item.status === 'cancelled' ? 'This request stays cancelled and no slot will be allocated.' : 'This confirms the booking and allocates one available slot.'}`, [{ text: 'Not yet', style: 'cancel' }, { text: 'Confirm received', onPress: () => void ownerAction('owner_confirm_qr_payment', { p_request_id: item.request_id, p_approved: true }) }])}><Text style={styles.actionBtnText}>Confirm payment</Text></Pressable>
          <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.rejectBtn]} onPress={() => Alert.alert('Reject this receipt?', 'Use this only when the payment cannot be verified. The renter can upload a corrected receipt for an open request.', [{ text: 'Go back', style: 'cancel' }, { text: 'Reject receipt', style: 'destructive', onPress: () => void ownerAction('owner_confirm_qr_payment', { p_request_id: item.request_id, p_approved: false }) }])}><Text style={styles.actionBtnText}>Reject receipt</Text></Pressable>
        </View>}
        {item.status === 'reserved' && <View style={styles.buttonRow}>
          <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => Alert.alert('Start this tenancy?', 'Convert the confirmed reservation when the renter moves in. The existing reserved slot is reused; capacity will not be counted twice.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Start tenancy', onPress: () => void ownerAction('convert_reservation_to_rental', { p_request_id: item.request_id }) }])}><Text style={styles.actionBtnText}>Start tenancy</Text></Pressable>
          <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.cancelModalBtn]} onPress={() => Alert.alert('Release this reservation?', 'The slot becomes available again. Payment remains recorded and the renter can still request their 90% refund. This does not send any money.', [{ text: 'Keep reservation', style: 'cancel' }, { text: 'Release slot', style: 'destructive', onPress: () => void ownerAction('owner_release_reservation', { p_request_id: item.request_id }) }])}><Text style={styles.cancelModalBtnText}>Release slot</Text></Pressable>
        </View>}
        {['refund_requested', 'refund_sent'].includes(item.status) && <View style={{ gap: 12 }}>
          <Text style={styles.cardTitle}>Refund: ₱{Number(item.refund_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</Text>
          <Text style={styles.documentText}>90% of the recorded payment · 10% deduction: ₱{Number(item.refund_deduction || 0).toLocaleString('en-PH')}</Text>
          <Text style={styles.documentText}>GCash: {item.renter_gcash_name} · {item.renter_gcash_number}</Text>
          {item.cancel_reason && <Text style={styles.documentText}>Reason: {item.cancel_reason}</Text>}
          <BookingDocument path={item.renter_refund_qr_url} label="Renter GCash refund QR" />
          <BookingDocument path={item.refund_proof_url} label="Refund transfer proof" />
          {item.status === 'refund_requested' ? <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => { setRefundRequest(item); setRefundProof(''); }}><Text style={styles.actionBtnText}>Add refund transfer proof</Text></Pressable> : <Text style={styles.documentText}>Waiting for the renter to confirm receipt. Do not send the refund twice.</Text>}
        </View>}
      </View>}
    </View>;
  };

  const renderTenantItem = ({ item }: { item: any }) => {
    const tenantId = item.rental_id || item.request_id;
    const expanded = expandedTenants.includes(tenantId);
    const isOffline = !item.user_id;
    const displayName = item.renters?.full_name || item.profiles?.full_name || item.renter_name || 'Tenant';
    const subtitleText = isOffline ? 'Offline tenant' : `@${item.renters?.username || item.profiles?.username || 'renter'}`;
    const agreementStart = item.start_date || item.updated_at;

    return (
      <View style={styles.card}>
        <Pressable accessibilityRole="button" accessibilityLabel={(expanded ? 'Collapse' : 'Expand') + ' tenant details for ' + displayName} accessibilityState={{ expanded }} onPress={() => setExpandedTenants((current) => expanded ? current.filter((id) => id !== tenantId) : [...current, tenantId])} style={({ pressed }) => [styles.summaryRow, pressed && styles.pressed]}>
          <View style={styles.summaryInfo}>
            <Text style={styles.cardTitle}>{displayName}</Text>
            <Text style={[styles.cardSubtitle, isOffline && { color: AppColors.textSecondary }]}>{subtitleText}</Text>
            <Text style={styles.cardDorm}>{item.dorms?.name}</Text>
          </View>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={AppColors.textSecondary} />
        </Pressable>
        {expanded && <View style={styles.tenantDetails}>
          <Text style={styles.cardDetail}>Agreement start: {new Date(agreementStart).toLocaleDateString()}</Text>
          {item.planned_end_date && <Text style={styles.cardDetail}>Planned end: {new Date(item.planned_end_date).toLocaleDateString()}</Text>}
          {isOffline && item.renter_phone && <Text style={styles.cardDorm}>Contact: {item.renter_phone}</Text>}
          <View style={styles.tenantActions}>
            <Pressable style={({ pressed }) => [styles.actionBtn, styles.cancelModalBtn, pressed && styles.pressed]} disabled={actionLoading !== null} onPress={() => { setExtendingTenant(item); setEndDate(item.planned_end_date?.slice(0, 10) || ''); }}><Text style={styles.cancelModalBtnText}>Extend stay</Text></Pressable>
            <Pressable style={({ pressed }) => [styles.actionBtn, styles.endBtn, (pressed || actionLoading === tenantId) && styles.disabledBtn]} onPress={() => handleEndRental(tenantId, item.user_id, item.dorms?.name, item.dorm_id)} disabled={actionLoading !== null}><Text style={styles.actionBtnText}>End tenancy</Text></Pressable>
          </View>
        </View>}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {loadError ? <Pressable onPress={() => void fetchData()} style={{ margin: 16, padding: 12, borderRadius: 10, backgroundColor: AppColors.errorBg }}><Text style={{ color: AppColors.error }}>{loadError}</Text></Pressable> : null}
      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabContainer} contentContainerStyle={{ flexGrow: 1 }}>
        <Pressable
          style={[styles.tab, activeTab === 'reservations' && styles.activeTab]}
          onPress={() => setActiveTab('reservations')}
        >
          <Ionicons name="calendar-outline" size={20} color={AppColors.accent} />
          <Text style={[styles.tabText, activeTab === 'reservations' && styles.activeTabText]}>Reserved ({reservations.length})</Text>
        </Pressable>
        <Pressable 
          style={[styles.tab, activeTab === 'requests' && styles.activeTab]}
          onPress={() => setActiveTab('requests')}
        >
          <Ionicons name="file-tray-outline" size={20} color={AppColors.accent} />
          <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>
            Requests ({rentalRequests.length})
          </Text>
        </Pressable>
        <Pressable 
          style={[styles.tab, activeTab === 'tenants' && styles.activeTab]}
          onPress={() => setActiveTab('tenants')}
        >
          <Ionicons name="people-outline" size={20} color={AppColors.accent} />
          <Text style={[styles.tabText, activeTab === 'tenants' && styles.activeTabText]}>
            Tenants ({tenants.length})
          </Text>
        </Pressable>
        <Pressable style={[styles.tab,activeTab === 'history' && styles.activeTab]} onPress={() => setActiveTab('history')}><Ionicons name="time-outline" size={20} color={AppColors.accent} /><Text style={[styles.tabText,activeTab === 'history' && styles.activeTabText]}>Closed requests ({requestHistory.length})</Text></Pressable>
      </ScrollView>

      <View style={styles.listTools}>
        <View style={styles.searchField}>
          <Ionicons name="search-outline" size={21} color={AppColors.textSecondary} />
          <TextInput value={searchText} onChangeText={setSearchText} placeholder={activeTab === 'tenants' ? 'Search tenants' : activeTab === 'reservations' ? 'Search reservations' : activeTab === 'history' ? 'Search closed requests' : 'Search requests'} placeholderTextColor={AppColors.placeholder} style={styles.searchInput} autoCapitalize="none" accessibilityLabel="Search by tenant name, username, contact, or dormitory" />
          {searchText ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setSearchText('')} style={styles.clearSearch}><Ionicons name="close-circle" size={20} color={AppColors.textSecondary} /></Pressable> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={'Choose dormitory: ' + (dormFilter === 'all' ? 'All dormitories' : selectedFilterDorm?.name || 'Selected dormitory')} accessibilityState={{ expanded: dormPickerOpen }} onPress={() => { Keyboard.dismiss(); setDormQuery(''); setDormPickerOpen(true); }} style={({ pressed }) => [styles.dormSelector, pressed && styles.pressed]}>
          <View style={styles.dormSelectorIcon}><Ionicons name="home-outline" size={22} color={AppColors.accent} /></View>
          <View style={styles.dormSelectorCopy}><Text style={styles.filterLabel}>Dormitory</Text><Text style={styles.dormSelectorName}>{dormFilter === 'all' ? 'All dormitories' : selectedFilterDorm?.name || 'Selected dormitory'}</Text></View>
          <Ionicons name="chevron-down" size={20} color={AppColors.textSecondary} />
        </Pressable>
        <Text style={styles.resultsNote}>{activityRows.length} shown{hasActiveFilters ? ' · Search and dorm filter applied' : ''}{activeTab === 'history' ? ' · Completed, cancelled, declined, and refunded requests' : ''}</Text>
      </View>

      {/* Add Offline Tenant Action Header */}
      {activeTab === 'tenants' && (
        <View style={styles.actionHeader}>
          <Pressable style={styles.historyButton} onPress={() => router.push({ pathname: '/tenant-history', params: { dormId: dormFilter === 'all' ? '' : dormFilter } } as never)}><Ionicons name="time-outline" size={19} color={AppColors.accent} /><Text style={{ color: AppColors.accent }}>Past tenants</Text></Pressable>
          <Pressable 
            style={styles.addTenantBtn}
            onPress={() => {
              fetchOwnerDorms();
              setIsAddModalVisible(true);
            }}
          >
            <Text style={styles.addTenantBtnText}>+ Add Offline Tenant</Text>
          </Pressable>
        </View>
      )}

      {/* Main List */}
      {!loaded && refreshing ? <View style={[styles.centered, { flex: 1 }]}><ActivityIndicator color={AppColors.accent} /><Text style={styles.loadingText}>Loading owner activity…</Text></View> : <FlatList
        data={activityRows}
        keyExtractor={(item) => activeTab === 'tenants' ? item.rental_id || item.request_id : item.request_id}
        renderItem={activeTab === 'tenants' ? renderTenantItem : renderRequestItem}
        refreshing={refreshing}
        onRefresh={fetchData}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {hasActiveFilters ? 'No results for this search and dormitory.' : activeTab === 'requests' ? 'No rental requests needing attention' : activeTab === 'reservations' ? 'No confirmed reservations yet' : activeTab === 'history' ? 'No closed requests yet' : 'No active tenants currently renting your dorms'}
            </Text>
            {hasActiveFilters && <Pressable onPress={() => { setSearchText(''); setDormFilter('all'); }} style={styles.resetFilters}><Text style={styles.resetFiltersText}>Clear search & dorm filter</Text></Pressable>}
          </View>
        }
      />}

      <Host style={styles.dormSheetHost} colorScheme="dark" seedColor={AppColors.accent}>
        <BottomSheet isPresented={dormPickerOpen} onDismiss={closeDormPicker} snapPoints={['full']} contentPadding={0} showDragIndicator={false} testID="owner-dorm-selector">
          <RNHostView style={{ height: Math.max(180, height - insets.top - insets.bottom - 24), backgroundColor: AppColors.background }}>
            <View style={[styles.dormSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.dormSheetHeader}>
                <View style={styles.dormSelectorCopy}><Text style={styles.dormSheetTitle}>Choose a dormitory</Text><Text style={styles.dormSheetHelp}>Filter your owner activity by listing</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close dormitory selector" onPress={closeDormPicker} style={styles.clearSearch}><Ionicons name="close" size={24} color={AppColors.textSecondary} /></Pressable>
              </View>
              <View style={styles.searchField}>
                <Ionicons name="search-outline" size={21} color={AppColors.textSecondary} />
                <TextInput value={dormQuery} onChangeText={setDormQuery} placeholder="Search your dormitories" placeholderTextColor={AppColors.placeholder} style={styles.searchInput} autoCapitalize="none" accessibilityLabel="Search dormitories by name or address" />
                {dormQuery ? <Pressable accessibilityLabel="Clear dormitory search" onPress={() => setDormQuery('')} style={styles.clearSearch}><Ionicons name="close-circle" size={20} color={AppColors.textSecondary} /></Pressable> : null}
              </View>
              <FlatList data={filteredDormOptions} keyExtractor={(dorm) => dorm.dorm_id} style={styles.dormSheetList} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.dormSheetListContent}
                ListHeaderComponent={<Pressable accessibilityRole="button" accessibilityState={{ selected: dormFilter === 'all' }} onPress={() => chooseDormFilter('all')} style={({ pressed }) => [styles.dormChoice, dormFilter === 'all' && styles.dormChoiceSelected, pressed && styles.pressed]}><View style={styles.dormChoiceImage}><Ionicons name="grid-outline" size={24} color={AppColors.accent} /></View><View style={styles.dormSelectorCopy}><Text style={styles.dormChoiceName}>All dormitories</Text><Text style={styles.dormChoiceAddress}>All your listings</Text></View>{dormFilter === 'all' && <Ionicons name="checkmark-circle" size={24} color={AppColors.accent} />}</Pressable>}
                renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: dormFilter === item.dorm_id }} onPress={() => chooseDormFilter(item.dorm_id)} style={({ pressed }) => [styles.dormChoice, dormFilter === item.dorm_id && styles.dormChoiceSelected, pressed && styles.pressed]}>
                  {item.images?.[0] && !failedDormImages.includes(item.dorm_id) ? <ExpoImage source={{ uri: item.images[0] }} contentFit="cover" style={styles.dormChoiceImage} onError={() => setFailedDormImages((current) => current.includes(item.dorm_id) ? current : [...current, item.dorm_id])} /> : <View style={styles.dormChoiceImage}><Ionicons name="home-outline" size={24} color={AppColors.textSecondary} /></View>}
                  <View style={styles.dormSelectorCopy}><Text style={styles.dormChoiceName}>{item.name}</Text>{item.address ? <Text style={styles.dormChoiceAddress}>{item.address}</Text> : null}</View>
                  {dormFilter === item.dorm_id && <Ionicons name="checkmark-circle" size={24} color={AppColors.accent} />}
                </Pressable>}
                ListEmptyComponent={<View style={styles.dormPickerEmpty}><Text style={styles.dormChoiceName}>{dormQuery.trim() ? 'No dormitories found' : 'No dormitory listings yet'}</Text><Text style={styles.dormSheetHelp}>{dormQuery.trim() ? 'Try another name or address.' : 'Your listings will appear here.'}</Text></View>}
              />
              <Pressable onPress={() => chooseDormFilter('all')} style={({ pressed }) => [styles.clearDormFilter, pressed && styles.pressed]}><Text style={styles.resetFiltersText}>Clear dormitory filter</Text></Pressable>
            </View>
          </RNHostView>
        </BottomSheet>
      </Host>

      <Modal visible={Boolean(refundRequest)} transparent animationType="slide" onRequestClose={() => { if (!actionLoading) setRefundRequest(null); }}>
        <View style={[styles.modalBackground, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}><View style={styles.modalContent}>
          <ScrollView keyboardShouldPersistTaps="handled"><Text style={styles.modalTitle}>Record refund sent</Text><Text style={styles.documentText}>Send ₱{Number(refundRequest?.refund_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} to {refundRequest?.renter_gcash_name} ({refundRequest?.renter_gcash_number}) in GCash, then attach the receipt. RoomScout does not transfer money.</Text>
          <Pressable style={[styles.pickGalleryBtn, { marginTop: 18 }]} onPress={() => void selectRefundProof()}>{refundProof && <Image source={{ uri: refundProof }} style={styles.imagePickerPreview} />}<Ionicons name="image-outline" size={26} color={AppColors.accent} /><Text style={styles.pickGalleryBtnText}>{refundProof ? 'Change transfer receipt' : 'Choose transfer receipt'}</Text></Pressable></ScrollView>
          <View style={styles.modalActions}><Pressable disabled={actionLoading !== null} style={[styles.modalActionBtn, styles.cancelModalBtn]} onPress={() => setRefundRequest(null)}><Text style={styles.cancelModalBtnText}>Go back</Text></Pressable><Pressable disabled={actionLoading !== null} style={[styles.modalActionBtn, styles.approveBtn]} onPress={() => void sendRefundProof()}>{actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Submit proof</Text>}</Pressable></View>
        </View></View><ErrorToast />
      </Modal>
      <Modal visible={Boolean(extendingTenant)} transparent animationType="slide" onRequestClose={() => { if (!actionLoading) setExtendingTenant(null); }}>
        <View style={[styles.modalBackground, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}><View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Extend stay</Text><Text style={styles.documentText}>Set the planned end date agreed with your tenant. This does not charge another payment.</Text><Text style={styles.formLabel}>New end date (YYYY-MM-DD)</Text><TextInput style={styles.input} placeholder="2027-06-30" placeholderTextColor={AppColors.placeholder} value={endDate} onChangeText={setEndDate} maxLength={10} autoCapitalize="none" />
          <View style={styles.modalActions}><Pressable disabled={actionLoading !== null} style={[styles.modalActionBtn, styles.cancelModalBtn]} onPress={() => setExtendingTenant(null)}><Text style={styles.cancelModalBtnText}>Go back</Text></Pressable><Pressable disabled={actionLoading !== null} style={[styles.modalActionBtn, styles.approveBtn]} onPress={() => void extendStay()}>{actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Save extension</Text>}</Pressable></View>
        </View></View><ErrorToast />
      </Modal>

      <Modal visible={Boolean(acceptingRequest)} transparent={true} animationType="slide">
        <View style={[styles.modalBackground, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
              <Text style={styles.modalTitle}>Accept & send payment details</Text>

              <Text style={styles.formLabel}>Required amount (₱)</Text>
              <TextInput placeholderTextColor={AppColors.placeholder}
                style={styles.input}
                keyboardType="decimal-pad"
                value={requiredAmount}
                onChangeText={setRequiredAmount}
                placeholder="Amount in PHP"
              />

              {acceptingRequest?.payment_method !== 'cash' && <>
              <Text style={styles.formLabel}>Payment QR Code Photo</Text>
              {ownerQrUrl ? (
                <View style={styles.imagePickerPreviewBox}>
                  <Image source={{ uri: ownerQrUrl }} style={styles.imagePickerPreview} />
                  <Pressable style={styles.changeImageBtn} onPress={pickQrImage}>
                    <Text style={styles.changeImageText}>Change QR Image</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.pickGalleryBtn} onPress={pickQrImage}>
                  <Text style={styles.pickGalleryBtnText}>Select QR image</Text>
                </Pressable>
              )}

              </>}
              <Text style={styles.formLabel}>Contract Document Photo</Text>
              {contractUrl ? (
                <View style={styles.imagePickerPreviewBox}>
                  <Image source={{ uri: contractUrl }} style={styles.imagePickerPreview} />
                  <Pressable style={styles.changeImageBtn} onPress={pickContractImage}>
                    <Text style={styles.changeImageText}>Change Contract Photo</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.pickGalleryBtn} onPress={pickContractImage}>
                  <Text style={styles.pickGalleryBtnText}>Select contract image</Text>
                </Pressable>
              )}

              <Text style={styles.noDormsWarning}>
                The dorm remains available until payment is verified and the transaction is confirmed.
              </Text>
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalActionBtn, styles.cancelModalBtn]}
                onPress={() => setAcceptingRequest(null)}
                disabled={uploadingAcceptance}
              >
                <Text style={styles.cancelModalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalActionBtn, styles.approveBtn, uploadingAcceptance && styles.disabledBtn]}
                onPress={submitAcceptance}
                disabled={uploadingAcceptance}
              >
                {uploadingAcceptance ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.actionBtnText}>Send to renter</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
        <ErrorToast />
      </Modal>

      {/* Add Offline Tenant Modal */}
      <Modal visible={isAddModalVisible} transparent={true} animationType="slide">
        <View style={[styles.modalBackground, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Tenant Manually (Offline)</Text>
            
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.formLabel}>Select Dormitory</Text>
              {ownerDorms.length === 0 ? (
                <Text style={styles.noDormsWarning}>No available dormitories to lease. Make sure your listings are marked available.</Text>
              ) : (
                <View style={styles.dormPickerContainer}>
                  {ownerDorms.map((dorm) => (
                    <Pressable
                      key={dorm.dorm_id}
                      style={[
                        styles.dormOption,
                        selectedDormId === dorm.dorm_id && styles.dormOptionSelected
                      ]}
                      onPress={() => setSelectedDormId(dorm.dorm_id)}
                    >
                      <Text style={[
                        styles.dormOptionText,
                        selectedDormId === dorm.dorm_id && styles.dormOptionTextSelected
                      ]}>
                        {dorm.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={styles.formLabel}>Tenant Name</Text>
              <TextInput placeholderTextColor={AppColors.placeholder}
                style={styles.input}
                placeholder="Enter tenant's full name"
                value={offlineName}
                onChangeText={setOfflineName}
              />

              <Text style={styles.formLabel}>Tenant Phone Number</Text>
              <TextInput placeholderTextColor={AppColors.placeholder}
                style={styles.input}
                placeholder="Enter phone number (optional)"
                value={offlinePhone}
                onChangeText={setOfflinePhone}
                keyboardType="phone-pad"
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable 
                style={[styles.modalActionBtn, styles.cancelModalBtn]} 
                onPress={() => {
                  setIsAddModalVisible(false);
                  setOfflineName('');
                  setOfflinePhone('');
                }}
              >
                <Text style={styles.cancelModalBtnText}>Cancel</Text>
              </Pressable>
              <Pressable 
                style={[
                  styles.modalActionBtn, 
                  styles.submitModalBtn, 
                  (addingRenter || ownerDorms.length === 0) && styles.disabledBtn
                ]} 
                onPress={handleAddOfflineTenant}
                disabled={addingRenter || ownerDorms.length === 0}
              >
                {addingRenter ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitModalBtnText}>Add Tenant</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
        <ErrorToast />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: AppColors.textSecondary,
    fontWeight: '500',
  },
  deniedTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ef4444',
    marginBottom: 10,
  },
  deniedText: {
    fontSize: 16,
    color: AppColors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  backButton: {
    backgroundColor: '#10b981',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  tabContainer: {
    flexGrow: 0,
    backgroundColor: AppColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.borderSubtle,
  },
  tab: {
    flexGrow: 1,
    minWidth: 100,
    paddingHorizontal: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: AppColors.accent,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: AppColors.textSecondary,
  },
  activeTabText: {
    color: AppColors.accent,
  },
  listContainer: {
    padding: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  listTools: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: AppColors.input, borderWidth: StyleSheet.hairlineWidth, borderColor: AppColors.inputBorder, borderRadius: 10, borderCurve: 'continuous', paddingHorizontal: 12 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, color: AppColors.text, fontSize: 15, paddingVertical: 12 },
  clearSearch: { minWidth: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  filterLabel: { color: AppColors.textSecondary, fontSize: 13, fontWeight: '600' },
  dormSelector: { minHeight: 64, paddingHorizontal: 12, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: AppColors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: AppColors.inputBorder, borderRadius: 10, borderCurve: 'continuous' },
  dormSelectorIcon: { width: 32, alignItems: 'center', justifyContent: 'center' },
  dormSelectorCopy: { flex: 1, minWidth: 0, gap: 4 },
  dormSelectorName: { color: AppColors.text, fontSize: 15, fontWeight: '600' },
  dormSheetHost: { position: 'absolute', width: 0, height: 0 },
  dormSheet: { flex: 1, backgroundColor: AppColors.background, paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  dormSheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dormSheetTitle: { color: AppColors.text, fontSize: 20, fontWeight: '700' },
  dormSheetHelp: { color: AppColors.textSecondary, fontSize: 13, lineHeight: 19 },
  dormSheetList: { flex: 1 },
  dormSheetListContent: { gap: 4, paddingBottom: 8 },
  dormChoice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 80, padding: 12, borderRadius: 10, borderCurve: 'continuous' },
  dormChoiceSelected: { backgroundColor: AppColors.surfaceElevated },
  dormChoiceImage: { width: 52, height: 52, borderRadius: 10, backgroundColor: AppColors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  dormChoiceName: { color: AppColors.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  dormChoiceAddress: { color: AppColors.textSecondary, fontSize: 13, lineHeight: 19 },
  dormPickerEmpty: { paddingVertical: 24, paddingHorizontal: 12, gap: 8 },
  clearDormFilter: { minHeight: 48, padding: 12, borderRadius: 10, borderCurve: 'continuous', backgroundColor: AppColors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  resultsNote: { color: AppColors.textMuted, fontSize: 12, lineHeight: 18 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  summaryInfo: { flex: 1, minWidth: 0 },
  tenantDetails: { paddingTop: 16, gap: 8 },
  tenantActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  pressed: { opacity: 0.65 },
  resetFilters: { minHeight: 44, padding: 12, marginTop: 12, justifyContent: 'center' },
  resetFiltersText: { color: AppColors.accent, fontWeight: '600', textAlign: 'center' },
  actionHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  historyButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  addTenantBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    elevation: 1,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  addTenantBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  card: {
    backgroundColor: AppColors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  cardInfo: {
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: AppColors.text,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#10b981',
    fontWeight: '600',
    marginBottom: 8,
  },
  cardDorm: {
    fontSize: 14,
    color: AppColors.textSecondary,
    marginBottom: 4,
  },
  boldText: {
    fontWeight: '600',
    color: AppColors.text,
  },
  cardDetail: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  documentContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  documentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: AppColors.textSecondary,
    marginTop: 4,
  },
  documentLink: {
    fontSize: 13,
    color: '#3b82f6',
    textDecorationLine: 'underline',
    marginBottom: 4,
  },
  documentText: {
    fontSize: 13,
    color: AppColors.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    minWidth: 120,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtn: {
    backgroundColor: '#10b981',
  },
  rejectBtn: {
    backgroundColor: '#ef4444',
  },
  endBtn: {
    backgroundColor: '#ef4444',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyContainer: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#94a3b8',
    textAlign: 'center',
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  modalContent: {
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.surface,
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    maxHeight: '85%',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    color: AppColors.text,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: AppColors.textSecondary,
    marginTop: 12,
    marginBottom: 6,
  },
  noDormsWarning: {
    color: AppColors.textSecondary,
    backgroundColor: AppColors.surfaceElevated,
    borderColor: AppColors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  dormPickerContainer: {
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    borderRadius: 8,
    padding: 6,
    backgroundColor: AppColors.input,
    marginBottom: 12,
  },
  dormOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 4,
  },
  dormOptionSelected: {
    backgroundColor: AppColors.accentMuted,
  },
  dormOptionText: {
    color: AppColors.textSecondary,
    fontSize: 14,
  },
  dormOptionTextSelected: {
    color: '#0891b2',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: AppColors.text,
    backgroundColor: AppColors.input,
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 18,
  },
  modalActionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelModalBtn: {
    backgroundColor: AppColors.surfaceElevated,
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
  },
  cancelModalBtnText: {
    color: AppColors.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  submitModalBtn: {
    backgroundColor: '#10b981',
  },
  submitModalBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  pickGalleryBtn: {
    backgroundColor: AppColors.surfaceElevated,
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  pickGalleryBtnText: {
    color: '#2563eb',
    fontWeight: '600',
    fontSize: 13,
  },
  imagePickerPreviewBox: {
    marginBottom: 12,
    alignItems: 'center',
    backgroundColor: AppColors.input,
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  imagePickerPreview: {
    width: '100%',
    height: 140,
    borderRadius: 6,
    resizeMode: 'cover',
  },
  changeImageBtn: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
  },
  changeImageText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
});
