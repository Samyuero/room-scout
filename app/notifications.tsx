import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/hooks/useAuth';
import { useRouter } from 'expo-router';

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications(data || []);

      // Mark all as read when opening notifications screen
      if (data && data.some((n: any) => !n.read)) {
        await supabase
          .from('notifications')
          .update({ read: true })
          .eq('user_id', user.id)
          .eq('read', false);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchNotifications();
    }
  }, [user]);

  const getBadgeStyle = (type: string) => {
    switch (type) {
      case 'rental_accepted':
        return { container: styles.acceptedBadge, text: styles.acceptedBadgeText };
      case 'rental_declined':
        return { container: styles.declinedBadge, text: styles.declinedBadgeText };
      case 'rental_request':
        return { container: styles.requestBadge, text: styles.requestBadgeText };
      default:
        return { container: styles.infoBadge, text: styles.infoBadgeText };
    }
  };

  const getBadgeText = (type: string) => {
    switch (type) {
      case 'rental_accepted':
        return 'Rental Accepted';
      case 'rental_declined':
        return 'Rental Declined';
      case 'rental_request':
        return 'Rent Request';
      default:
        return 'Info';
    }
  };

  const renderItem = ({ item }: { item: any }) => (
    <Pressable 
      style={[styles.notificationCard, !item.read && styles.unreadCard]}
      onPress={async () => {
        if (item.related_dorm_id) {
          router.push(`/(tabs)/${item.related_dorm_id}` as any);
        }
      }}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, getBadgeStyle(item.type).container]}>
          <Text style={[styles.typeBadgeText, getBadgeStyle(item.type).text]}>{getBadgeText(item.type)}</Text>
        </View>
        <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleDateString()}</Text>
      </View>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.cardMessage}>{item.message}</Text>
      {item.related_dorm_id && (
        <Text style={styles.viewLinkText}>Tap to view dormitory Details →</Text>
      )}
    </Pressable>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyText}>Please sign in to view notifications.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.notification_id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={fetchNotifications} />
        }
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>You have no notifications yet</Text>
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
  listContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  notificationCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  unreadCard: {
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  acceptedBadge: {
    backgroundColor: '#dcfce7',
  },
  acceptedBadgeText: {
    color: '#15803d',
  },
  declinedBadge: {
    backgroundColor: '#fee2e2',
  },
  declinedBadgeText: {
    color: '#b91c1c',
  },
  requestBadge: {
    backgroundColor: '#fef3c7',
  },
  requestBadgeText: {
    color: '#b45309',
  },
  infoBadge: {
    backgroundColor: '#f1f5f9',
  },
  infoBadgeText: {
    color: '#475569',
  },
  timestamp: {
    fontSize: 12,
    color: '#94a3b8',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  cardMessage: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  viewLinkText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '600',
    marginTop: 10,
  },
  emptyContainer: {
    paddingVertical: 120,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
  },
});
