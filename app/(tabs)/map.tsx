import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DiscoverySearchBar, DiscoverySearchSheet } from '@/components/discovery-search';
import { showWarning } from '@/components/error-toast';
import { LeafletMapView, type AnalyticsMode } from '@/components/leaflet-map-view';
import { SchoolPicker } from '@/components/school-picker';
import { AppColors, BorderRadius } from '@/constants/theme';
import { OPAO_COORDINATES } from '@/constants/map';
import { useDiscovery } from '@/context/discovery-context';
import { useAuth } from '@/hooks/useAuth';
import { formatPeso, matchesDormFilters } from '@/lib/dorm-discovery';
import { searchPlaces } from '@/lib/geocoding';
import { getErrorMessage, logEvent } from '@/lib/logger';
import { aggregateDemandAreas, aggregatePriceAreas, averageDemand, demandLabel, getAreaDemandSummary, getVisiblePriceSummary, historicalDemand, mapExplorationFilters, MAP_COLORS, type DemandContext, type MapBounds } from '@/lib/map-analytics';
import { getAssistantQuotaWarning, predictDormDemand } from '@/lib/gemini-assistant';
import { supabase } from '@/lib/supabase';
import type { Dorm, DormFilters, SearchOrigin } from '@/types/dorm';

type Forecast = ReturnType<typeof historicalDemand>;
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { height, width, fontScale } = useWindowDimensions();
  const compact = width < 390 || fontScale > 1.15;
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ dormId?: string; latitude?: string; longitude?: string; lat?: string; lng?: string }>();
  const [focusedDormId, setFocusedDormId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<AnalyticsMode>('none');
  const [searchVisible, setSearchVisible] = useState(false);
  const [openFilters, setOpenFilters] = useState(false);
  const [schoolVisible, setSchoolVisible] = useState(false);
  const [browseWithoutOrigin, setBrowseWithoutOrigin] = useState(false);
  const [useFallbackOrigin, setUseFallbackOrigin] = useState(false);
  const [mapRevision, setMapRevision] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const [fitAllDorms, setFitAllDorms] = useState(false);
  const [panelHeight, setPanelHeight] = useState(0);
  const [radiusText, setRadiusText] = useState('2');
  const [exploreRadius, setExploreRadius] = useState(2);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [forecasts, setForecasts] = useState<Record<string, Forecast>>({});
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandSource, setDemandSource] = useState<'history' | 'gemini'>('history');
  const demandSnapshot = useRef<{ key: string; expires: number; forecasts: Record<string, Forecast>; source: 'history' | 'gemini' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [placeLoading, setPlaceLoading] = useState(false);
  const predictionRun = useRef(0);
  const placeRun = useRef(0);
  useEffect(() => () => { predictionRun.current += 1; placeRun.current += 1; }, []);
  useEffect(() => { demandSnapshot.current = null; setForecasts({}); setMode('none'); }, [user?.id]);
  const { allRankedDorms, filters, setFilters, setHasSearched, location, searchOrigin, setSearchOrigin, locationLoading, locationMessage, requestLocation, hasPreferences, loading, refreshing, refresh } = useDiscovery();
  const anchor = useMemo(() => searchOrigin || (browseWithoutOrigin ? null : useFallbackOrigin ? { ...OPAO_COORDINATES, label: 'Opao, Mandaue · default area', kind: 'default' } : location ? { ...location, label: 'Device location', kind: 'device' } : null), [searchOrigin, location, browseWithoutOrigin, useFallbackOrigin]);
  const center = anchor || OPAO_COORDINATES;
  const radiusKm = filters.radiusEnabled ? filters.radiusKm : exploreRadius;
  const validDorms = useMemo(() => allRankedDorms.filter((dorm) => Number.isFinite(dorm.latitude) && Number.isFinite(dorm.longitude) && (dorm.dorm_id === focusedDormId || matchesDormFilters(dorm, filters, anchor))), [allRankedDorms, filters, anchor, focusedDormId]);
  const selected = validDorms.find((dorm) => dorm.dorm_id === selectedId) || null;
  const selectedForecast = selected ? forecasts[selected.dorm_id] : null;
  const visiblePrice = useMemo(() => getVisiblePriceSummary(validDorms, bounds), [validDorms, bounds]);
  const priceAreas = useMemo(() => aggregatePriceAreas(validDorms, visiblePrice.average), [validDorms, visiblePrice.average]);
  const demandAreas = useMemo(() => aggregateDemandAreas(validDorms, forecasts), [validDorms, forecasts]);
  const onViewportChange = useCallback((next: MapBounds) => setBounds((current) => current && current.south === next.south && current.north === next.north && current.west === next.west && current.east === next.east ? current : next), []);
  const highCount = validDorms.filter((dorm) => forecasts[dorm.dorm_id]?.level === 'high').length;
  const forecastCount = validDorms.filter((dorm) => forecasts[dorm.dorm_id]).length;
  const demandAverage = useMemo(() => averageDemand(validDorms.map((dorm) => forecasts[dorm.dorm_id])), [validDorms, forecasts]);
  const areaDemandAverage = useMemo(() => getAreaDemandSummary(validDorms, forecasts, anchor, radiusKm, bounds), [validDorms, forecasts, anchor, radiusKm, bounds]);
  const shouldFitDorms = fitAllDorms || mode !== 'none';
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (filters.radiusEnabled) setRadiusText(String(filters.radiusKm)); }, [filters.radiusEnabled, filters.radiusKm]);
  useEffect(() => {
    if (!params.dormId) return;
    const dorm = allRankedDorms.find((item) => item.dorm_id === params.dormId);
    const latitude = dorm?.latitude ?? Number(params.latitude ?? params.lat);
    const longitude = dorm?.longitude ?? Number(params.longitude ?? params.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    setSearchOrigin({ latitude, longitude, label: dorm?.name || 'Selected dorm', kind: 'place' });
    setBrowseWithoutOrigin(false); setUseFallbackOrigin(false); setFitAllDorms(false);
    setFocusedDormId(String(params.dormId));
    setSelectedId(String(params.dormId));
    // A deep-link is a one-time navigation intent, not a subscription to subsequent filter edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.dormId, params.latitude, params.longitude, params.lat, params.lng]);

  function chooseSchool(school: SearchOrigin) {
    placeRun.current += 1;
    setPlaceLoading(false);
    setBrowseWithoutOrigin(false); setUseFallbackOrigin(false); setFitAllDorms(true);
    setViewRevision((value) => value+1);
    setSearchOrigin(school);
    setFocusedDormId(null);
    setExploreRadius(radiusKm); setRadiusText(String(radiusKm));
    setFilters({ ...filters, query: '', radiusEnabled: false });
    setHasSearched(false);
    setSelectedId(null);
    setNotice(`Distances now start at ${school.label}. Your GPS position is unchanged.`);
  }
  function applyRadius() {
    const value = Number(radiusText);
    if (!Number.isFinite(value) || value < 0.1 || value > 20000) { setNotice('Enter a radius from 0.1 to 20,000 km.'); setRadiusText(String(radiusKm)); return; }
    setExploreRadius(value);
    if (filters.radiusEnabled) setFilters({ ...filters, radiusKm: value });
  }
  async function applySearch(next: DormFilters) {
    setFitAllDorms(false); setUseFallbackOrigin(false); setBrowseWithoutOrigin(false);
    setSelectedId(null);
    setFocusedDormId(null);
    if (!next.query.trim()) return;
    const textMatch = allRankedDorms.find((dorm) => matchesDormFilters(dorm, { ...next, radiusEnabled: false }, null));
    if (textMatch) { setSearchOrigin({ latitude: textMatch.latitude, longitude: textMatch.longitude, label: textMatch.name, kind: 'place' }); return; }
    const run = ++placeRun.current;
    setPlaceLoading(true);
    try {
      const place = (await searchPlaces(next.query))[0];
      if (run !== placeRun.current) return;
      if (!place) { setNotice('No mapped place found. Your listing search and filters are still applied.'); return; }
      setSearchOrigin(place);
      // A resolved area search becomes a geographic constraint, not a literal listing-name search.
      setFilters({ ...next, query: '', radiusKm: next.radiusEnabled ? next.radiusKm : exploreRadius, radiusEnabled: true });
      setNotice(`Showing matching dorms within ${next.radiusEnabled ? next.radiusKm : exploreRadius} km of ${place.label}.`);
    } catch (caught) { if (run === placeRun.current) setNotice(getErrorMessage(caught)); }
    finally { if (run === placeRun.current) setPlaceLoading(false); }
  }
  async function toggleDemand() {
    if (mode === 'demand') { setMode('none'); return; }
    setMode('demand'); setDemandLoading(true);
    const run = ++predictionRun.current;
    const snapshot = [...validDorms];
    const key = JSON.stringify([user?.id,snapshot.map((dorm) => [dorm.dorm_id,dorm.updated_at,dorm.available_slots,dorm.price,dorm.rating_average])]);
    const cached = demandSnapshot.current;
    if (cached && cached.key === key && cached.expires > Date.now()) {
      setForecasts(cached.forecasts); setDemandSource(cached.source); setDemandLoading(false); return;
    }
    let next = Object.fromEntries(snapshot.map((dorm) => [dorm.dorm_id,historicalDemand(dorm)]));
    let source: 'history' | 'gemini' = 'history';
    try {
      const { data, error } = await supabase.rpc('get_public_demand_context', { p_dorm_ids: snapshot.map((dorm) => dorm.dorm_id) });
      if (error) throw error;
      if (run !== predictionRun.current) return;
      const context = data as DemandContext;
      const byId = new Map((context?.listings || []).map((row) => [row.dorm_id, row]));
      next = Object.fromEntries(snapshot.map((dorm) => [dorm.dorm_id, historicalDemand(dorm, byId.get(dorm.dorm_id),context?.portfolio)]));
      // Publish one completed snapshot only. Panning/zooming never requests another forecast.
      if (snapshot.length && user) {
        try {
          const predictions = await predictDormDemand(snapshot.map((dorm) => dorm.dorm_id),key,user.id);
          if (run !== predictionRun.current) return;
          predictions.forEach((prediction) => {
            if (!next[prediction.dormId]) return;
            next[prediction.dormId] = { ...next[prediction.dormId], level: prediction.level, color: MAP_COLORS[prediction.level], badge: demandLabel(prediction.level), reason: prediction.reason, source: 'gemini' };
          });
          if (predictions.length) source = 'gemini';
        } catch (caught) {
          if (run === predictionRun.current) {
            const quotaWarning = getAssistantQuotaWarning(caught);
            if (quotaWarning) showWarning('SNAP limit reached', quotaWarning);
            else setNotice('SNAP is temporarily unavailable. Showing history-based estimates.');
          }
          logEvent('warn','demand_ai_unavailable',{ listingCount: snapshot.length,message: getErrorMessage(caught) });
        }
      }
    } catch (caught) {
      if (run !== predictionRun.current) return;
      setNotice('Demand history could not refresh. These are early estimates; retry Demand when connected.');
      logEvent('warn', 'demand_history_read_failed', { message: getErrorMessage(caught), listingCount: snapshot.length });
    } finally { if (run === predictionRun.current) {
      demandSnapshot.current = { key,expires: Date.now()+10*60*1000,forecasts: next,source };
      setForecasts(next); setDemandSource(source); setDemandLoading(false);
    } }
  }
  function clearMapLocation() {
    placeRun.current += 1; predictionRun.current += 1;
    setPlaceLoading(false); setDemandLoading(false); setMode('none'); setNotice(null);
    setSelectedId(null); setFocusedDormId(null); setSearchOrigin(null);
    setBrowseWithoutOrigin(true); setUseFallbackOrigin(false); setFitAllDorms(true);
    setFilters(mapExplorationFilters(radiusKm)); setExploreRadius(radiusKm); setRadiusText(String(radiusKm));
    setHasSearched(false);
    setViewRevision((value) => value+1);
  }
  async function locate() {
    const run = ++placeRun.current;
    predictionRun.current += 1;
    setPlaceLoading(false); setDemandLoading(false); setMode('none');
    setFocusedDormId(null); setSelectedId(null); setSearchOrigin(null);
    setBrowseWithoutOrigin(false); setUseFallbackOrigin(false); setFitAllDorms(true);
    setFilters(mapExplorationFilters(radiusKm)); setExploreRadius(radiusKm); setRadiusText(String(radiusKm));
    setHasSearched(false);
    const result = await requestLocation();
    if (run !== placeRun.current) return;
    setUseFallbackOrigin(!result);
    setViewRevision((value) => value+1);
    if (!result) setNotice('GPS is unavailable. Using the default Opao area and radius—not your detected position. All dorms remain visible; outside pins are red.');
  }
  async function resetMap() {
    clearMapLocation();
    setFilters(mapExplorationFilters(2)); setExploreRadius(2); setRadiusText('2');
    setBounds(null); setMapRevision((value) => value+1);
    await refresh();
  }
  async function openDirections(dorm: Dorm) {
    try { await Linking.openURL(`https://www.openstreetmap.org/directions?to=${dorm.latitude}%2C${dorm.longitude}`); }
    catch (caught) { Alert.alert('Directions unavailable', getErrorMessage(caught)); }
  }
  const legend = (items: [string, string][]) => <View style={styles.legendRow}>{items.map(([label, color]) => <View key={label} style={styles.legendItem}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>)}</View>;

  return <View style={styles.container}>
    <LeafletMapView key={mapRevision} dorms={validDorms} center={center} anchor={anchor || undefined} radiusKm={radiusKm} userLocation={browseWithoutOrigin || useFallbackOrigin ? null : location} analyticsMode={mode} demandPredictions={demandLoading ? {} : forecasts} priceAreas={priceAreas} demandAreas={demandLoading ? [] : demandAreas} onSelectDorm={setSelectedId} onViewportChange={onViewportChange} fitAllDorms={shouldFitDorms} topPadding={panelHeight + insets.top + 24} focusKey={`${focusedDormId ? `dorm:${focusedDormId}:` : ''}${anchor ? 'anchor' : 'browse'}:${center.latitude}:${center.longitude}:${anchor ? radiusKm : ''}:${viewRevision}:${shouldFitDorms ? `${mode}:${Math.ceil(panelHeight)}:${validDorms.map((dorm) => dorm.dorm_id).sort().join(',')}` : ''}`} />
    <ScrollView onLayout={(event) => { const next = event.nativeEvent.layout.height; setPanelHeight((current) => Math.abs(current-next)>1 ? next : current); }} pointerEvents="box-none" style={[styles.topPanel, { top: insets.top + 8, maxHeight: height * 0.55 }]} contentContainerStyle={styles.topContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <DiscoverySearchBar value={filters.query} placeholder={searchOrigin?.kind === 'place' ? searchOrigin.label : 'Search dorm or place'} onPress={() => { setOpenFilters(false); setSearchVisible(true); }} onFilterPress={() => { setOpenFilters(true); setSearchVisible(true); }} />
      <View style={styles.anchorRow}>
        <Pressable accessibilityLabel="Choose a school" onPress={() => setSchoolVisible(true)} style={({ pressed }) => [styles.schoolButton, { opacity: pressed ? 0.7 : 1 }]}><Ionicons name="school-outline" size={18} color={AppColors.accent} /><Text numberOfLines={1} style={styles.schoolText}>{searchOrigin?.kind === 'school' ? searchOrigin.label : 'Choose school'}</Text><Ionicons name="chevron-down" size={14} color={AppColors.textSecondary} /></Pressable>
        <View style={styles.radius}><TextInput accessibilityLabel="Map radius in kilometers" keyboardType="decimal-pad" value={radiusText} onChangeText={setRadiusText} onBlur={applyRadius} onSubmitEditing={applyRadius} selectTextOnFocus style={styles.radiusInput} /><Text style={styles.helper}>km</Text></View>
      </View>
      <View style={styles.mapControls}>
        {anchor && <Pressable accessibilityRole="button" onPress={clearMapLocation} style={styles.mapControl}><Ionicons name="close-circle-outline" size={16} color={AppColors.accent}/><Text style={styles.mapControlText}>Clear location</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Reset map and show all dormitories" disabled={refreshing} onPress={() => void resetMap()} style={styles.mapControl}>{refreshing ? <ActivityIndicator size="small" color={AppColors.accent}/> : <Ionicons name="refresh" size={16} color={AppColors.accent}/>}<Text style={styles.mapControlText}>Reset map</Text></Pressable>
      </View>
      <View style={styles.toolRow}>
        <Pressable accessibilityState={{ selected: mode === 'price' }} onPress={() => setMode((value) => value === 'price' ? 'none' : 'price')} style={[styles.toolButton, mode === 'price' && styles.activeButton]}><Ionicons name="analytics-outline" size={16} color={AppColors.text} /><Text style={styles.toolText}>Price</Text></Pressable>
        <Pressable disabled={demandLoading} accessibilityState={{ selected: mode === 'demand', busy: demandLoading }} onPress={() => void toggleDemand()} style={[styles.toolButton, mode === 'demand' && styles.activeButton]}>{demandLoading ? <ActivityIndicator size="small" color={AppColors.white} /> : <Ionicons name="trending-up-outline" size={16} color={AppColors.text} />}<Text style={styles.toolText}>Demand</Text></Pressable>
        <Pressable disabled={locationLoading} onPress={() => void locate()} style={styles.toolButton}>{locationLoading ? <ActivityIndicator size="small" color={AppColors.accent} /> : <Ionicons name="locate-outline" size={16} color={AppColors.accent} />}<Text style={styles.toolText}>Locate me</Text></Pressable>
      </View>
      {(placeLoading || notice || locationMessage && !searchOrigin && !browseWithoutOrigin && !useFallbackOrigin) && <Text accessibilityRole="alert" style={styles.notice}>{placeLoading ? 'Finding that place…' : notice || locationMessage}</Text>}
      {focusedDormId && <Text style={styles.notice}>Showing the selected dorm. Apply a new search to return to filtered pins.</Text>}
      {mode === 'price' && <View style={styles.analyticsCard}><Text style={styles.analyticsLabel}>Visible monthly average · {visiblePrice.count} listing{visiblePrice.count === 1 ? '' : 's'}</Text><Text style={styles.analyticsValue}>{visiblePrice.count ? formatPeso(visiblePrice.average) : 'No listings in this view'}</Text>{legend([['Cheaper', MAP_COLORS.cheaper], ['Average', MAP_COLORS.average], ['Expensive', MAP_COLORS.expensive]])}<Text style={styles.helper}>Each circle shows the average listed rent in a ~550 m area.</Text></View>}
      {mode === 'demand' && <View style={styles.analyticsCard}>
        <Text style={styles.analyticsLabel}>Next 30 days · {demandSource === 'gemini' ? 'SNAP-assisted forecast' : 'SNAP history-based forecast'}</Text>
        <Text style={[styles.analyticsValue, { color: demandLoading ? AppColors.text : areaDemandAverage.color }]}>{demandLoading ? 'Analysing booking history & housing factors…' : `${anchor ? `${radiusKm} km area` : 'Visible area'}: ${areaDemandAverage.label}`}</Text>
        {!demandLoading && areaDemandAverage.score !== null && <Text style={styles.helper}>Area index {areaDemandAverage.score.toFixed(1)} / 3 · {areaDemandAverage.count} dorm{areaDemandAverage.count === 1 ? '' : 's'}</Text>}
        {!demandLoading && demandAverage.score !== null && <Text style={styles.helper}>All shown: {demandAverage.label} · {demandAverage.score.toFixed(1)} / 3 · {forecastCount} dorm{forecastCount === 1 ? '' : 's'} · {highCount} High</Text>}
        {legend([['Low', MAP_COLORS.low], ['Moderate', MAP_COLORS.moderate], ['High', MAP_COLORS.high]])}
        <Text style={styles.helper}>Circles average a 400 m radius area. Tap a circle for its index; pins show each dorm. Estimates—not guaranteed bookings.</Text>
      </View>}
      {!selected && !loading && validDorms.length === 0 && <View style={styles.analyticsCard}><Text style={styles.notice}>No matching pins. Try fewer filters or explore recommendations in Search.</Text></View>}
    </ScrollView>
    {mode === 'none' && !selected && <View pointerEvents="none" style={[styles.mapLegend, { bottom: 28 + insets.bottom }]}>{anchor ? legend([['Nearby', MAP_COLORS.near], ['Radius edge', MAP_COLORS.edge], ['Outside', MAP_COLORS.far]]) : legend([['Available', AppColors.success], ['Reserved', AppColors.warning], ['Unavailable', AppColors.error]])}<Text style={styles.legendHint}>{!anchor ? 'Browse freely, or choose a school / Locate me to explore a radius.' : filters.radiusEnabled ? `Strict ${radiusKm} km filter · outside pins hidden` : `Exploring ${radiusKm} km from ${anchor.label}`}</Text></View>}
    {selected && <ScrollView style={[styles.selectedCard, { maxHeight: height * 0.4, bottom: Math.max(8, insets.bottom) }]} contentContainerStyle={styles.selectedContent}>
      <View style={styles.selectedHeader}><Text style={styles.selectedName}>{selected.name}</Text><Pressable accessibilityLabel="Close dorm preview" onPress={() => setSelectedId(null)} hitSlop={12}><Ionicons name="close-circle" size={25} color={AppColors.textSecondary} /></Pressable></View>
      <Text style={styles.selectedAddress}>{selected.address}</Text>
      <View style={[styles.selectedMetrics, compact && styles.stacked]}><Text style={styles.selectedPrice}>{formatPeso(selected.price)} / month</Text><Text style={styles.selectedRating}>{selected.rating_count ? `★ ${selected.rating_average} (${selected.rating_count})` : 'No reviews yet'}{hasPreferences ? ` · ${selected.ranking_score} Match Score` : ''}</Text></View>
      {mode === 'demand' && <Text style={[styles.forecastText, { color: selectedForecast?.color || MAP_COLORS.insufficient }]}>{demandLoading ? 'Preparing forecast…' : `${selectedForecast?.badge || 'Forecast pending'} — ${selectedForecast?.reason || 'Run Demand again to include this listing.'}`}</Text>}
      <View style={styles.selectedActions}><Pressable onPress={() => void openDirections(selected)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Directions</Text></Pressable><Pressable onPress={() => router.push(`/(tabs)/${selected.dorm_id}` as never)} style={styles.primaryButton}><Text style={styles.primaryText}>View details</Text></Pressable></View>
    </ScrollView>}
    <DiscoverySearchSheet key={`${searchVisible}-${openFilters}`} visible={searchVisible} openFiltersInitially={openFilters} onClose={() => setSearchVisible(false)} onApplied={(next) => void applySearch(next)} />
    <SchoolPicker visible={schoolVisible} onClose={() => setSchoolVisible(false)} onSelect={chooseSchool} onClear={clearMapLocation} selectedSchool={searchOrigin?.kind === 'school' ? searchOrigin.label : null} />
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  topPanel: { position: 'absolute', left: 12, right: 12 }, topContent: { gap: 8 },
  anchorRow: { flexDirection: 'row', gap: 8 },
  mapControls: {flexDirection:'row',justifyContent:'flex-end',alignItems:'center',flexWrap:'wrap',gap:8},
  mapControl: {flexDirection:'row',alignItems:'center',gap:5,minHeight:36,paddingVertical:6,paddingHorizontal:10,borderRadius:BorderRadius.full,backgroundColor:AppColors.overlay},
  mapControlText: {color:AppColors.accent,fontSize:11,fontWeight:'600'},
  schoolButton: { flex: 1, minWidth: 0, minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: AppColors.overlay, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: AppColors.border },
  schoolText: { flex: 1, color: AppColors.text, fontSize: 12, fontWeight: '600' },
  radius: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, backgroundColor: AppColors.overlay, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: AppColors.border },
  radiusInput: { color: AppColors.text, minWidth: 36, maxWidth: 68, paddingVertical: 8, fontSize: 13, textAlign: 'center' },
  toolRow: { flexDirection: 'row', gap: 6 },
  toolButton: { flex: 1, minWidth: 0, minHeight: 40, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 8, borderRadius: BorderRadius.full, backgroundColor: AppColors.overlay, borderWidth: 1, borderColor: AppColors.border },
  activeButton: { backgroundColor: AppColors.accent, borderColor: AppColors.accent },
  toolText: { color: AppColors.text, fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  analyticsCard: { padding: 12, gap: 6, borderRadius: BorderRadius.md, backgroundColor: AppColors.overlay },
  analyticsLabel: { color: AppColors.textSecondary, fontSize: 11, fontWeight: '600' }, analyticsValue: { color: AppColors.text, fontSize: 15, fontWeight: '800' },
  helper: { color: AppColors.textSecondary, fontSize: 11, lineHeight: 16 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 }, dot: { width: 7, height: 7, borderRadius: BorderRadius.full }, legendText: { color: AppColors.textSecondary, fontSize: 11 },
  mapLegend: { position: 'absolute', left: 36, right: 36, alignItems: 'center', gap: 5, padding: 10, borderRadius: BorderRadius.md, backgroundColor: AppColors.overlay }, legendHint: { color: AppColors.textSecondary, fontSize: 10, textAlign: 'center' },
  notice: { color: AppColors.text, fontSize: 12, lineHeight: 18, padding: 8, backgroundColor: AppColors.overlay, borderRadius: BorderRadius.md },
  selectedCard: { position: 'absolute', left: 12, right: 12, backgroundColor: AppColors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: AppColors.border }, selectedContent: { padding: 14, gap: 8 },
  selectedHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, selectedName: { color: AppColors.text, fontSize: 17, fontWeight: '800', flex: 1 }, selectedAddress: { color: AppColors.textSecondary, fontSize: 12, lineHeight: 18 },
  selectedMetrics: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }, stacked: { flexDirection: 'column' }, selectedPrice: { color: AppColors.accent, fontSize: 15, fontWeight: '800' }, selectedRating: { color: AppColors.warning, fontSize: 12, flexShrink: 1, lineHeight: 18 }, forecastText: { fontSize: 12, lineHeight: 18 },
  selectedActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, secondaryButton: { flex: 1, minWidth: 100, alignItems: 'center', padding: 12, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: AppColors.accent }, secondaryText: { color: AppColors.accent, fontWeight: '700', fontSize: 13 }, primaryButton: { flex: 1, minWidth: 100, alignItems: 'center', padding: 12, borderRadius: BorderRadius.md, backgroundColor: AppColors.accent }, primaryText: { color: AppColors.white, fontSize: 13, fontWeight: '700' },
});
