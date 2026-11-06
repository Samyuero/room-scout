import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FilterSheet } from '@/components/filter-sheet';
import { ErrorToast } from '@/components/error-toast';
import { AppColors, BorderRadius } from '@/constants/theme';
import { useDiscovery } from '@/context/discovery-context';
import { supabase } from '@/lib/supabase';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { matchesDormQuery } from '@/lib/dorm-discovery';
import type { Dorm, DormFilters } from '@/types/dorm';

interface SearchBarProps {
  onPress: () => void;
  onFilterPress: () => void;
  value?: string;
  placeholder?: string;
}

export function DiscoverySearchBar({ onPress, onFilterPress, value, placeholder = 'Where do you want to stay?' }: SearchBarProps) {
  return (
    <Pressable accessibilityRole="search" onPress={onPress} style={styles.searchBar}>
      <Ionicons name="search" size={19} color={AppColors.textMuted} />
      <Text numberOfLines={1} style={[styles.searchBarText, !value && styles.placeholder]}>{value || placeholder}</Text>
      <Pressable
        accessibilityLabel="Open search filters"
        hitSlop={10}
        onPress={(event) => { event.stopPropagation(); onFilterPress(); }}
        style={styles.filterInside}
      >
        <Ionicons name="options-outline" size={23} color={AppColors.text} />
      </Pressable>
    </Pressable>
  );
}

interface SearchSheetProps {
  visible: boolean;
  onClose: () => void;
  onApplied?: (filters: DormFilters) => void;
  openFiltersInitially?: boolean;
}

