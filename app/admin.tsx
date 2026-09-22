import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Alert, Switch, Linking } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { useRouter } from 'expo-router';
import { getPrivateDocumentUrl } from '@/utils/imageUpload';

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [activeTab, setActiveTab] = useState<'verifications' | 'payments' | 'dorms' | 'support'>('verifications');
  
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [dorms, setDorms] = useState<any[]>([]);
  const [pendingPayments, setPendingPayments] = useState<any[]>([]);
  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const checkAdminRole = useCallback(async () => {
    if (!user) {
      setIsAdmin(false);
      setLoadingRole(false);
      return;
    }
    try {
      // Check if the user exists in the admins table
      const { data, error } = await supabase
        .from('admins')
        .select('admin_id')
        .eq('admin_id', user.id)
        .maybeSingle();
      
      if (error) throw error;
      setIsAdmin(!!data);
    } catch (err) {
      console.error('Error checking admin role:', err);
      setIsAdmin(false);
    } finally {
      setLoadingRole(false);
    }
  }, [user]);

  useEffect(() => {
    void checkAdminRole();
  }, [checkAdminRole]);

  const fetchData = useCallback(async () => {
    if (isAdmin !== true) return;
    setRefreshing(true);
    try {
      if (activeTab === 'verifications') {
        const { data, error } = await supabase
          .from('owner_verifications')
          .select('*, owners(owner_id, full_name, username, avatar_url)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setPendingUsers(data || []);
      } else if (activeTab === 'payments') {
        const { data, error } = await supabase
          .from('rental_requests')
          .select('*, dorms:dorm_id(name, address), renters:user_id(full_name, username)')
          .eq('status', 'payment_submitted')
          .order('updated_at', { ascending: true });
        if (error) throw error;
        setPendingPayments(data || []);
      } else if (activeTab === 'dorms') {
        const { data, error } = await supabase
          .from('dorms')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setDorms(data || []);
      } else {
        const { data, error } = await supabase
          .from('support_tickets')
          .select('ticket_id, subject, description, status, created_at, updated_at')
          .in('status', ['open', 'in_progress'])
          .order('created_at', { ascending: false });
        if (error) throw error;
        setSupportTickets(data || []);
      }
    } catch (err: any) {
      Alert.alert('Error Fetching Data', err.message);
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (isAdmin === true) {
      void fetchData();
    }
  }, [fetchData, isAdmin]);

  const handleVerification = async (verificationId: string, approve: boolean) => {
    setActionLoading(verificationId);
    try {
      const newStatus = approve ? 'approved' : 'rejected';
      const { error } = await supabase
        .from('owner_verifications')
        .update({ status: newStatus, reviewed_by: user!.id, updated_at: new Date().toISOString() })
        .eq('verification_id', verificationId);

      if (error) throw error;

      Alert.alert('Success', `Owner verification ${newStatus}.`);
      setPendingUsers(prev => prev.filter(item => item.verification_id !== verificationId));
    } catch (err: any) {
      Alert.alert('Verification Error', err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleDormAvailability = async (dormId: string, currentVal: boolean) => {
    try {
      const { error } = await supabase
        .from('dorms')
        .update({ available: !currentVal })
        .eq('dorm_id', dormId);

      if (error) throw error;

      setDorms(prev => prev.map(d => d.dorm_id === dormId ? { ...d, available: !currentVal } : d));
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handlePaymentVerification = async (requestId: string, approve: boolean) => {
    setActionLoading(requestId);
    try {
      const { error } = await supabase.rpc('admin_verify_payment', {
        p_request_id: requestId,
        p_approved: approve,
      });
      if (error) throw error;
      setPendingPayments((current) => current.filter((item) => item.request_id !== requestId));
      Alert.alert(
        approve ? 'Payment confirmed' : 'Payment rejected',
        approve
          ? 'The request and dorm availability were updated together.'
          : 'The renter can review the rejection and submit a corrected proof.',
      );
    } catch (err: any) {
      Alert.alert('Verification failed', err.message || 'Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleListingApproval = async (dormId: string, approve: boolean) => {
    setActionLoading(dormId);
    try {
      const { error } = await supabase
        .from('dorms')
        .update({ approval_status: approve ? 'approved' : 'rejected', updated_at: new Date().toISOString() })
        .eq('dorm_id', dormId);
      if (error) throw error;
      setDorms((current) => current.map((item) => item.dorm_id === dormId ? { ...item, approval_status: approve ? 'approved' : 'rejected' } : item));
    } catch (err: any) {
      Alert.alert('Listing review failed', err.message || 'Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleLGU = async (dormId: string, currentVal: boolean) => {
    try {
      const { error } = await supabase
        .from('dorms')
        .update({ lgu_certified: !currentVal })
        .eq('dorm_id', dormId);

      if (error) throw error;

      setDorms(prev => prev.map(d => d.dorm_id === dormId ? { ...d, lgu_certified: !currentVal } : d));
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
  };

  const handleSupportStatus = async (ticketId: string, status: 'in_progress' | 'resolved') => {
    setActionLoading(ticketId);
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({ status, admin_id: user!.id, updated_at: new Date().toISOString() })
        .eq('ticket_id', ticketId);
      if (error) throw error;
      setSupportTickets((current) => status === 'resolved'
        ? current.filter((ticket) => ticket.ticket_id !== ticketId)
        : current.map((ticket) => ticket.ticket_id === ticketId ? { ...ticket, status } : ticket));
    } catch (err: any) {
      Alert.alert('Ticket update failed', err.message || 'Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeactivateDorm = (dormId: string, dormName: string, currentStatus: string) => {
    const isActive = currentStatus === 'active';
    Alert.alert(
      isActive ? 'Deactivate Listing' : 'Reactivate Listing',
      isActive
        ? `Set "${dormName}" to inactive? It will be hidden from search but kept in the database.`
        : `Reactivate "${dormName}"? It will become visible again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isActive ? 'Deactivate' : 'Reactivate',
          style: isActive ? 'destructive' : 'default',
          onPress: async () => {
            setActionLoading(dormId);
            try {
              const newStatus = isActive ? 'inactive' : 'active';
              const { error } = await supabase
                .from('dorms')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq('dorm_id', dormId);
              
              if (error) throw error;
              
              Alert.alert('Success', `Listing ${isActive ? 'deactivated' : 'reactivated'}.`);
              setDorms(prev => prev.map(d => d.dorm_id === dormId ? { ...d, status: newStatus } : d));
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
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={styles.loadingText}>Authenticating admin session...</Text>
      </View>
    );
  }

  if (isAdmin !== true) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.deniedTitle}>Access Denied</Text>
        <Text style={styles.deniedText}>
          You do not have administrative privileges to access this panel.
        </Text>
        <Pressable style={styles.backButton} onPress={() => router.replace('/(tabs)/profile' as any)}>
          <Text style={styles.backButtonText}>Go to Profile</Text>
        </Pressable>
      </View>
    );
  }

  const renderVerificationItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle}>{item.owners?.full_name || 'Anonymous Owner'}</Text>
        <Text style={styles.cardSubtitle}>@{item.owners?.username || 'unknown'}</Text>
        <Text style={styles.cardDetail}>Document: {item.document_url || 'No document'}</Text>
        <Text style={styles.cardDetail}>Submitted: {new Date(item.created_at).toLocaleDateString()}</Text>
      </View>
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.actionBtn, styles.approveBtn, actionLoading === item.verification_id && styles.disabledBtn]}
          onPress={() => handleVerification(item.verification_id, true)}
          disabled={actionLoading !== null}
        >
          <Text style={styles.actionBtnText}>Approve</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.rejectBtn, actionLoading === item.verification_id && styles.disabledBtn]}
          onPress={() => handleVerification(item.verification_id, false)}
          disabled={actionLoading !== null}
        >
          <Text style={styles.actionBtnText}>Reject</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderDormItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardInfo}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.cardTitle}>{item.name}</Text>
          {item.status === 'inactive' && (
            <View style={{ backgroundColor: '#fef2f2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '600' }}>INACTIVE</Text>
            </View>
          )}
          {item.lgu_certified && (
            <View style={{ backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ color: '#16a34a', fontSize: 11, fontWeight: '600' }}>LGU ✓</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardSubtitle}>{item.address}</Text>
        <Text style={styles.cardPrice}>₱{item.price}/month</Text>
        <Pressable disabled={!item.ownership_proof_url} onPress={async () => Linking.openURL(await getPrivateDocumentUrl(item.ownership_proof_url))}><Text style={styles.cardSubtitle}>Ownership proof: {item.ownership_proof_url ? 'Open protected image' : 'Missing'}</Text></Pressable>
      </View>
      {item.approval_status !== 'approved' && (
        <View style={styles.buttonRow}>
          <Pressable style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleListingApproval(item.dorm_id, true)}><Text style={styles.actionBtnText}>Approve listing</Text></Pressable>
          <Pressable style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleListingApproval(item.dorm_id, false)}><Text style={styles.actionBtnText}>Reject</Text></Pressable>
        </View>
      )}
      <View style={styles.dormControlRow}>
        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>Available:</Text>
          <Switch
            value={item.available}
            onValueChange={() => handleToggleDormAvailability(item.dorm_id, item.available)}
            trackColor={{ false: '#767577', true: '#8b5cf6' }}
            thumbColor={item.available ? '#a78bfa' : '#f4f3f4'}
          />
        </View>
        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>LGU Certified:</Text>
          <Switch
            value={item.lgu_certified || false}
            onValueChange={() => handleToggleLGU(item.dorm_id, item.lgu_certified || false)}
            trackColor={{ false: '#767577', true: '#16a34a' }}
            thumbColor={item.lgu_certified ? '#4ade80' : '#f4f3f4'}
          />
        </View>
      </View>
      <View style={{ marginTop: 8 }}>
        <Pressable
          style={[styles.actionBtn, item.status === 'active' ? styles.rejectBtn : styles.approveBtn, actionLoading === item.dorm_id && styles.disabledBtn]}
          onPress={() => handleDeactivateDorm(item.dorm_id, item.name, item.status || 'active')}
          disabled={actionLoading !== null}
        >
          <Text style={styles.actionBtnText}>{item.status === 'active' ? 'Deactivate' : 'Reactivate'}</Text>
        </Pressable>
      </View>
    </View>
  );

  const renderPaymentItem = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle}>{item.dorms?.name || 'Dormitory payment'}</Text>
        <Text style={styles.cardSubtitle}>Renter: {item.renters?.full_name || item.renters?.username || 'Account holder'}</Text>
        <Text style={styles.cardPrice}>₱{Number(item.required_amount || 0).toLocaleString('en-PH')} · {item.request_type}</Text>
        <Pressable disabled={!item.payment_proof_url} onPress={async () => Linking.openURL(await getPrivateDocumentUrl(item.payment_proof_url))}><Text style={styles.cardSubtitle}>Proof: {item.payment_proof_url ? 'Open protected receipt' : 'Missing'}</Text></Pressable>
        <Text style={styles.cardSubtitle}>Contract agreed: {item.contract_agreed ? 'Yes' : 'No'}</Text>
      </View>
      <View style={styles.buttonRow}>
        <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => handlePaymentVerification(item.request_id, true)}><Text style={styles.actionBtnText}>Verify & confirm</Text></Pressable>
        <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handlePaymentVerification(item.request_id, false)}><Text style={styles.actionBtnText}>Reject proof</Text></Pressable>
      </View>
    </View>
  );

  const renderSupportTicket = ({ item }: { item: any }) => (
    <View style={styles.card}>
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle}>{item.subject}</Text>
        <Text style={styles.cardDetail}>{item.description}</Text>
        <Text style={styles.cardSubtitle}>Submitted {new Date(item.created_at).toLocaleDateString()} · {item.status.replace('_', ' ')}</Text>
      </View>
      <View style={styles.buttonRow}>
        {item.status === 'open' && <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => handleSupportStatus(item.ticket_id, 'in_progress')}><Text style={styles.actionBtnText}>Start review</Text></Pressable>}
        <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.rejectBtn]} onPress={() => handleSupportStatus(item.ticket_id, 'resolved')}><Text style={styles.actionBtnText}>Resolve</Text></Pressable>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabContainer}>
        <Pressable
          style={[styles.tab, activeTab === 'verifications' && styles.activeTab]}
          onPress={() => setActiveTab('verifications')}
        >
          <Text style={[styles.tabText, activeTab === 'verifications' && styles.activeTabText]}>
            Verifications ({pendingUsers.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'support' && styles.activeTab]}
          onPress={() => setActiveTab('support')}
        >
          <Text style={[styles.tabText, activeTab === 'support' && styles.activeTabText]}>
            Support ({supportTickets.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === 'payments' && styles.activeTab]}
          onPress={() => setActiveTab('payments')}
        >
          <Text style={[styles.tabText, activeTab === 'payments' && styles.activeTabText]}>
            Payments ({pendingPayments.length})
          </Text>
        </Pressable>
        <Pressable 
          style={[styles.tab, activeTab === 'dorms' && styles.activeTab]}
          onPress={() => setActiveTab('dorms')}
        >
          <Text style={[styles.tabText, activeTab === 'dorms' && styles.activeTabText]}>
            Manage Dorms ({dorms.length})
          </Text>
        </Pressable>
      </View>

      {/* Main List */}
      <FlatList
        data={activeTab === 'verifications' ? pendingUsers : activeTab === 'payments' ? pendingPayments : activeTab === 'dorms' ? dorms : supportTickets}
        keyExtractor={(item) => activeTab === 'verifications' ? item.verification_id : activeTab === 'payments' ? item.request_id : activeTab === 'dorms' ? item.dorm_id : item.ticket_id}
        renderItem={activeTab === 'verifications' ? renderVerificationItem : activeTab === 'payments' ? renderPaymentItem : activeTab === 'dorms' ? renderDormItem : renderSupportTicket}
        refreshing={refreshing}
        onRefresh={fetchData}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {activeTab === 'verifications'
                ? 'No pending verification requests'
                : activeTab === 'payments'
                  ? 'No payment proofs waiting for verification'
                  : activeTab === 'dorms'
                    ? 'No dormitories listed in the database'
                    : 'No open support tickets'}
            </Text>
          </View>
        }
      />
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
    backgroundColor: '#8b5cf6',
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
    borderBottomColor: '#8b5cf6',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  activeTabText: {
    color: '#8b5cf6',
  },
  listContainer: {
    padding: 16,
    paddingBottom: 40,
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
    color: '#8b5cf6',
    fontWeight: '600',
    marginBottom: 4,
  },
  cardDetail: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  cardPrice: {
    fontSize: 16,
    color: '#10b981',
    fontWeight: '700',
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  dormControlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
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
  deleteBtn: {
    backgroundColor: '#ef4444',
    maxWidth: 100,
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
});
