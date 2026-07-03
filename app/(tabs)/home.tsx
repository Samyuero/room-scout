import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Pressable,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRouter, useFocusEffect } from 'expo-router';
import { AppColors, BorderRadius } from '@/constants/theme';

const { width } = Dimensions.get('window');
const ITEM_WIDTH = width - 40;

export default function Home() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [dorms, setDorms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const fetchDorms = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('dorms')
        .select('*')
        .order('available', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      setDorms(data || []);
    } catch (error) {
      console.error('Error fetching dorms:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchDorms();
    }, [fetchDorms])
  );

  const refreshData = () => {
    setRefreshing(true);
    fetchDorms();
  };

  const renderDorm = ({ item }: { item: any }) => (
    <Pressable
      style={({ pressed }) => [styles.dormCard, pressed && styles.dormCardPressed]}
      onPress={() => router.push(`/(tabs)/${item.dorm_id}` as any)}
    >
      <Image
        source={
          Array.isArray(item.images) &&
          item.images.length > 0 &&
          typeof item.images[0] === 'string' &&
          item.images[0].length > 0
            ? { uri: item.images[0] }
            : require('../../assets/placeholder.jpg')
        }
        style={styles.dormImage}
        resizeMode="cover"
      />
      <View style={styles.dormInfo}>
        <Text style={styles.dormName}>{item.name}</Text>
        <Text style={styles.dormPrice}>₱{item.price}/month</Text>
        <View style={styles.dormTags}>
          <Text style={[styles.tag, item.available ? styles.availableTag : styles.unavailableTag]}>
            {item.available ? 'Available' : 'Rented / Unavailable'}
          </Text>
          {item.gender_policy && <Text style={styles.tag}>{item.gender_policy}</Text>}
          {item.utilities && item.utilities.length > 0 && <Text style={styles.tag}>Utilities</Text>}
        </View>
      </View>
    </Pressable>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={AppColors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Room Scout</Text>
        <Text style={styles.subtitle}>Find your perfect dorm or apartment</Text>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          placeholder="Search dorms..."
          placeholderTextColor={AppColors.textMuted}
          style={styles.searchInput}
        />
      </View>

      {dorms.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No dorms available yet</Text>
        </View>
      ) : (
        <FlatList
          data={dorms}
          keyExtractor={(item) => item.dorm_id}
          renderItem={renderDorm}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refreshData}
              tintColor={AppColors.accent}
              colors={[AppColors.accent]}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
    color: AppColors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: AppColors.textSecondary,
  },
  searchBar: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    backgroundColor: AppColors.input,
    borderRadius: BorderRadius.md,
    padding: 14,
    fontSize: 16,
    color: AppColors.text,
  },
  listContent: {
    padding: 20,
    paddingBottom: 80,
  },
  dormCard: {
    backgroundColor: AppColors.surface,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  dormCardPressed: {
    opacity: 0.85,
  },
  dormImage: {
    width: ITEM_WIDTH,
    height: 180,
  },
  dormInfo: {
    padding: 16,
  },
  dormName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
    color: AppColors.text,
  },
  dormPrice: {
    fontSize: 16,
    color: AppColors.accent,
    fontWeight: '600',
    marginBottom: 8,
  },
  dormTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    backgroundColor: AppColors.surfaceElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    fontSize: 12,
    color: AppColors.textSecondary,
    overflow: 'hidden',
  },
  availableTag: {
    backgroundColor: AppColors.successBg,
    color: AppColors.success,
    fontWeight: '600',
  },
  unavailableTag: {
    backgroundColor: AppColors.errorBg,
    color: AppColors.error,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppColors.background,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: AppColors.textMuted,
  },
});