export function DiscoverySearchSheet({ visible, onClose, onApplied, openFiltersInitially = false }: SearchSheetProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { allRankedDorms, filters, setFilters, setHasSearched, requestLocation, locationLoading, setSearchOrigin } = useDiscovery();
  const [query, setQuery] = useState(filters.query);
  const [recent, setRecent] = useState<string[]>([]);
  const [filtersVisible, setFiltersVisible] = useState(false);

  const recentKey = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    return `room_scout_recent_searches_${data.user?.id || 'signed-out'}`;
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const value = await AsyncStorage.getItem(await recentKey());
      const parsed = value ? JSON.parse(value) : [];
      setRecent(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 5) : []);
    } catch {
      setRecent([]);
    }
  }, [recentKey]);

  useEffect(() => {
    if (!visible) return;
    setQuery(filters.query);
    setRecent([]);
    setFiltersVisible(openFiltersInitially);
    void loadRecent();
  }, [filters.query, loadRecent, openFiltersInitially, visible]);

  async function saveRecent(value: string) {
    const clean = value.trim().slice(0, 100);
    if (!clean) return;
    const next = [clean, ...recent.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 5);
    setRecent(next);
    await AsyncStorage.setItem(await recentKey(), JSON.stringify(next));
  }

  function apply(nextFilters: DormFilters = { ...filters, query: query.trim() }, explicitQuery = query) {
    const safe = { ...nextFilters, query: explicitQuery.trim().slice(0, 100) };
    setFilters(safe);
    setHasSearched(true);
    void saveRecent(safe.query).catch(() => { /* Search still works if recent queries cannot be saved. */ });
    setFiltersVisible(false);
    onClose();
    onApplied?.(safe);
  }

  async function nearMe() {
    await requestLocation();
    setSearchOrigin(null);
    setQuery('Near me');
    const next = { ...filters, query: '', radiusEnabled: true };
    setFilters(next);
    setHasSearched(true);
    onClose();
    onApplied?.(next);
  }

  function openDorm(dorm: Dorm) {
    Keyboard.dismiss();
    void saveRecent(dorm.name).catch(() => { /* Opening a dorm does not depend on saving recent searches. */ });
    setFiltersVisible(false);
    onClose();
    router.push({ pathname: '/(tabs)/[dormId]', params: { dormId: dorm.dorm_id } });
  }

  const suggestions = useMemo(() => {
    return allRankedDorms.filter((dorm) => dorm.available && dorm.available_slots > 0 && dorm.availability_status === 'available' && matchesDormQuery(dorm, query))
      .slice(0, query.trim() ? 6 : 2);
  }, [allRankedDorms, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetPage}>
        <View style={[styles.sheetHeader, { paddingTop: Math.max(16, insets.top) }]}>
          <View style={styles.inputShell}>
            <Ionicons name="search" size={18} color={AppColors.textMuted} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => apply()}
              placeholder="Dorm, barangay, landmark, amenity"
              placeholderTextColor={AppColors.placeholder}
              returnKeyType="search"
              style={styles.input}
            />
            <Pressable accessibilityLabel="Open filters" onPress={() => setFiltersVisible(true)} style={styles.inputFilter}>
              <Ionicons name="options-outline" size={23} color={AppColors.text} />
            </Pressable>
          </View>
          <Pressable accessibilityLabel="Close search" onPress={onClose} style={({ pressed }) => [styles.closeAction, pressed && styles.pressed]}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
          <Pressable disabled={locationLoading} onPress={nearMe} style={styles.nearMeCard}>
            <View style={styles.nearMeIcon}><Ionicons name="navigate" size={20} color={AppColors.white} /></View>
            <View style={{ flex: 1 }}><Text style={styles.itemTitle}>Near me</Text><Text style={styles.itemSubtitle}>Use GPS and your selected distance</Text></View>
            <Ionicons name="chevron-forward" size={18} color={AppColors.textMuted} />
          </Pressable>

          {recent.length > 0 && (
            <View style={styles.group}>
              <View style={styles.groupHeader}><Text style={styles.groupTitle}>Recent searches</Text><Text style={styles.privateNote}>Only on this account</Text></View>
              {recent.map((item) => (
                <Pressable key={item} onPress={() => { setQuery(item); apply({ ...filters, query: item }, item); }} style={styles.rowItem}>
                  <Ionicons name="time-outline" size={18} color={AppColors.textMuted} />
                  <Text style={styles.rowText}>{item}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.group}>
            <View style={styles.groupHeader}><Text style={styles.groupTitle}>Dorm suggestions</Text><Text style={styles.privateNote}>Public listings</Text></View>
            {suggestions.map((dorm) => (
              <Pressable key={dorm.dorm_id} accessibilityRole="button" accessibilityLabel={`View ${dorm.name}`} onPress={() => openDorm(dorm)} style={styles.suggestion}>
                <Image source={dorm.images[0] ? { uri: dorm.images[0] } : require('../../assets/placeholder.jpg')} contentFit="cover" style={styles.thumbnail} />
                <View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.itemTitle}>{dorm.name}</Text><Text numberOfLines={1} style={styles.itemSubtitle}>{dorm.address}</Text></View>
                <Ionicons name="arrow-up-outline" size={17} color={AppColors.textMuted} style={{ transform: [{ rotate: '45deg' }] }} />
              </Pressable>
            ))}
            {suggestions.length === 0 && <Text style={styles.itemSubtitle}>No available dorm suggestions for this search.</Text>}
          </View>
        </ScrollView>

        <View style={[styles.bottomAction, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <Pressable accessibilityRole="button" onPress={() => apply()} style={({ pressed }) => [styles.applySearch, pressed && styles.pressed]}><Text style={styles.applySearchText}>Search dorms</Text></Pressable>
        </View>
        <FilterSheet visible={filtersVisible} filters={filters} onClose={() => setFiltersVisible(false)} onApply={apply} />
        <ErrorToast />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  searchBar: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 15, paddingRight: 6, borderRadius: 18, borderCurve: 'continuous', backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.border, boxShadow: '0 8px 22px rgba(0,0,0,0.18)' },
  searchBarText: { flex: 1, color: AppColors.text, fontSize: 14, fontWeight: '600' },
  placeholder: { color: AppColors.textMuted, fontWeight: '500' },
  filterInside: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  sheetPage: { flex: 1, backgroundColor: AppColors.background },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  closeAction: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: BorderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.surface },
  closeText: { color: AppColors.accent, fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  inputShell: { flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 5, borderRadius: 18, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.border },
  input: { flex: 1, height: 50, color: AppColors.text, fontSize: 14 },
  inputFilter: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: 'transparent' },
  sheetContent: { padding: 16, paddingBottom: 110, gap: 18 },
  nearMeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, borderCurve: 'continuous', backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.border },
  nearMeIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.accent },
  group: { gap: 7 },
  groupHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 2 },
  groupTitle: { color: AppColors.text, fontSize: 17, fontWeight: '800' },
  privateNote: { color: AppColors.textMuted, fontSize: 10 },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 46, paddingHorizontal: 12, borderRadius: 15, backgroundColor: AppColors.surface },
  rowText: { flex: 1, color: AppColors.textSecondary, fontSize: 14 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 9, borderRadius: 18, backgroundColor: AppColors.surface },
  thumbnail: { width: 58, height: 54, borderRadius: 14 },
  itemTitle: { color: AppColors.text, fontSize: 14, fontWeight: '700' },
  itemSubtitle: { color: AppColors.textMuted, fontSize: 11, paddingTop: 3 },
  bottomAction: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, alignItems: 'flex-end', backgroundColor: AppColors.background, borderTopWidth: 1, borderTopColor: AppColors.borderSubtle },
  applySearch: { minHeight: 48, paddingHorizontal: 24, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.full, backgroundColor: AppColors.accent },
  applySearchText: { color: AppColors.white, fontSize: 15, fontWeight: '800' },
});
