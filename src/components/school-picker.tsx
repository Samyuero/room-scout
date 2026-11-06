import { BottomSheet, Host, RNHostView } from '@expo/ui';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UCLM_SCHOOL } from '@/constants/map';
import { AppColors, BorderRadius } from '@/constants/theme';
import { searchPlaces } from '@/lib/geocoding';
import { getErrorMessage } from '@/lib/logger';
import type { SearchOrigin } from '@/types/dorm';

export function SchoolPicker({ visible, onClose, onSelect, onClear, selectedSchool }: { visible: boolean; onClose: () => void; onSelect: (school: SearchOrigin) => void; onClear?: () => void; selectedSchool?: string | null }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchOrigin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  async function search() {
    if (loading || query.trim().length < 2) return;
    setLoading(true); setError(null); setSearched(true);
    try { setResults(await searchPlaces(query, true)); }
    catch (caught) { setError(getErrorMessage(caught, 'Could not search schools. Please retry.')); }
    finally { setLoading(false); }
  }
  function select(school: SearchOrigin) { onSelect(school); onClose(); }
  const schools = [UCLM_SCHOOL, ...results.filter((school) => !/uclm|lapu.lapu.*mandaue/i.test(school.label))];
  return <Host colorScheme="dark" seedColor={AppColors.accent}><BottomSheet isPresented={visible} onDismiss={onClose} snapPoints={['full']} contentPadding={0}>
    <RNHostView style={{ width, height: Math.max(300, height - insets.top - 70) }}>
      <View style={[styles.page, { paddingBottom: Math.max(16, insets.bottom) }]}>
        <View style={styles.header}><Text style={styles.title}>Choose a school</Text><Pressable accessibilityLabel="Close school picker" onPress={onClose} hitSlop={12}><Ionicons name="close" size={24} color={AppColors.text} /></Pressable></View>
        <Text style={styles.helper}>Use a campus as your starting point, even when GPS is off.</Text>
        {onClear && selectedSchool && <Pressable accessibilityRole="button" onPress={() => { setQuery(''); setResults([]); setSearched(false); onClear(); onClose(); }} style={({ pressed }) => [styles.school,{opacity:pressed?0.7:1}]}><Ionicons name="close-circle-outline" size={24} color={AppColors.accent}/><Text style={styles.name}>Clear location</Text></Pressable>}
        <View style={styles.searchRow}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="Search school or campus name" placeholderTextColor={AppColors.placeholder} returnKeyType="search" autoCorrect={false} style={styles.input} /><Pressable accessibilityLabel="Search schools" disabled={loading || query.trim().length < 2} onPress={() => void search()} style={styles.searchButton}>{loading ? <ActivityIndicator color={AppColors.white} /> : <Ionicons name="search" size={21} color={AppColors.white} />}</Pressable></View>
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
          {schools.map((school, index) => <Pressable accessibilityRole="button" accessibilityState={{selected:selectedSchool===school.label}} key={`${school.latitude}-${school.longitude}`} onPress={() => select(school)} style={({ pressed }) => [styles.school, { opacity: pressed ? 0.7 : 1 }]}><Ionicons name="school-outline" size={24} color={AppColors.accent} /><View style={{ flex: 1 }}><Text style={styles.name}>{school.label}</Text><Text style={styles.helper}>{index === 0 ? 'Capstone campus · Opao / Looc, Mandaue' : 'Use this school as the map center'}</Text></View><Ionicons name={selectedSchool===school.label?'checkmark-circle':'chevron-forward'} size={20} color={selectedSchool===school.label?AppColors.accent:AppColors.textSecondary} /></Pressable>)}
          {searched && !loading && results.length === 0 && !error && <Text style={styles.helper}>No other schools found. Try the complete school name and city.</Text>}
        </ScrollView>
        <Text style={styles.attribution}>School search uses Photon / OpenStreetMap.</Text>
      </View>
    </RNHostView>
  </BottomSheet></Host>;
}
const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12, backgroundColor: AppColors.background },
  header: { flexDirection: 'row', gap: 16, alignItems: 'center', justifyContent: 'space-between' },
  title: { color: AppColors.text, fontWeight: '800', fontSize: 22, flex: 1 },
  helper: { color: AppColors.textSecondary, fontSize: 13, lineHeight: 19 },
  searchRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minWidth: 0, minHeight: 48, color: AppColors.text, padding: 12, borderRadius: BorderRadius.md, backgroundColor: AppColors.input, borderWidth: 1, borderColor: AppColors.inputBorder },
  searchButton: { minWidth: 48, padding: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.accent, borderRadius: BorderRadius.md },
  results: { gap: 8, paddingBottom: 16 },
  school: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AppColors.borderSubtle },
  name: { color: AppColors.text, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  error: { color: AppColors.error, fontSize: 13, lineHeight: 20 },
  attribution: { color: AppColors.textMuted, fontSize: 11 },
});
