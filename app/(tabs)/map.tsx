import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DiscoverySearchBar, DiscoverySearchSheet } from '@/components/discovery-search';
import { LeafletMapView, type AnalyticsMode } from '@/components/leaflet-map-view';
import { AppColors, BorderRadius } from '@/constants/theme';
import { isPhilippinesCoordinates, UCLM_COORDINATES } from '@/constants/map';
import { useDiscovery } from '@/context/discovery-context';
import { formatPeso, getDemandPrediction } from '@/lib/dorm-discovery';
import { getErrorMessage } from '@/lib/logger';
import type { Dorm, UserCoordinates } from '@/types/dorm';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [analyticsMode, setAnalyticsMode] = useState<AnalyticsMode>('none');
  const [searchVisible, setSearchVisible] = useState(false);
  const [openFilters, setOpenFilters] = useState(false);
  const {
    rankedDorms,
    filters,
    location,
    locationLoading,
    requestLocation,
  } = useDiscovery();

  const center: UserCoordinates = (location && isPhilippinesCoordinates(location)) ? location : UCLM_COORDINATES;


  useEffect(() => {
    if (!location) void requestLocation();
    // Request once when the map is first opened; subsequent location refreshes are user initiated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validDorms = useMemo(
    () => rankedDorms.filter((dorm) => Number.isFinite(dorm.latitude) && Number.isFinite(dorm.longitude)),
    [rankedDorms],
  );
  const selected = validDorms.find((dorm) => dorm.dorm_id === selectedId) || null;
  const selectedDemand = selected ? getDemandPrediction(selected) : null;

  const averagePrice = validDorms.length
    ? validDorms.reduce((total, dorm) => total + dorm.price, 0) / validDorms.length
    : 0;

  const highDemandCount = validDorms.filter((dorm) => getDemandPrediction(dorm).level === 'high').length;

  async function openDirections(dorm: Dorm) {
    const label = encodeURIComponent(dorm.name);
    const geoUrl = `geo:${dorm.latitude},${dorm.longitude}?q=${dorm.latitude},${dorm.longitude}(${label})`;
    const webUrl = `https://www.openstreetmap.org/directions?to=${dorm.latitude}%2C${dorm.longitude}`;
    try {
      if (await Linking.canOpenURL(geoUrl)) await Linking.openURL(geoUrl);
      else await Linking.openURL(webUrl);
    } catch (caught) {
      Alert.alert('Directions unavailable', getErrorMessage(caught));
    }
  }

  return (
    <View style={styles.container}>
      <LeafletMapView
        dorms={validDorms}
        center={center}
        radiusKm={filters.radiusKm}
        userLocation={location}
        analyticsMode={analyticsMode}
        onSelectDorm={setSelectedId}
      />

      <View style={[styles.topPanel, { top: insets.top + 10 }]}>
        <DiscoverySearchBar value={filters.query} onPress={() => { setOpenFilters(false); setSearchVisible(true); }} onFilterPress={() => { setOpenFilters(true); setSearchVisible(true); }} />

        <View style={styles.toolRow}>
          <Pressable
            onPress={() => setAnalyticsMode((prev) => (prev === 'price' ? 'none' : 'price'))}
            style={[styles.toolButton, analyticsMode === 'price' && styles.toolButtonActive]}
          >
            <Ionicons name="analytics-outline" size={15} color={analyticsMode === 'price' ? AppColors.white : AppColors.accent} />
            <Text style={[styles.toolText, analyticsMode === 'price' && styles.toolTextActive]}>Price Analytics</Text>
          </Pressable>

          <Pressable
            onPress={() => setAnalyticsMode((prev) => (prev === 'demand' ? 'none' : 'demand'))}
            style={[styles.toolButton, analyticsMode === 'demand' && styles.toolButtonActiveDemand]}
          >
            <Ionicons name="trending-up-outline" size={15} color={analyticsMode === 'demand' ? AppColors.white : '#F97316'} />
            <Text style={[styles.toolText, analyticsMode === 'demand' && styles.toolTextActive]}>Demand Prediction</Text>
          </Pressable>

          <Pressable disabled={locationLoading} onPress={requestLocation} style={styles.toolButton}>
            {locationLoading
              ? <ActivityIndicator size="small" color={AppColors.accent} />
              : <Ionicons name="locate-outline" size={15} color={AppColors.accent} />}
            <Text style={styles.toolText}>Location</Text>
          </Pressable>
        </View>

        {analyticsMode === 'price' && (
          <View style={styles.analyticsCard}>
            <View>
              <Text style={styles.analyticsLabel}>Visible Average Price</Text>
              <Text style={styles.analyticsValue}>{formatPeso(averagePrice)}</Text>
            </View>
            <View style={styles.legendContainer}>
              <View style={styles.legend}><View style={[styles.dot, { backgroundColor: '#22C55E' }]} /><Text style={styles.legendText}>Cheaper</Text></View>
              <View style={styles.legend}><View style={[styles.dot, { backgroundColor: '#FBBF24' }]} /><Text style={styles.legendText}>Average</Text></View>
              <View style={styles.legend}><View style={[styles.dot, { backgroundColor: '#EF4444' }]} /><Text style={styles.legendText}>Expensive</Text></View>
            </View>
          </View>
        )}

        {analyticsMode === 'demand' && (
          <View style={styles.analyticsCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.analyticsLabel}>Occupancy Prediction</Text>
              <Text style={[styles.analyticsValue, { color: '#F97316' }]}>{highDemandCount} High Demand Dorms</Text>
              <Text style={{ color: AppColors.textMuted, fontSize: 10 }}>Predicts dorms likely to become fully occupied soon based on capacity & velocity</Text>
            </View>
            <View style={styles.legendContainerVertical}>
              <View style={styles.legend}><View style={[styles.dot, { backgroundColor: '#EF4444' }]} /><Text style={styles.legendText}>High Demand</Text></View>
              <View style={styles.legend}><View style={[styles.dot, { backgroundColor: '#FBBF24' }]} /><Text style={styles.legendText}>Moderate</Text></View>
              <View style={styles.legend}><View style={[styles.dot, { backgroundColor: '#34D399' }]} /><Text style={styles.legendText}>Steady</Text></View>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.mapLegend, { bottom: selected ? 230 + insets.bottom : 82 + insets.bottom }]}>
        <Text style={styles.mapLegendText}>● <Text style={{ color: AppColors.success }}>Available</Text>  ● <Text style={{ color: AppColors.warning }}>Reserved</Text>  ● <Text style={{ color: AppColors.error }}>Unavailable</Text></Text>
      </View>

      {selected && (
        <View style={[styles.selectedCard, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.selectedHeader}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text style={styles.selectedName} numberOfLines={1}>{selected.name}</Text>
                {selectedDemand && (
                  <View style={[styles.demandBadge, { backgroundColor: selectedDemand.color + '22', borderColor: selectedDemand.color }]}>
                    <Text style={[styles.demandBadgeText, { color: selectedDemand.color }]}>{selectedDemand.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.selectedAddress} numberOfLines={1}>{selected.address}</Text>
            </View>
            <Pressable onPress={() => setSelectedId(null)}><Ionicons name="close-circle" size={24} color={AppColors.textMuted} /></Pressable>
          </View>
          <View style={styles.selectedMetrics}>
            <Text style={styles.selectedPrice}>{formatPeso(selected.price)} / month</Text>
            <Text style={styles.selectedRating}>★ {selected.rating_average || 'New'} · {selected.ranking_score} match</Text>
          </View>
          {selectedDemand && (
            <Text style={{ color: AppColors.textSecondary, fontSize: 11, fontStyle: 'italic' }}>
              Occupancy: {selectedDemand.occupancyRate}% ({selectedDemand.availableSlots} slot{selectedDemand.availableSlots !== 1 ? 's' : ''} left) — {selectedDemand.label}
            </Text>
          )}
          <View style={styles.selectedActions}>
            <Pressable onPress={() => openDirections(selected)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Directions</Text></Pressable>
            <Pressable onPress={() => router.push(`/(tabs)/${selected.dorm_id}` as never)} style={styles.primaryButton}><Text style={styles.primaryText}>View details</Text></Pressable>
          </View>
        </View>
      )}

      <DiscoverySearchSheet key={`${searchVisible}-${openFilters}`} visible={searchVisible} openFiltersInitially={openFilters} onClose={() => setSearchVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  topPanel: { position: 'absolute', left: 14, right: 14, gap: 8 },
  toolRow: { flexDirection: 'row', gap: 6 },
  toolButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 8, borderRadius: BorderRadius.full, backgroundColor: AppColors.overlay, borderWidth: 1, borderColor: AppColors.border },
  toolButtonActive: { backgroundColor: AppColors.accent, borderColor: AppColors.accent },
  toolButtonActiveDemand: { backgroundColor: '#EA580C', borderColor: '#EA580C' },
  toolText: { color: AppColors.textSecondary, fontSize: 11, fontWeight: '700' },
  toolTextActive: { color: AppColors.white },
  analyticsCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 11, borderRadius: BorderRadius.md, backgroundColor: AppColors.overlay, borderWidth: 1, borderColor: AppColors.border },
  analyticsLabel: { color: AppColors.textMuted, fontSize: 9, textTransform: 'uppercase', fontWeight: '700' },
  analyticsValue: { color: AppColors.text, fontSize: 14, fontWeight: '800' },
  legendContainer: { flexDirection: 'row', gap: 8 },
  legendContainerVertical: { gap: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: AppColors.textSecondary, fontSize: 9 },
  mapLegend: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.full, backgroundColor: AppColors.overlay },
  mapLegendText: { color: AppColors.textMuted, fontSize: 9 },
  selectedCard: { position: 'absolute', left: 12, right: 12, bottom: 8, padding: 14, gap: 8, borderRadius: BorderRadius.lg, borderCurve: 'continuous', backgroundColor: AppColors.overlay, borderWidth: 1, borderColor: AppColors.border },
  selectedHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  selectedName: { color: AppColors.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  selectedAddress: { color: AppColors.textSecondary, fontSize: 11 },
  demandBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  demandBadgeText: { fontSize: 10, fontWeight: '800' },
  selectedMetrics: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedPrice: { color: AppColors.accent, fontSize: 14, fontWeight: '800' },
  selectedRating: { color: AppColors.warning, fontSize: 12, fontWeight: '600' },
  selectedActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  secondaryButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: AppColors.accent },
  secondaryText: { color: AppColors.accent, fontWeight: '800', fontSize: 13 },
  primaryButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: BorderRadius.md, backgroundColor: AppColors.accent },
  primaryText: { color: AppColors.white, fontWeight: '800', fontSize: 13 },
});

