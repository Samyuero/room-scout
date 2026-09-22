import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DiscoverySearchBar, DiscoverySearchSheet } from '@/components/discovery-search';
import { DormResultCard } from '@/components/dorm-result-card';
import { AppColors, BorderRadius } from '@/constants/theme';
import { useDiscovery } from '@/context/discovery-context';
import type { Dorm } from '@/types/dorm';

export default function Search() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [openFilters, setOpenFilters] = useState(false);
  const { rankedDorms, filters, resetFilters, compareIds, toggleCompare } = useDiscovery();

  function compare(dorm: Dorm) {
    if (toggleCompare(dorm.dorm_id) === 'limit') Alert.alert('Comparison full', 'Compare supports up to three dorms.');
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.searchWrap}>
        <DiscoverySearchBar value={filters.query} onPress={() => { setOpenFilters(false); setSheetVisible(true); }} onFilterPress={() => { setOpenFilters(true); setSheetVisible(true); }} />
      </View>
      <View style={styles.resultHeader}>
        <View><Text style={styles.title}>{rankedDorms.length} places</Text><Text style={styles.subtitle}>Best matches from public ratings and your preferences</Text></View>
        <Pressable onPress={resetFilters} style={styles.reset}><Text style={styles.resetText}>Reset</Text></Pressable>
      </View>
      <FlatList
        data={rankedDorms}
        keyExtractor={(item) => item.dorm_id}
        renderItem={({ item }) => <DormResultCard compact dorm={item} compared={compareIds.includes(item.dorm_id)} onCompare={() => compare(item)} onPress={() => router.push(`/(tabs)/${item.dorm_id}` as never)} />}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.list}
        ListEmptyComponent={<View style={styles.empty}><Ionicons name="search-outline" size={36} color={AppColors.textMuted} /><Text style={styles.title}>No matching dorms</Text><Text style={styles.subtitle}>Try another location, price, or amenity.</Text></View>}
      />
      <DiscoverySearchSheet key={`${sheetVisible}-${openFilters}`} visible={sheetVisible} openFiltersInitially={openFilters} onClose={() => setSheetVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 17, paddingTop: 5, paddingBottom: 9 },
  title: { color: AppColors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: AppColors.textMuted, fontSize: 10, paddingTop: 3 },
  reset: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: BorderRadius.full, backgroundColor: AppColors.surface },
  resetText: { color: AppColors.accent, fontSize: 11, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  empty: { alignItems: 'center', gap: 8, padding: 38, borderRadius: BorderRadius.lg, backgroundColor: AppColors.surface },
});
