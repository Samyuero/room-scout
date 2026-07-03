import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useRouter } from 'expo-router';
import { AppColors, BorderRadius } from '@/constants/theme';

export default function Search() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    minPrice: 0,
    maxPrice: 10000,
    genderPolicy: '',
    utilities: [] as string[],
    amenities: [] as string[],
    distance: 10,
  });
  const [dorms, setDorms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const searchDorms = async () => {
    setLoading(true);
    try {
      let query = supabase.from('dorms').select('*');

      if (searchTerm) {
        query = query.ilike('name', `%${searchTerm}%`);
      }
      if (filters.minPrice > 0) {
        query = query.gte('price', filters.minPrice);
      }
      if (filters.maxPrice < 10000) {
        query = query.lte('price', filters.maxPrice);
      }
      if (filters.genderPolicy) {
        query = query.eq('gender_policy', filters.genderPolicy);
      }
      if (filters.utilities.length > 0) {
        query = query.contains('utilities', filters.utilities);
      }
      if (filters.amenities.length > 0) {
        query = query.contains('amenities', filters.amenities);
      }

      query = query.order('available', { ascending: false }).order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      setDorms(data || []);
    } catch (error) {
      console.error('Error searching dorms:', error);
    } finally {
      setLoading(false);
    }
  };

  const genderOptions = [
    { label: 'Any', value: '' },
    { label: 'Male', value: 'male' },
    { label: 'Female', value: 'female' },
    { label: 'Co-ed', value: 'co-ed' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Search Dorms</Text>
        <Text style={styles.subtitle}>Filter by name, price, and preferences</Text>
      </View>

      <View style={styles.searchSection}>
        <TextInput
          placeholder="Search by dorm name..."
          placeholderTextColor={AppColors.textMuted}
          value={searchTerm}
          onChangeText={setSearchTerm}
          style={styles.searchInput}
        />
        <Pressable style={styles.primaryButton} onPress={searchDorms}>
          <Text style={styles.primaryButtonText}>Search</Text>
        </Pressable>
      </View>

      <View style={styles.filtersSection}>
        <Text style={styles.sectionTitle}>Filters</Text>

        <Text style={styles.filterLabel}>Gender Policy</Text>
        <View style={styles.filterOptions}>
          {genderOptions.map((opt) => (
            <Pressable
              key={opt.value || 'any'}
              style={[
                styles.filterChip,
                filters.genderPolicy === opt.value && styles.filterChipActive,
              ]}
              onPress={() => setFilters({ ...filters, genderPolicy: opt.value })}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filters.genderPolicy === opt.value && styles.filterChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.filterLabel}>Distance: {filters.distance} km</Text>
      </View>

      <Pressable style={[styles.primaryButton, styles.applyButton]} onPress={searchDorms}>
        <Text style={styles.primaryButtonText}>Apply Filters</Text>
      </Pressable>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={AppColors.accent} />
        </View>
      ) : (
        <View style={styles.resultsSection}>
          <Text style={styles.resultsTitle}>Found {dorms.length} dorms</Text>
          {dorms.length > 0 ? (
            dorms.map((item) => (
              <Pressable
                key={item.dorm_id}
                style={styles.dormCard}
                onPress={() => router.push(`/(tabs)/${item.dorm_id}` as any)}
              >
                <Text style={styles.dormName}>{item.name}</Text>
                <Text style={styles.dormPrice}>₱{item.price}/month</Text>
                <Text style={styles.dormLocation}>{item.address}</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.noResults}>No dorms match your criteria</Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: AppColors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: AppColors.textSecondary,
    marginTop: 4,
  },
  searchSection: {
    padding: 20,
    gap: 12,
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
  filtersSection: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    color: AppColors.text,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
    color: AppColors.textSecondary,
  },
  filterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.surface,
  },
  filterChipActive: {
    backgroundColor: AppColors.accent,
    borderColor: AppColors.accent,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.textSecondary,
  },
  filterChipTextActive: {
    color: AppColors.white,
  },
  primaryButton: {
    backgroundColor: AppColors.accent,
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: AppColors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  applyButton: {
    marginHorizontal: 20,
    marginBottom: 16,
  },
  resultsSection: {
    paddingHorizontal: 20,
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: AppColors.textSecondary,
  },
  noResults: {
    textAlign: 'center',
    padding: 40,
    color: AppColors.textMuted,
  },
  dormCard: {
    backgroundColor: AppColors.surface,
    borderRadius: BorderRadius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  dormName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
    color: AppColors.text,
  },
  dormPrice: {
    fontSize: 15,
    color: AppColors.accent,
    fontWeight: '600',
    marginBottom: 4,
  },
  dormLocation: {
    fontSize: 13,
    color: AppColors.textSecondary,
  },
  centered: {
    padding: 40,
    alignItems: 'center',
  },
});
