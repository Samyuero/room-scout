import { ProtectedRequestDocuments } from '@/components/protected-request-documents';
import { ErrorToast, showError } from '@/components/error-toast';
import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Alert, Modal, TextInput, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppColors } from '@/constants/theme';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getSafeImageExtension, uploadPrivateImage } from '@/utils/imageUpload';

export default function OwnerPanelScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ dormId?: string; tab?: string }>();

  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [activeTab, setActiveTab] = useState<'requests' | 'tenants'>(params.tab === 'tenants' ? 'tenants' : 'requests');

  const [expandedRequests, setExpandedRequests] = useState<string[]>([]);
  const [rentalRequests, setRentalRequests] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
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
      const { data, error } = await supabase
        .from('owners')
        .select('owner_id')
        .eq('owner_id', user.id)
        .maybeSingle();

      if (error) throw error;
      setIsOwner(!!data);
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
      const { data, error } = await supabase.rpc('get_owner_rental_dashboard', { p_dorm_id: params.dormId || null });
      if (error) throw error;
      setRentalRequests((data?.requests || []).filter((request: any) => !['approved', 'reserved', 'rejected', 'refund_completed'].includes(request.status)));
      setTenants(data?.tenants || []);
    } catch (err: any) {
      showError('Error Fetching Data', err.message);
    } finally {
      setRefreshing(false);
    }
  }, [isOwner, params.dormId]);

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
      <Pressable accessibilityLabel="Expand request details" onPress={() => setExpandedRequests((current) => expanded ? current.filter((id) => id !== item.request_id) : [...current, item.request_id])} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{item.profiles?.full_name || 'Renter'}</Text><Text style={styles.cardSubtitle}>@{item.profiles?.username || 'renter'}</Text><Text style={styles.cardDorm}>Dormitory: {item.dorms?.name}</Text><Text style={styles.cardDetail}>{new Date(item.created_at).toLocaleDateString()}</Text></View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={AppColors.textSecondary} />
      </Pressable>
      {item.status === 'cancelled' && <Text style={styles.cardDetail}>Cancelled · {item.payment_status === 'pending_verification' ? 'Receipt awaiting review' : item.payment_status === 'paid' ? 'Payment recorded' : 'Closed'}</Text>}
      {expanded && <View style={{ gap: 14, paddingTop: 18 }}>
        <Text style={styles.documentText}>{item.payment_method === 'cash' ? 'Cash in person' : 'QR payment'} · {item.status === 'awaiting_cash' ? 'Pending cash payment' : item.status.replace(/_/g, ' ')}</Text>
        {item.status === 'cancelled' && <Text style={styles.documentText}>Cancelled by the renter. {item.payment_status === 'pending_verification' ? 'The submitted receipt remains in the admin review queue. ' : item.payment_status === 'paid' ? 'Payment was recorded before cancellation. ' : ''}No refund is issued by RoomScout. Any payment return must be arranged directly outside this app.</Text>}
        <ProtectedRequestDocuments requestId={item.request_id} idPath={item.renter_gov_id_url || ''} paymentPath={item.payment_proof_url} onOpen={(document) => router.push({ pathname: '/view-id', params: { requestId: item.request_id, document } } as never)} />
        {item.message ? <Text style={styles.documentText}>{item.message}</Text> : null}
        {item.status === 'pending' && <View style={styles.buttonRow}><Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleDecision(item.request_id, true, item.user_id, item.dorms?.name, item.dorm_id)}><Text style={styles.actionBtnText}>Accept</Text></Pressable><Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleDecision(item.request_id, false, item.user_id, item.dorms?.name, item.dorm_id)}><Text style={styles.actionBtnText}>Decline</Text></Pressable></View>}
        {item.status === 'awaiting_cash' && <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => Alert.alert('Confirm cash received?', 'Confirm only after receiving the payment in person. This records the tenancy and updates available slots.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Confirm payment', onPress: () => void confirmCashPayment(item.request_id) }])}><Text style={styles.actionBtnText}>Confirm cash received</Text></Pressable>}
      </View>}
    </View>;
  };

  const renderTenantItem = ({ item }: { item: any }) => {
    const isOffline = !item.user_id;
    const displayName = isOffline ? `${item.renter_name} (Offline)` : (item.renters?.full_name || item.profiles?.full_name || item.renter_name || 'Registered User');
    const subtitleText = isOffline ? `Phone: ${item.renter_phone || 'None'}` : `@${item.renters?.username || item.profiles?.username || 'renter'}`;
    const agreementStart = item.start_date || item.updated_at;

    return (
      <View style={styles.card}>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{displayName}</Text>
          <Text style={[styles.cardSubtitle, isOffline && { color: AppColors.textSecondary }]}>{subtitleText}</Text>
          <Text style={styles.cardDorm}>Renting: <Text style={styles.boldText}>{item.dorms?.name}</Text></Text>
          <Text style={styles.cardDetail}>Agreement Start: {new Date(agreementStart).toLocaleDateString()}</Text>
        </View>
        <Pressable
          style={[styles.actionBtn, styles.endBtn, actionLoading === (item.rental_id || item.request_id) && styles.disabledBtn]}
          onPress={() => handleEndRental(item.rental_id || item.request_id, item.user_id, item.dorms?.name, item.dorm_id)}
          disabled={actionLoading !== null}
        >
          <Text style={styles.actionBtnText}>End Rental / Remove Tenant</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {params.dormId && <Pressable onPress={() => router.setParams({ dormId: '' })} style={{ padding: 14 }}><Text style={{ color: '#007AFF' }}>Showing this dorm · Show all dorms</Text></Pressable>}
      {/* Tabs */}
      <View style={styles.tabContainer}>
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
      </View>

      {/* Add Offline Tenant Action Header */}
      {activeTab === 'tenants' && (
        <View style={styles.actionHeader}>
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
      <FlatList
        data={activeTab === 'requests' ? rentalRequests : tenants}
        keyExtractor={(item) => activeTab === 'requests' ? item.request_id : (item.rental_id || item.request_id)}
        renderItem={activeTab === 'requests' ? renderRequestItem : renderTenantItem}
        refreshing={refreshing}
        onRefresh={fetchData}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {activeTab === 'requests' 
                ? 'No pending rental requests' 
                : 'No active tenants currently renting your dorms'}
            </Text>
          </View>
        }
      />

      <Modal visible={Boolean(acceptingRequest)} transparent={true} animationType="slide">
        <View style={styles.modalBackground}>
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
        <View style={styles.modalBackground}>
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
    flexDirection: 'row',
    backgroundColor: AppColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: '#10b981',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: AppColors.textSecondary,
  },
  activeTabText: {
    color: '#10b981',
  },
  listContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  actionHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
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
    borderColor: '#e2e8f0',
  },
  cardInfo: {
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 18,
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
    justifyContent: 'space-between',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
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
