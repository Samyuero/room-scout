import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppColors, BorderRadius } from '@/constants/theme';
import { formatPeso } from '@/lib/dorm-discovery';
import type { Dorm } from '@/types/dorm';

const APP_SESSION_STARTED_AT = Date.now();

interface Props {
  dorm: Dorm;
  onPress: () => void;
  compared: boolean;
  onCompare: () => void;
  compact?: boolean;
  showMatchScore?: boolean;
}

export function DormResultCard({ dorm, onPress, compared, onCompare, compact = false, showMatchScore = false }: Props) {
  const availability = dorm.availability_status || (dorm.available ? 'available' : 'unavailable');
  const statusColor =
    availability === 'available'
      ? AppColors.success
      : availability === 'reserved'
        ? AppColors.warning
        : AppColors.error;
  const createdAt = dorm.created_at ? new Date(dorm.created_at).getTime() : 0;
  const isNewListing = createdAt > 0 && APP_SESSION_STARTED_AT - createdAt < 7 * 24 * 60 * 60 * 1000;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${dorm.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, !dorm.available && styles.unavailableCard, pressed && styles.pressed]}
    >
      {dorm.images[0] ? <Image
        source={{ uri: dorm.images[0] }}
        style={[styles.image, compact && styles.compactImage]}
        contentFit="cover"
        transition={180}
      /> : <View style={[styles.image,compact && styles.compactImage,styles.imagePlaceholder]}><Ionicons name="bed-outline" size={34} color={AppColors.textMuted} /><Text style={styles.placeholderLabel}>Dormitory photos</Text></View>}
      {!dorm.available && <View pointerEvents="none" style={[styles.unavailableOverlay, compact && styles.compactImage]} />}
      {dorm.lgu_certified && <Pressable accessibilityLabel="LGU certification information" onPress={(event) => { event.stopPropagation(); Alert.alert('LGU certified', 'This listing has been marked as LGU certified by a RoomScout administrator.'); }} style={styles.certificationRibbon}><Ionicons name="ribbon" size={27} color={AppColors.accent} /></Pressable>}
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={styles.name} numberOfLines={1}>{dorm.name}</Text>
            <Text style={styles.address} numberOfLines={1}>{dorm.address}</Text>
          </View>
          {showMatchScore && (
            <View style={styles.scoreBadge}>
              <Text style={styles.score}>{dorm.ranking_score}</Text>
              <Text style={styles.scoreLabel}>Match Score</Text>
            </View>
          )}
        </View>

        <View style={styles.metrics}>
          <Text style={styles.price}>{formatPeso(dorm.price)}<Text style={styles.perMonth}> / month</Text></Text>
          <Text style={styles.rating}>
            {dorm.rating_count > 0 ? `★ ${dorm.rating_average} (${dorm.rating_count})` : 'No reviews yet'}
          </Text>
        </View>

        <View style={styles.footer}>
          <View style={styles.tags}>
            <Text style={[styles.tag, { color: statusColor, borderColor: statusColor }]}>
              {dorm.available && dorm.available_slots > 0 ? `${dorm.available_slots} left` : availability === 'reserved' ? 'Reserved' : 'Unavailable'}
            </Text>
            {dorm.distance_km !== null && <Text style={styles.tag}>{dorm.distance_km} km</Text>}
            {isNewListing && <Text style={[styles.tag, styles.newTag]}>New</Text>}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: compared }}
            onPress={(event) => {
              event.stopPropagation();
              onCompare();
            }}
            style={[styles.compareButton, compared && styles.compareButtonActive]}
          >
            <Text style={[styles.compareText, compared && styles.compareTextActive]}>
              {compared ? 'Added' : 'Compare'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  unavailableCard: { opacity: 0.7 },
  unavailableOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 164, backgroundColor: 'rgba(15,23,42,0.3)' },
  certificationRibbon: { position: 'absolute', top: 10, right: 10, padding: 8, borderRadius: 12, backgroundColor: AppColors.surface },

  card: {
    overflow: 'hidden',
    borderRadius: BorderRadius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
    backgroundColor: AppColors.surface,
    marginBottom: 14,
  },
  pressed: { opacity: 0.86 },
  image: { width: '100%', height: 164, backgroundColor: AppColors.surfaceElevated },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  placeholderLabel: { color: AppColors.textMuted, fontSize: 12 },
  compactImage: { height: 110 },
  content: { padding: 14, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titleCopy: { flex: 1, minWidth: 0 },
  name: { color: AppColors.text, fontSize: 18, fontWeight: '700' },
  address: { color: AppColors.textSecondary, fontSize: 13, marginTop: 3 },
  scoreBadge: {
    minWidth: 48,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: BorderRadius.md,
    backgroundColor: AppColors.accentMuted,
  },
  score: { color: AppColors.white, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreLabel: { color: '#DBEAFE', fontSize: 8, textTransform: 'uppercase' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' },
  price: { color: AppColors.accent, flexShrink: 1, fontSize: 16, fontWeight: '700' },
  perMonth: { color: AppColors.textMuted, fontSize: 11, fontWeight: '500' },
  rating: { color: AppColors.warning, flexShrink: 1, fontSize: 13, fontWeight: '600' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    color: AppColors.textSecondary,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 10,
    textTransform: 'capitalize',
    overflow: 'hidden',
  },
  newTag: { color: AppColors.warning, borderColor: AppColors.warning },
  compareButton: {
    borderWidth: 1,
    borderColor: AppColors.accent,
    borderRadius: BorderRadius.full,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  compareButtonActive: { backgroundColor: AppColors.accent },
  compareText: { color: AppColors.accent, fontSize: 11, fontWeight: '700' },
  compareTextActive: { color: AppColors.white },
});
