import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DiscoverySearchBar, DiscoverySearchSheet } from '@/components/discovery-search';
import { DormResultCard } from '@/components/dorm-result-card';
import { AppColors, BorderRadius } from '@/constants/theme';
import { useDiscovery } from '@/context/discovery-context';
import { recommendDorms } from '@/lib/dorm-discovery';
import { ErrorNotice } from '@/components/error-notice';
import type { Dorm } from '@/types/dorm';
import { useAuth } from '@/hooks/useAuth';
import { getAssistantQuotaWarning, rankAlternativesWithGemini } from '@/lib/gemini-assistant';
import { showWarning } from '@/components/error-toast';

export default function Search() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [openFilters, setOpenFilters] = useState(false);
  const { rankedDorms, allRankedDorms, dorms, filters, hasSearched, resetFilters, compareIds, toggleCompare, hasPreferences, preferences, searchLocation, searchOrigin, loading, error, refresh, refreshing } = useDiscovery();

  const localRecommendations = useMemo(() => {
    const available = dorms.filter((dorm) => dorm.available && dorm.available_slots > 0 && dorm.availability_status === 'available');
    // The initial two cards use the same Match Score order as the rest of discovery.
    if (!hasSearched) return allRankedDorms.filter((dorm) => dorm.available && dorm.available_slots > 0 && dorm.availability_status === 'available').slice(0, 2);
    const matchedIds = new Set(rankedDorms.map((dorm) => dorm.dorm_id));
    return recommendDorms(available, filters, searchLocation, preferences, matchedIds).slice(0, 30);
  }, [dorms, allRankedDorms, filters, searchLocation, preferences, hasSearched, rankedDorms]);
  const [aiOrder, setAiOrder] = useState<string[]>([]);
  const [aiRanking, setAiRanking] = useState(false);
  const rankingKey = JSON.stringify([user?.id, hasSearched, filters, preferences, searchLocation, localRecommendations.map((dorm) => [dorm.dorm_id,dorm.price,dorm.rating_average,dorm.rating_count])]);
  useEffect(() => {
    let active = true;
    setAiOrder([]);
    if (!hasSearched || !user || localRecommendations.length === 0 || !hasPreferences && !filters.query && filters.minPrice === null && filters.maxPrice === null && !filters.radiusEnabled && !filters.amenities.length && !filters.utilities.length && !filters.genderPolicy && !filters.lguCertified && !filters.petFriendly && !filters.roomTypes.length && !filters.parking.length && !filters.parkingRequired && !filters.curfewPolicy) { setAiRanking(false); return; }
    setAiRanking(true);
    const timer = setTimeout(() => {
      void rankAlternativesWithGemini(user.id,localRecommendations,filters,preferences,searchLocation).then((ids) => { if (active) setAiOrder(ids); }).catch((caught) => {
        if (!active) return;
        const warning = getAssistantQuotaWarning(caught);
        if (warning) showWarning('SNAP limit reached', warning);
        // Keep useful local alternatives when offline or rate limited.
      }).finally(() => { if (active) setAiRanking(false); });
    },900);
    return () => { active = false; clearTimeout(timer); };
    // The key includes every input used by the server ranking/cache, but not UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[rankingKey]);
  const recommendations = useMemo(() => {
    if (!hasSearched) return localRecommendations;
    const byId = new Map(localRecommendations.map((dorm) => [dorm.dorm_id,dorm]));
    return [...aiOrder.map((id) => byId.get(id)).filter(Boolean) as Dorm[],...localRecommendations.filter((dorm) => !aiOrder.includes(dorm.dorm_id))];
  },[aiOrder,localRecommendations,hasSearched]);
  const sections = [
    ...(hasSearched ? [{ title: `Matches (${rankedDorms.length})`, subtitle: 'These listings meet every selected filter.', data: rankedDorms, matches: true }] : []),
    ...(recommendations.length > 0 ? [{ title: 'Recommended for you', subtitle: !hasSearched ? hasPreferences ? 'Your two highest Match Scores among available dorms.' : 'Two available dorms ranked by listing score and renter ratings.' : aiOrder.length ? 'SNAP-ranked alternatives based on your filters and preferences. Some filters may differ.' : aiRanking ? 'Recommendations are ready. SNAP is refining their order…' : hasPreferences ? 'Available dorms, ranked by your preferences and closest filters.' : 'Available dorms, ranked by renter ratings.', data: recommendations, matches: false }] : []),
  ];
  function compare(dorm: Dorm) {
    if (toggleCompare(dorm.dorm_id) === 'limit') Alert.alert('Comparison full', 'Compare supports two dorms.');
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.searchWrap}>
        <DiscoverySearchBar value={filters.query} onPress={() => { setOpenFilters(false); setSheetVisible(true); }} onFilterPress={() => { setOpenFilters(true); setSheetVisible(true); }} />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.dorm_id}
        renderItem={({ item }) => <DormResultCard compact dorm={item} compared={compareIds.includes(item.dorm_id)} onCompare={() => compare(item)} onPress={() => router.push(`/(tabs)/${item.dorm_id}` as never)} showMatchScore={hasPreferences} />}
        renderSectionHeader={({ section }) => <View style={styles.sectionHeader}><View style={styles.resultHeader}><Text style={[styles.title, { flex: 1 }]}>{section.title}</Text>{section.matches && <Pressable accessibilityLabel="Reset search filters" onPress={resetFilters} style={styles.reset}><Text style={styles.resetText}>Reset</Text></Pressable>}</View><Text style={styles.subtitle}>{section.subtitle}</Text></View>}
        renderSectionFooter={({ section }) => !loading && section.matches && section.data.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>{recommendations.length ? 'No exact matches. Try fewer filters, or explore the recommendations below.' : 'No exact matches. Try fewer filters or reset your search.'}</Text></View> : null}
        ListHeaderComponent={<View><ErrorNotice message={error} />{!hasSearched && <View style={styles.searchPrompt}><Text style={styles.promptTitle}>Find your next place</Text><Text style={styles.subtitle}>Search a dorm or area, or choose your budget and must-haves. Your matches will appear after you search.</Text></View>}{loading && dorms.length === 0 ? <View style={styles.empty}><ActivityIndicator color={AppColors.accent} /><Text style={styles.subtitle}>Loading listings…</Text></View> : null}{searchOrigin && <Text style={styles.anchor}>Distance from {searchOrigin.label}</Text>}{hasSearched && filters.radiusEnabled && !searchLocation && <Text style={styles.anchor}>Choose a school in Maps or enable location to apply the distance filter.</Text>}</View>}
        stickySectionHeadersEnabled={false}
        refreshing={refreshing}
        onRefresh={refresh}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
      />
      <DiscoverySearchSheet key={`${sheetVisible}-${openFilters}`} visible={sheetVisible} openFiltersInitially={openFilters} onClose={() => setSheetVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  resultHeader: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 5 },
  sectionHeader: { paddingTop: 16, paddingBottom: 12 },
  title: { color: AppColors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: AppColors.textSecondary, fontSize: 12, lineHeight: 18, paddingTop: 3 },
  reset: { flexShrink: 0, paddingHorizontal: 11, paddingVertical: 7, borderRadius: BorderRadius.full, backgroundColor: AppColors.surface },
  resetText: { color: AppColors.accent, fontSize: 11, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  empty: { alignItems: 'center', gap: 8, padding: 20, borderRadius: BorderRadius.lg, backgroundColor: AppColors.surface },
  emptyText: { color: AppColors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  anchor: { color: AppColors.textSecondary, fontSize: 12, lineHeight: 18, paddingTop: 8 },
  searchPrompt: { paddingTop: 12, paddingBottom: 8, gap: 4 },
  promptTitle: { color: AppColors.text, fontSize: 21, lineHeight: 28, fontWeight: '800' },
});
