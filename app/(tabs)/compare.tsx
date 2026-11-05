import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius } from '@/constants/theme';
import { useDiscovery } from '@/context/discovery-context';
import { formatPeso } from '@/lib/dorm-discovery';
import { askGeminiAssistant } from '@/lib/gemini-assistant';
import type { Dorm } from '@/types/dorm';

interface ComparisonRow { key: string; label: string; value: string; score?: number }

function yesNo(value: boolean | null | undefined) { return value ? 'Yes' : 'No'; }

function rowsFor(dorm: Dorm, showMatchScore: boolean): ComparisonRow[] {
  return [
    { key: 'price', label: 'Monthly price', value: formatPeso(dorm.price), score: -dorm.price },
    ...(showMatchScore ? [{ key: 'match', label: 'Match Score', value: `${dorm.ranking_score}/100`, score: dorm.ranking_score }] : []),
    { key: 'rating', label: 'Rating', value: dorm.rating_count ? `${dorm.rating_average} (${dorm.rating_count})` : 'No reviews yet', score: dorm.rating_count ? dorm.rating_average : 0 },
    { key: 'distance', label: 'Distance', value: dorm.distance_km === null ? 'Enable GPS' : `${dorm.distance_km} km`, score: dorm.distance_km === null ? undefined : -dorm.distance_km },
    { key: 'availability', label: 'Tenant slots', value: dorm.available_slots > 0 ? `${dorm.available_slots} left` : 'Unavailable', score: dorm.available_slots },
    { key: 'lgu', label: 'LGU certified', value: yesNo(dorm.lgu_certified), score: dorm.lgu_certified ? 1 : 0 },
    { key: 'pet', label: 'Pet friendly', value: yesNo(dorm.pet_friendly), score: dorm.pet_friendly ? 1 : 0 },
    { key: 'gender', label: 'Gender policy', value: dorm.gender_policy || 'Not specified' },
    { key: 'curfew', label: 'Curfew', value: dorm.curfew || 'No curfew listed' },
    { key: 'parking', label: 'Parking', value: dorm.parking_info || 'None listed', score: dorm.parking_info ? 1 : 0 },
    { key: 'amenities', label: 'Amenities', value: dorm.amenities.length ? dorm.amenities.join(', ') : 'None listed', score: dorm.amenities.length },
    { key: 'utilities', label: 'Utilities', value: dorm.utilities.length ? dorm.utilities.join(', ') : 'None listed', score: dorm.utilities.length },
    { key: 'reservation', label: 'Reservation fee', value: dorm.reservation_fee ? formatPeso(dorm.reservation_fee) : 'Ask owner', score: dorm.reservation_fee ? -dorm.reservation_fee : undefined },
  ];
}

function CompareColumn({ dorm, width, winnerKeys, showMatchScore, remove, open }: { dorm: Dorm; width: number; winnerKeys: Set<string>; showMatchScore: boolean; remove: () => void; open: () => void }) {
  return (
    <View style={[styles.column, { width }]}>
      <Image source={dorm.images[0] ? { uri: dorm.images[0] } : require('../../assets/placeholder.jpg')} style={styles.image} contentFit="cover" />
      <View style={styles.columnHeader}><Text style={styles.name} numberOfLines={2}>{dorm.name}</Text><Text style={styles.address} numberOfLines={3}>{dorm.address}</Text></View>
      {rowsFor(dorm, showMatchScore).map((row) => {
        const isWinner = winnerKeys.has(row.key);
        return <View key={row.key} style={[styles.row, isWinner && styles.bestRow]}><Text style={styles.rowLabel}>{row.label}</Text><Text selectable style={[styles.rowValue, isWinner && styles.bestValue]}>{row.value}</Text>{isWinner && <Text style={styles.bestLabel}>Stronger choice</Text>}</View>;
      })}
      <Pressable onPress={open} style={styles.openButton}><Text style={styles.openText}>View property</Text></Pressable>
      <Pressable onPress={remove} style={styles.removeButton}><Text style={styles.removeText}>Remove</Text></Pressable>
    </View>
  );
}

