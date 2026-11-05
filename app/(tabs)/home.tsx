import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorNotice } from '@/components/error-notice';
import { DormResultCard } from '@/components/dorm-result-card';
import { AppColors, BorderRadius } from '@/constants/theme';
import { useDiscovery } from '@/context/discovery-context';
import type { Dorm } from '@/types/dorm';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { allRankedDorms, loading, refreshing, refresh, error, isUsingCachedData, location, locationLoading, locationMessage, requestLocation, compareIds, toggleCompare, hasPreferences } = useDiscovery();
  const results = allRankedDorms.slice(0, 30);

  function compare(dorm: Dorm) {
    if (toggleCompare(dorm.dorm_id) === 'limit') Alert.alert('Comparison full', 'Remove one dorm before adding another.');
  }

  if (loading && results.length === 0) {
    return <View style={styles.centered}><Image source={require('../../assets/logo.png')} contentFit="contain" style={styles.loadingLogo} /><ActivityIndicator color={AppColors.accent} size="large" /><Text style={styles.loadingTitle}>Preparing nearby dorms</Text><Text style={styles.helper}>Ratings, availability and maps are loading.</Text></View>;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"

        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[AppColors.accent]} tintColor={AppColors.accent} />}
        contentContainerStyle={styles.content}
      >
        <View style={styles.brandHeader}>
          <Image source={require('../../assets/logo.png')} contentFit="contain" style={styles.logo} />
          <Text style={styles.brandName}>Room Scout</Text>
          <Text style={styles.brandTagline}>Find a place that feels right.</Text>
        </View>


        <View style={styles.body}>
          <Pressable disabled={locationLoading} onPress={requestLocation} style={styles.locationCard}>
            <View style={styles.locationIcon}><Ionicons name={location ? 'navigate' : 'navigate-outline'} size={19} color={AppColors.white} /></View>
            <View style={{ flex: 1 }}><Text style={styles.locationTitle}>{location ? 'Dorms near me' : 'Show dorms near me'}</Text><Text style={styles.helper}>{locationMessage || 'Location stays on this device and is used for distance ranking.'}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={AppColors.textMuted} />
          </Pressable>
          {isUsingCachedData && <Text style={styles.cacheText}>Saved listings are visible while live availability refreshes.</Text>}
          <ErrorNotice message={error} />

          {results.map((dorm) => (
            <DormResultCard
              key={dorm.dorm_id}
              dorm={dorm}
              compared={compareIds.includes(dorm.dorm_id)}
              onCompare={() => compare(dorm)}
              showMatchScore={hasPreferences}
              onPress={() => router.push(`/(tabs)/${dorm.dorm_id}` as never)}
            />
          ))}
          {results.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="home-outline" size={34} color={AppColors.textMuted} />
              <Text style={styles.sectionTitle}>No approved dormitories yet</Text>
              <Text style={styles.helper}>Owner submissions appear here after an administrator reviews and approves them.</Text>
            </View>
          )}
        </View>
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  content: { paddingBottom: 120 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28, backgroundColor: AppColors.background },
  loadingLogo: { width: 112, height: 94 },
  loadingTitle: { color: AppColors.text, fontSize: 18, fontWeight: '800' },
  brandHeader: { alignItems: 'center', paddingTop: 10, paddingBottom: 16 },
  logo: { width: 164, height: 126 },
  brandName: { color: AppColors.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.7 },
  brandTagline: { color: AppColors.textMuted, fontSize: 11, paddingTop: 3 },
  stickySearch: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: AppColors.background },
  body: { paddingHorizontal: 16, gap: 12 },
  locationCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 19, borderCurve: 'continuous', backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.border },
  locationIcon: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.accent },
  locationTitle: { color: AppColors.text, fontSize: 13, fontWeight: '800' },
  helper: { color: AppColors.textMuted, fontSize: 10, lineHeight: 15 },
  cacheText: { color: AppColors.warning, fontSize: 10 },
  errorText: { color: AppColors.error, fontSize: 11 },
  sectionHeader: { paddingTop: 7, paddingBottom: 1 },
  sectionTitle: { color: AppColors.text, fontSize: 18, fontWeight: '800' },
  empty: { alignItems: 'center', gap: 8, padding: 38, borderRadius: BorderRadius.lg, backgroundColor: AppColors.surface },
});
