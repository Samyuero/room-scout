import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Alert, Modal, TextInput, ScrollView } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { useRouter } from 'expo-router';

export default function OwnerPanelScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [activeTab, setActiveTab] = useState<'requests' | 'tenants'>('requests');

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

  const checkOwnerRole = async () => {
    if (!user) {
      setIsOwner(false);
      setLoadingRole(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('profile_id', user.id)
        .single();

      if (error) throw error;
      setIsOwner(data?.role === 'owner' || data?.role === 'admin');
    } catch (err) {
      console.error('Error checking owner role:', err);
      setIsOwner(false);
    } finally {
      setLoadingRole(false);
    }
  };

  useEffect(() => {
    checkOwnerRole();
  }, [user]);

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
      Alert.alert('Selection Error', 'Please select an available dormitory.');
      return;
    }
    if (!offlineName.trim()) {
      Alert.alert('Input Error', 'Please enter the renter\'s name.');
      return;
    }

    setAddingRenter(true);
    try {
      // Try inserting into rentals table (which user will add soon)
      const { error: insertError } = await supabase
        .from('rentals')
        .insert({
          dorm_id: selectedDormId,
          renter_name: offlineName.trim(),
          renter_phone: offlinePhone.trim() || null,
          status: 'active',
          start_date: new Date().toISOString(),
        });

      if (insertError) {
        // Handle fallback if database additions haven't been run yet
        if (insertError.message.includes('relation') || insertError.code === '42P01') {
          Alert.alert(
            'Database Update Required',
            'To add offline tenants, please apply the SQL Query for Database Additions in your Supabase dashboard first.'
          );
          return;
        }
        throw insertError;
      }

      // Update dorm availability to false
      const { error: dormError } = await supabase
        .from('dorms')
        .update({ available: false, updated_at: new Date().toISOString() })
        .eq('dorm_id', selectedDormId);

      if (dormError) throw dormError;

      Alert.alert('Success', 'Offline tenant added and dorm marked as unavailable.');
      setIsAddModalVisible(false);
      setOfflineName('');
      setOfflinePhone('');
      fetchData(); // Refresh list
    } catch (err: any) {
      Alert.alert('Error Adding Tenant', err.message);
    } finally {
      setAddingRenter(false);
    }
  };

  const fetchData = async () => {
    if (isOwner !== true) return;
    setRefreshing(true);
    try {
      if (activeTab === 'requests') {
        const { data: requestsData, error: reqError } = await supabase
          .from('rental_requests')
          .select('*, dorms:dorm_id (name)')
          .eq('owner_id', user!.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

        if (reqError) throw reqError;

        if (!requestsData || requestsData.length === 0) {
          setRentalRequests([]);
          return;
        }

        // Get unique user IDs and fetch profiles
        const userIds = [...new Set(requestsData.map((r: any) => r.user_id))];
        const { data: profilesData, error: profError } = await supabase
          .from('profiles')
          .select('profile_id, full_name, username, avatar_url')
          .in('profile_id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

        if (profError) throw profError;

        const profileMap: Record<string, any> = {};
        (profilesData || []).forEach((p: any) => { profileMap[p.profile_id] = p; });

        const merged = requestsData.map((req: any) => ({
          ...req,
          profiles: profileMap[req.user_id] || null,
        }));

        setRentalRequests(merged);
      } else {
        // Fetch active rentals from 'rentals' table
        try {
          const { data: rentalsData, error: rentError } = await supabase
            .from('rentals')
            .select('*, dorms!inner(name, owner_id), profiles(profile_id, full_name, username, avatar_url)')
            .eq('dorms.owner_id', user!.id)
            .eq('status', 'active')
            .order('start_date', { ascending: false });

          if (rentError) {
            // Check if rentals table doesn't exist
            if (rentError.message.includes('relation') || rentError.code === '42P01') {
              throw new Error('fallback');
            }
            throw rentError;
          }

          setTenants(rentalsData || []);
        } catch (fallbackErr) {
          // Fallback to old behavior using rental_requests (status='accepted')
          const { data: requestsData, error: reqError } = await supabase
            .from('rental_requests')
            .select('*, dorms:dorm_id (name)')
            .eq('owner_id', user!.id)
            .eq('status', 'accepted')
            .order('updated_at', { ascending: false });

          if (reqError) throw reqError;

          if (!requestsData || requestsData.length === 0) {
            setTenants([]);
            return;
          }

          const userIds = [...new Set(requestsData.map((r: any) => r.user_id))];
          const { data: profilesData, error: profError } = await supabase
            .from('profiles')
            .select('profile_id, full_name, username, avatar_url')
            .in('profile_id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);

          if (profError) throw profError;

          const profileMap: Record<string, any> = {};
          (profilesData || []).forEach((p: any) => { profileMap[p.profile_id] = p; });

          const merged = requestsData.map((req: any) => ({
            ...req,
            dorm_id: req.dorm_id,
            user_id: req.user_id,
            renter_name: profileMap[req.user_id]?.full_name || 'Registered User',
            renter_phone: null,
            start_date: req.updated_at,
            dorms: req.dorms,
            profiles: profileMap[req.user_id] || null,
          }));

          setTenants(merged);
        }
      }
    } catch (err: any) {
      Alert.alert('Error Fetching Data', err.message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isOwner === true) {
      fetchData();
    }
  }, [isOwner, activeTab]);

  const handleDecision = async (requestId: string, approve: boolean, userId: string, dormName: string, dormId: string) => {
    setActionLoading(requestId);
    try {
      const newStatus = approve ? 'accepted' : 'declined';
      
      const { error } = await supabase
        .from('rental_requests')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('request_id', requestId);

      if (error) throw error;

      if (approve) {
        const { error: dormError } = await supabase
          .from('dorms')
          .update({ available: false })
          .eq('dorm_id', dormId);
        
        if (dormError) throw dormError;
      }

      // Create notification for the user
      await supabase.from('notifications').insert({
        user_id: userId,
        title: approve ? 'Rental Request Accepted' : 'Rental Request Declined',
        message: approve 
          ? `Congratulations! Your request to rent "${dormName}" has been accepted by the owner.` 
          : `Sorry, your request to rent "${dormName}" was declined by the owner.`,
        type: approve ? 'rental_accepted' : 'rental_declined',
        related_dorm_id: dormId,
        related_request_id: requestId,
      });

      Alert.alert('Success', `Rental request has been ${newStatus}.`);
      setRentalRequests(prev => prev.filter(item => item.request_id !== requestId));
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setActionLoading(null);
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
              // Try updating the rentals table first
              let rentalsUpdated = false;
              try {
                const { error: rentError } = await supabase
                  .from('rentals')
                  .update({ status: 'past', end_date: new Date().toISOString(), updated_at: new Date().toISOString() })
                  .eq('rental_id', rentalId);
                
                if (rentError) {
                  if (rentError.message.includes('relation') || rentError.code === '42P01') {
                    throw new Error('fallback');
                  }
                  throw rentError;
                }
                rentalsUpdated = true;
              } catch (fallbackErr) {
                // If rentals table doesn't exist, we fallback to deleting from rental_requests
                const { error } = await supabase
                  .from('rental_requests')
                  .delete()
                  .eq('request_id', rentalId); // In fallback mode, rentalId is actually the request id

                if (error) throw error;
              }

              // Make dorm available again
              const { error: dormError } = await supabase
                .from('dorms')
                .update({ available: true })
                .eq('dorm_id', dormId);

              if (dormError) throw dormError;

              // If rentals table exists and there is a registered user, cleanup their rental request too
              if (rentalsUpdated && userId) {
                await supabase
                  .from('rental_requests')
                  .delete()
                  .eq('dorm_id', dormId)
                  .eq('user_id', userId);
              }

              // Notify the user if registered
              if (userId) {
                await supabase.from('notifications').insert({
                  user_id: userId,
                  title: 'Rental Agreement Ended',
                  message: `Your rental agreement for "${dormName}" has been ended by the owner.`,
                  type: 'info',
                  related_dorm_id: dormId,
                });
              }

              Alert.alert('Success', 'Rental agreement ended and tenant removed.');
              setTenants(prev => prev.filter(item => (item.rental_id || item.request_id) !== rentalId));
            } catch (err: any) {
              Alert.alert('Error', err.message);
            } finally {
              setActionLoading(null);
            }
          }
        }
      ]
    );
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

  const renderRequestItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle}>{item.profiles?.full_name || 'Anonymous User'}</Text>
        <Text style={styles.cardSubtitle}>@{item.profiles?.username || 'username'}</Text>
        <Text style={styles.cardDorm}>Dormitory: <Text style={styles.boldText}>{item.dorms?.name}</Text></Text>
        <Text style={styles.cardDetail}>Requested on: {new Date(item.created_at).toLocaleDateString()}</Text>
      </View>
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.actionBtn, styles.approveBtn, actionLoading === item.request_id && styles.disabledBtn]}
          onPress={() => handleDecision(item.request_id, true, item.user_id, item.dorms?.name, item.dorm_id)}
          disabled={actionLoading !== null}
        >
          <Text style={styles.actionBtnText}>Accept</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.rejectBtn, actionLoading === item.request_id && styles.disabledBtn]}
          onPress={() => handleDecision(item.request_id, false, item.user_id, item.dorms?.name, item.dorm_id)}
          disabled={actionLoading !== null}
        >
          <Text style={styles.actionBtnText}>Decline</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderTenantItem = ({ item }: { item: any }) => {
    const isOffline = !item.user_id;
    const displayName = isOffline ? `${item.renter_name} (Offline)` : (item.profiles?.full_name || item.renter_name || 'Registered User');
    const subtitleText = isOffline ? `Phone: ${item.renter_phone || 'None'}` : `@${item.profiles?.username || 'username'}`;
    const agreementStart = item.start_date || item.updated_at;

    return (
      <View style={styles.card}>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{displayName}</Text>
          <Text style={[styles.cardSubtitle, isOffline && { color: '#64748b' }]}>{subtitleText}</Text>
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
      {/* Tabs */}
      <View style={styles.tabContainer}>
        <Pressable 
          style={[styles.tab, activeTab === 'requests' && styles.activeTab]}
          onPress={() => setActiveTab('requests')}
        >
          <Text style={[styles.tabText, activeTab === 'requests' && styles.activeTabText]}>
            Rental Requests ({rentalRequests.length})
          </Text>
        </Pressable>
        <Pressable 
          style={[styles.tab, activeTab === 'tenants' && styles.activeTab]}
          onPress={() => setActiveTab('tenants')}
        >
          <Text style={[styles.tabText, activeTab === 'tenants' && styles.activeTabText]}>
            Current Tenants ({tenants.length})
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
              <TextInput
                style={styles.input}
                placeholder="Enter tenant's full name"
                value={offlineName}
                onChangeText={setOfflineName}
              />

              <Text style={styles.formLabel}>Tenant Phone Number</Text>
              <TextInput
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
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748b',
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
    color: '#64748b',
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
    backgroundColor: '#fff',
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
    color: '#64748b',
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
    backgroundColor: '#fff',
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
    color: '#0f172a',
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
    color: '#334155',
    marginBottom: 4,
  },
  boldText: {
    fontWeight: '600',
    color: '#0f172a',
  },
  cardDetail: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
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
    backgroundColor: '#fff',
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
    color: '#0f172a',
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginTop: 12,
    marginBottom: 6,
  },
  noDormsWarning: {
    color: '#b45309',
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  dormPickerContainer: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 6,
    backgroundColor: '#f8fafc',
    marginBottom: 12,
  },
  dormOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 4,
  },
  dormOptionSelected: {
    backgroundColor: '#e6fcf5',
  },
  dormOptionText: {
    color: '#334155',
    fontSize: 14,
  },
  dormOptionTextSelected: {
    color: '#0891b2',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
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
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  cancelModalBtnText: {
    color: '#475569',
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
});
