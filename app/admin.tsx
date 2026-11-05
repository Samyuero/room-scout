import { showError } from '@/components/error-toast';
import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Alert, Switch, Linking, ScrollView } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { useRouter } from 'expo-router';
import { getPrivateDocumentUrl } from '@/utils/imageUpload';
import { AppColors, BorderRadius } from '@/constants/theme';

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [activeTab, setActiveTab] = useState<'verifications' | 'payments' | 'dorms' | 'support'>('verifications');
  
  const [certifications, setCertifications] = useState<any[]>([]);
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
      const [verificationResult, paymentResult, dormResult, supportResult, certificationResult] = await Promise.all([
        supabase
          .from('owner_verifications')
          .select('*, owners(owner_id, full_name, username, avatar_url)')
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
        supabase
          .from('rental_requests')
          .select('*, dorms:dorm_id(name, address), renters:user_id(full_name, username)')
          .in('status', ['payment_submitted', 'cancelled'])
          .eq('payment_status', 'pending_verification')
          .order('updated_at', { ascending: true }),
        supabase
          .from('dorms')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('support_tickets')
          .select('ticket_id, subject, description, status, created_at, updated_at')
          .in('status', ['open', 'in_progress'])
          .order('created_at', { ascending: false }),
        supabase.from('lgu_certification_requests').select('*').eq('status', 'pending'),
      ]);
      const firstError = certificationResult.error || verificationResult.error || paymentResult.error || dormResult.error || supportResult.error;
      if (firstError) throw firstError;
      setCertifications(certificationResult.data || []);
      setPendingUsers(verificationResult.data || []);
      setPendingPayments(paymentResult.data || []);
      setDorms(dormResult.data || []);
      setSupportTickets(supportResult.data || []);
    } catch (err: any) {
      showError('Error Fetching Data', err.message);
    } finally {
      setRefreshing(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin === true) {
      void fetchData();
    }
  }, [fetchData, isAdmin]);

  useEffect(() => {
    if (isAdmin !== true) return;
    const channel = supabase.channel('admin-dashboard-counts-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'owner_verifications' }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_requests' }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dorms' }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => void fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lgu_certification_requests' }, () => void fetchData())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
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
      showError('Verification Error', err.message);
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
      showError('Error', err.message);
    }
  };

  const handlePaymentVerification = async (requestId: string, approve: boolean) => {
    const cancelled = pendingPayments.find((item) => item.request_id === requestId)?.status === 'cancelled';
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
          cancelled
            ? 'Receipt review saved. The request stays cancelled; no tenant slot or refund was created. Any payment return must be arranged directly with the owner.'
            : approve
          ? 'The request and dorm availability were updated together.'
          : 'The renter can review the rejection and submit a corrected proof.',
      );
    } catch (err: any) {
      showError('Verification failed', err.message || 'Please try again.');
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
      Alert.alert(
        approve ? 'Listing approved' : 'Listing rejected',
        approve ? 'The dorm is now visible on Home, Search, Map, and Compare.' : 'The dorm remains hidden from public discovery.',
      );
    } catch (err: any) {
      showError('Listing review failed', err.message || 'Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCertification = async (certificationId: string, approve: boolean) => {
    setActionLoading(certificationId);
    try {
      const { error } = await supabase.rpc('review_lgu_certification', { p_certification_id: certificationId, p_approved: approve });
      if (error) throw error;
      await fetchData();
      Alert.alert('Certification reviewed', approve ? 'The listing now displays its LGU badge.' : 'The owner has been notified that the proof was declined.');
    } catch (caught: any) {
      showError('Review failed', caught.message);
    } finally { setActionLoading(null); }
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
      showError('Ticket update failed', err.message || 'Please try again.');
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
              showError('Error', err.message);
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
          <View style={[styles.statusBadge, item.approval_status === 'approved' ? styles.approvedBadge : item.approval_status === 'rejected' ? styles.rejectedBadge : styles.pendingBadge]}>
            <Text style={styles.statusBadgeText}>{String(item.approval_status || 'pending').toUpperCase()}</Text>
          </View>
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
      {certifications.filter((request) => request.dorm_id === item.dorm_id).map((request) => <View key={request.certification_id} style={{ gap: 12, paddingVertical: 14 }}>
        <Text style={styles.cardTitle}>LGU proof awaiting review</Text>
        <Pressable onPress={async () => { const url = await getPrivateDocumentUrl(request.proof_path); if (url) await Linking.openURL(url); else showError('Proof unavailable', 'The certificate could not be loaded.'); }}><Text style={styles.cardSubtitle}>View certificate</Text></Pressable>
        <View style={styles.buttonRow}><Pressable disabled={actionLoading !== null} onPress={() => handleCertification(request.certification_id, true)} style={[styles.actionBtn, styles.approveBtn]}><Text style={styles.actionBtnText}>Approve certificate</Text></Pressable><Pressable disabled={actionLoading !== null} onPress={() => handleCertification(request.certification_id, false)} style={[styles.actionBtn, styles.rejectBtn]}><Text style={styles.actionBtnText}>Decline</Text></Pressable></View>
      </View>)}
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
        <Text style={styles.switchLabel}>{item.lgu_certified ? 'LGU certified' : 'No approved LGU certificate'}</Text>
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
          {item.status === 'cancelled' && <Text style={styles.cardSubtitle}>Cancelled request · Review receipt only. Do not create a tenancy or refund.</Text>}
        <Pressable disabled={!item.payment_proof_url} onPress={async () => Linking.openURL(await getPrivateDocumentUrl(item.payment_proof_url))}><Text style={styles.cardSubtitle}>Proof: {item.payment_proof_url ? 'Open protected receipt' : 'Missing'}</Text></Pressable>
        <Text style={styles.cardSubtitle}>Contract agreed: {item.contract_agreed ? 'Yes' : 'No'}</Text>
      </View>
      <View style={styles.buttonRow}>
        <Pressable disabled={actionLoading !== null} style={[styles.actionBtn, styles.approveBtn]} onPress={() => handlePaymentVerification(item.request_id, true)}><Text style={styles.actionBtnText}>{item.status === 'cancelled' ? 'Verify receipt only' : 'Verify & confirm'}</Text></Pressable>
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabContainer}>
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
            Manage Dorms ({dorms.length}){certifications.length > 0 ? ' · ' + certifications.length + ' LGU' : ''}
          </Text>
        </Pressable>
      </ScrollView>

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
    color: AppColors.error,
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
    backgroundColor: AppColors.accent,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: BorderRadius.md,
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
    borderBottomColor: AppColors.borderSubtle,
    minWidth: '100%',
  },
  tab: {
    minWidth: 112,
    paddingVertical: 16,
    paddingHorizontal: 10,
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
  },
  card: {
    backgroundColor: AppColors.surface,
    borderRadius: BorderRadius.lg,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
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
    color: AppColors.accent,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardDetail: {
    fontSize: 12,
    color: AppColors.textSecondary,
    marginTop: 4,
  },
  cardPrice: {
    fontSize: 16,
    color: AppColors.success,
    fontWeight: '700',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  approvedBadge: { backgroundColor: AppColors.success },
  rejectedBadge: { backgroundColor: AppColors.error },
  pendingBadge: { backgroundColor: AppColors.warning },
  statusBadgeText: { color: AppColors.white, fontSize: 10, fontWeight: '800' },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  dormControlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
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
    color: AppColors.textSecondary,
  },
  actionBtn: {
    flexGrow: 1,
    flexBasis: 120,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveBtn: {
    backgroundColor: AppColors.success,
  },
  rejectBtn: {
    backgroundColor: AppColors.error,
  },
  deleteBtn: {
    backgroundColor: AppColors.error,
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
    color: AppColors.textMuted,
    textAlign: 'center',
  },
});
