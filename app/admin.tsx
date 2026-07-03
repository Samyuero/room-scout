import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, Alert, Switch, Dimensions } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { useRouter } from 'expo-router';

const { width } = Dimensions.get('window');

export default function AdminScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [activeTab, setActiveTab] = useState<'verifications' | 'dorms'>('verifications');
  
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [dorms, setDorms] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const checkAdminRole = async () => {
    if (!user) {
      setIsAdmin(false);
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
      setIsAdmin(data?.role === 'admin');
    } catch (err) {
      console.error('Error checking admin role:', err);
      setIsAdmin(false);
    } finally {
      setLoadingRole(false);
    }
  };

  useEffect(() => {
    checkAdminRole();
  }, [user]);

  const fetchData = async () => {
    if (isAdmin !== true) return;
    setRefreshing(true);
    try {
      if (activeTab === 'verifications') {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('role', 'pending_owner')
          .order('updated_at', { ascending: false });
        if (error) throw error;
        setPendingUsers(data || []);
      } else {
        const { data, error } = await supabase
          .from('dorms')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setDorms(data || []);
      }
    } catch (err: any) {
      Alert.alert('Error Fetching Data', err.message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (isAdmin === true) {
      fetchData();
    }
  }, [isAdmin, activeTab]);

  const handleVerification = async (profileId: string, approve: boolean) => {
    setActionLoading(profileId);
    try {
      const newRole = approve ? 'owner' : 'user';
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('profile_id', profileId);

      if (error) throw error;

      Alert.alert('Success', `User verification status updated to ${newRole}.`);
      setPendingUsers(prev => prev.filter(item => item.profile_id !== profileId));
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

  const handleDeleteDorm = (dormId: string, dormName: string) => {
    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to permanently delete "${dormName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            setActionLoading(dormId);
            try {
              const { error } = await supabase
                .from('dorms')
                .delete()
                .eq('dorm_id', dormId);
              
              if (error) throw error;
              
              Alert.alert('Success', 'Listing deleted.');
              setDorms(prev => prev.filter(item => item.dorm_id !== dormId));
            } catch (err: any) {
              Alert.alert('Error Deleting Listing', err.message);
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
        <Text style={styles.cardTitle}>{item.full_name || 'Anonymous User'}</Text>
        <Text style={styles.cardSubtitle}>@{item.username}</Text>
        <Text style={styles.cardDetail}>User ID: {item.profile_id}</Text>
      </View>
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.actionBtn, styles.approveBtn, actionLoading === item.profile_id && styles.disabledBtn]}
          onPress={() => handleVerification(item.profile_id, true)}
          disabled={actionLoading !== null}
        >
          <Text style={styles.actionBtnText}>Approve</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.rejectBtn, actionLoading === item.profile_id && styles.disabledBtn]}
          onPress={() => handleVerification(item.profile_id, false)}
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
        <Text style={styles.cardTitle}>{item.name}</Text>
        <Text style={styles.cardSubtitle}>{item.address}</Text>
        <Text style={styles.cardPrice}>₱{item.price}/month</Text>
      </View>
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
        <Pressable
          style={[styles.actionBtn, styles.deleteBtn, actionLoading === item.dorm_id && styles.disabledBtn]}
          onPress={() => handleDeleteDorm(item.dorm_id, item.name)}
          disabled={actionLoading !== null}
        >
          <Text style={styles.actionBtnText}>Delete</Text>
        </Pressable>
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
        data={activeTab === 'verifications' ? pendingUsers : dorms}
        keyExtractor={(item) => activeTab === 'verifications' ? item.profile_id : item.dorm_id}
        renderItem={activeTab === 'verifications' ? renderVerificationItem : renderDormItem}
        refreshing={refreshing}
        onRefresh={fetchData}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {activeTab === 'verifications' 
                ? 'No pending verification requests' 
                : 'No dormitories listed in the database'}
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
