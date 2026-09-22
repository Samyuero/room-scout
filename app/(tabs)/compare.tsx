import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius } from '@/constants/theme';
import { useDiscovery } from '@/context/discovery-context';
import { formatPeso } from '@/lib/dorm-discovery';
import type { Dorm } from '@/types/dorm';

const COLUMN_WIDTH = 224;

function yesNo(value: boolean | null | undefined) {
  return value ? 'Yes' : 'No';
}

function CompareColumn({ dorm, remove, open }: { dorm: Dorm; remove: () => void; open: () => void }) {
  const rows = [
    ['Monthly price', formatPeso(dorm.price)],
    ['Smart match', `${dorm.ranking_score}/100`],
    ['Rating', dorm.rating_count ? `${dorm.rating_average} (${dorm.rating_count})` : 'No reviews yet'],
    ['Distance', dorm.distance_km === null ? 'Enable GPS' : `${dorm.distance_km} km`],
    ['Availability', dorm.availability_status || (dorm.available ? 'Available' : 'Unavailable')],
    ['LGU certified', yesNo(dorm.lgu_certified)],
    ['Pet friendly', yesNo(dorm.pet_friendly)],
    ['Gender policy', dorm.gender_policy || 'Not specified'],
    ['Curfew', dorm.curfew || 'Not specified'],
    ['Parking', dorm.parking_info || 'Not specified'],
    ['Amenities', dorm.amenities.length ? dorm.amenities.join(', ') : 'None listed'],
    ['Utilities', dorm.utilities.length ? dorm.utilities.join(', ') : 'None listed'],
    ['Reservation fee', dorm.reservation_fee ? formatPeso(dorm.reservation_fee) : 'Ask owner'],
  ];

  return (
    <View style={styles.column}>
      <Image
        source={dorm.images[0] ? { uri: dorm.images[0] } : require('../../assets/placeholder.jpg')}
        style={styles.image}
        contentFit="cover"
      />
      <View style={styles.columnHeader}>
        <Text style={styles.name} numberOfLines={2}>{dorm.name}</Text>
        <Text style={styles.address} numberOfLines={2}>{dorm.address}</Text>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text selectable style={styles.rowValue}>{value}</Text>
        </View>
      ))}
      <Pressable onPress={open} style={styles.openButton}><Text style={styles.openText}>View property</Text></Pressable>
      <Pressable onPress={remove} style={styles.removeButton}><Text style={styles.removeText}>Remove</Text></Pressable>
    </View>
  );
}

export default function Compare() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { comparedDorms, toggleCompare, clearCompare } = useDiscovery();

  return (
    <ScrollView
      style={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Compare properties</Text>
          <Text style={styles.subtitle}>{comparedDorms.length}/3 selected · Public listing data only</Text>
        </View>
        {comparedDorms.length > 0 && (
          <Pressable onPress={clearCompare}><Text style={styles.clearText}>Clear</Text></Pressable>
        )}
      </View>

      {comparedDorms.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="git-compare-outline" size={52} color={AppColors.accent} />
          <Text style={styles.emptyTitle}>Choose up to three dorms</Text>
          <Text style={styles.emptyText}>Tap Compare on a Home or Search result to see price, distance, policies, and amenities side by side.</Text>
          <Pressable onPress={() => router.push('/(tabs)/search')} style={styles.browseButton}>
            <Text style={styles.browseText}>Browse dorms</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.tip}>
            <Ionicons name="information-circle-outline" size={17} color={AppColors.accent} />
            <Text style={styles.tipText}>Swipe sideways to compare. Smart match is guidance, not a guarantee.</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.columns}>
            {comparedDorms.map((dorm) => (
              <CompareColumn
                key={dorm.dorm_id}
                dorm={dorm}
                remove={() => toggleCompare(dorm.dorm_id)}
                open={() => router.push(`/(tabs)/${dorm.dorm_id}` as never)}
              />
            ))}
            {comparedDorms.length < 3 && (
              <Pressable onPress={() => router.push('/(tabs)/search')} style={styles.addColumn}>
                <Ionicons name="add-circle-outline" size={34} color={AppColors.accent} />
                <Text style={styles.addText}>Add another</Text>
              </Pressable>
            )}
          </ScrollView>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  content: { paddingBottom: 110 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, marginBottom: 16 },
  title: { color: AppColors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: AppColors.textSecondary, fontSize: 12, marginTop: 3 },
  clearText: { color: AppColors.error, fontSize: 13, fontWeight: '700' },
  empty: { marginHorizontal: 18, padding: 34, gap: 10, alignItems: 'center', borderRadius: BorderRadius.xl, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.border },
  emptyTitle: { color: AppColors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: AppColors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  browseButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: BorderRadius.md, backgroundColor: AppColors.accent },
  browseText: { color: AppColors.white, fontWeight: '800' },
  tip: { flexDirection: 'row', gap: 7, alignItems: 'center', marginHorizontal: 18, marginBottom: 12, padding: 10, borderRadius: BorderRadius.md, backgroundColor: AppColors.surfaceElevated },
  tipText: { flex: 1, color: AppColors.textSecondary, fontSize: 11 },
  columns: { gap: 12, paddingHorizontal: 18, paddingBottom: 12 },
  column: { width: COLUMN_WIDTH, overflow: 'hidden', borderRadius: BorderRadius.lg, borderCurve: 'continuous', backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.borderSubtle },
  image: { width: '100%', height: 128, backgroundColor: AppColors.surfaceElevated },
  columnHeader: { minHeight: 92, padding: 13, gap: 4, borderBottomWidth: 1, borderBottomColor: AppColors.borderSubtle },
  name: { color: AppColors.text, fontSize: 17, fontWeight: '800' },
  address: { color: AppColors.textSecondary, fontSize: 11, lineHeight: 16 },
  row: { minHeight: 66, padding: 12, gap: 5, borderBottomWidth: 1, borderBottomColor: AppColors.borderSubtle },
  rowLabel: { color: AppColors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  rowValue: { color: AppColors.text, fontSize: 13, lineHeight: 18 },
  openButton: { margin: 12, marginBottom: 4, alignItems: 'center', paddingVertical: 11, borderRadius: BorderRadius.md, backgroundColor: AppColors.accent },
  openText: { color: AppColors.white, fontSize: 12, fontWeight: '800' },
  removeButton: { alignItems: 'center', paddingVertical: 11, marginBottom: 5 },
  removeText: { color: AppColors.error, fontSize: 12, fontWeight: '700' },
  addColumn: { width: 150, minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: BorderRadius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: AppColors.accent, backgroundColor: AppColors.surface },
  addText: { color: AppColors.accent, fontWeight: '700' },
});