export default function Compare() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { allRankedDorms, comparedDorms, toggleCompare, clearCompare, hasPreferences } = useDiscovery();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const columnWidth = Math.max(132, (width - 38) / 2);
  const options = allRankedDorms.filter((dorm) => dorm.availability_status === 'available' && !comparedDorms.some((selected) => selected.dorm_id === dorm.dorm_id));

  const winners = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    comparedDorms.forEach((dorm) => { result[dorm.dorm_id] = new Set<string>(); });
    if (comparedDorms.length !== 2) return result;
    const [left, right] = comparedDorms;
    const rightRows = new Map(rowsFor(right, hasPreferences).map((row) => [row.key, row]));
    for (const leftRow of rowsFor(left, hasPreferences)) {
      const rightRow = rightRows.get(leftRow.key);
      if (leftRow.score === undefined || rightRow?.score === undefined || leftRow.score === rightRow.score) continue;
      result[leftRow.score > rightRow.score ? left.dorm_id : right.dorm_id].add(leftRow.key);
    }
    return result;
  }, [comparedDorms, hasPreferences]);

  useEffect(() => {
    if (comparedDorms.length !== 2) { setAiSummary(''); return; }
    let active = true;
    setAiLoading(true);
    askGeminiAssistant({ action: 'compare', dormIds: comparedDorms.map((dorm) => dorm.dorm_id) })
      .then((response) => { if (active) setAiSummary(response.text); })
      .catch(() => {
        if (!active) return;
        const lowerPrice = [...comparedDorms].sort((a, b) => a.price - b.price)[0];
        const higherRated = [...comparedDorms].sort((a, b) => b.rating_average - a.rating_average)[0];
        setAiSummary(`Gemini is unavailable. ${lowerPrice.name} has the lower monthly price, while ${higherRated.name} currently has the stronger rating. Use the green category highlights with your priorities.`);
      })
      .finally(() => { if (active) setAiLoading(false); });
    return () => { active = false; };
  }, [comparedDorms]);

  function addDorm(dormId: string) {
    const selectedBefore = comparedDorms.length;
    toggleCompare(dormId);
    if (selectedBefore >= 1) setPickerOpen(false);
  }

  return (
    <View style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>Compare properties</Text><Text style={styles.subtitle}>{comparedDorms.length}/2 selected · Your data is not shared with other renters</Text></View>{comparedDorms.length > 0 && <Pressable onPress={clearCompare}><Text style={styles.clearText}>Clear</Text></Pressable>}</View>
        {comparedDorms.length === 0 ? (
          <View style={styles.empty}><Ionicons name="git-compare-outline" size={48} color={AppColors.accent} /><Text style={styles.emptyTitle}>Choose two dormitories</Text><Text style={styles.emptyText}>Select both here. You will not be sent back to Search.</Text><Pressable onPress={() => setPickerOpen(true)} style={styles.browseButton}><Text style={styles.browseText}>Choose dorms</Text></Pressable></View>
        ) : (
          <>
            {comparedDorms.length === 2 && <View style={styles.aiCard}><View style={styles.aiHeader}><MaterialCommunityIcons name="robot-happy-outline" size={21} color={AppColors.accent} /><Text style={styles.aiTitle}>SNAP comparison</Text></View>{aiLoading ? <ActivityIndicator color={AppColors.accent} /> : <Text selectable style={styles.aiText}>{aiSummary}</Text>}</View>}
            <View style={styles.columns}>
              {comparedDorms.map((dorm) => <CompareColumn key={dorm.dorm_id} dorm={dorm} width={columnWidth} winnerKeys={winners[dorm.dorm_id] || new Set()} showMatchScore={hasPreferences} remove={() => toggleCompare(dorm.dorm_id)} open={() => router.push(`/(tabs)/${dorm.dorm_id}` as never)} />)}
              {comparedDorms.length < 2 && <Pressable onPress={() => setPickerOpen(true)} style={[styles.addColumn, { width: columnWidth }]}><Ionicons name="add-circle-outline" size={34} color={AppColors.accent} /><Text style={styles.addText}>Add another</Text><Text style={styles.addHint}>Choose from the list</Text></Pressable>}
            </View>
          </>
        )}
      </ScrollView>

      <Host style={styles.host}>
        <BottomSheet isPresented={pickerOpen} onDismiss={() => setPickerOpen(false)} snapPoints={['half', 'full']} contentPadding={0}>
          <RNHostView style={{ height: Math.min(620, height * 0.78) }}>
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Add to comparison</Text><Text style={styles.sheetSubtitle}>Tap an available dorm to add it</Text></View><Pressable accessibilityLabel="Close property picker" onPress={() => setPickerOpen(false)} hitSlop={12}><Ionicons name="close-circle" size={28} color={AppColors.textMuted} /></Pressable></View>
              <FlatList data={options} keyExtractor={(item) => item.dorm_id} contentContainerStyle={styles.optionList} ListEmptyComponent={<Text style={styles.emptyText}>No other available dormitories can be compared right now.</Text>} renderItem={({ item }) => <Pressable onPress={() => addDorm(item.dorm_id)} style={({ pressed }) => [styles.optionRow, pressed && styles.optionPressed]}><Image source={item.images[0] ? { uri: item.images[0] } : require('../../assets/placeholder.jpg')} style={styles.optionImage} contentFit="cover" /><View style={styles.optionCopy}><Text style={styles.optionName} numberOfLines={1}>{item.name}</Text><Text style={styles.optionMeta} numberOfLines={2}>{formatPeso(item.price)} / month · {item.available_slots} slot{item.available_slots === 1 ? '' : 's'} left</Text></View><Ionicons name="add-circle" size={28} color={AppColors.accent} /></Pressable>} />
            </View>
          </RNHostView>
        </BottomSheet>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background }, content: { paddingHorizontal: 14, paddingBottom: 120, gap: 14 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }, headerCopy: { flex: 1 }, title: { color: AppColors.text, fontSize: 25, fontWeight: '800' }, subtitle: { color: AppColors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 3 }, clearText: { color: AppColors.error, fontSize: 13, fontWeight: '700', paddingVertical: 8 },
  empty: { padding: 30, gap: 10, alignItems: 'center', borderRadius: BorderRadius.xl, backgroundColor: AppColors.surface }, emptyTitle: { color: AppColors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' }, emptyText: { color: AppColors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' }, browseButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: BorderRadius.md, backgroundColor: AppColors.accent }, browseText: { color: AppColors.white, fontWeight: '800' },
  aiCard: { gap: 8, padding: 13, borderRadius: BorderRadius.lg, backgroundColor: AppColors.surfaceElevated, borderWidth: 1, borderColor: AppColors.accentMuted }, aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 }, aiTitle: { color: AppColors.text, fontWeight: '800', fontSize: 13 }, aiText: { color: AppColors.textSecondary, fontSize: 12, lineHeight: 18 }, columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  column: { overflow: 'hidden', borderRadius: BorderRadius.lg, borderCurve: 'continuous', backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.borderSubtle }, image: { width: '100%', height: 112, backgroundColor: AppColors.surfaceElevated }, columnHeader: { minHeight: 104, padding: 11, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AppColors.borderSubtle }, name: { color: AppColors.text, fontSize: 16, fontWeight: '800' }, address: { color: AppColors.textSecondary, fontSize: 10, lineHeight: 15 },
  row: { minHeight: 72, padding: 10, gap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AppColors.borderSubtle }, bestRow: { backgroundColor: AppColors.successBg }, rowLabel: { color: AppColors.textMuted, fontSize: 9, fontWeight: '700', textTransform: 'uppercase' }, rowValue: { color: AppColors.text, fontSize: 12, lineHeight: 17 }, bestValue: { color: AppColors.success, fontWeight: '800' }, bestLabel: { color: AppColors.success, fontSize: 8, fontWeight: '700', textTransform: 'uppercase' },
  openButton: { margin: 10, marginBottom: 2, alignItems: 'center', paddingVertical: 10, borderRadius: BorderRadius.md, backgroundColor: AppColors.accent }, openText: { color: AppColors.white, fontSize: 11, fontWeight: '800' }, removeButton: { alignItems: 'center', paddingVertical: 10 }, removeText: { color: AppColors.error, fontSize: 11, fontWeight: '700' }, addColumn: { minHeight: 310, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: BorderRadius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: AppColors.accent, backgroundColor: AppColors.surface }, addText: { color: AppColors.accent, fontWeight: '800' }, addHint: { color: AppColors.textMuted, fontSize: 10 },
  host: { position: 'absolute', width: 1, height: 1, left: 0, bottom: 0 }, sheet: { flex: 1, backgroundColor: AppColors.background }, sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AppColors.borderSubtle }, sheetTitle: { color: AppColors.text, fontSize: 19, fontWeight: '800' }, sheetSubtitle: { color: AppColors.textMuted, fontSize: 11, marginTop: 2 }, optionList: { padding: 14, gap: 10, paddingBottom: 32 }, optionRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderRadius: BorderRadius.lg, backgroundColor: AppColors.surface }, optionPressed: { opacity: 0.75 }, optionImage: { width: 72, height: 62, borderRadius: BorderRadius.md, backgroundColor: AppColors.surfaceElevated }, optionCopy: { flex: 1, gap: 4 }, optionName: { color: AppColors.text, fontSize: 14, fontWeight: '800' }, optionMeta: { color: AppColors.textSecondary, fontSize: 11, lineHeight: 16 },
});
