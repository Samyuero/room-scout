import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppColors, BorderRadius } from '@/constants/theme';
import { formatPeso } from '@/lib/dorm-discovery';
import type { Dorm } from '@/types/dorm';

interface Props {
  dorm: Dorm;
  onPress: () => void;
  compared: boolean;
  onCompare: () => void;
  compact?: boolean;
}

export function DormResultCard({ dorm, onPress, compared, onCompare, compact = false }: Props) {
  const availability = dorm.availability_status || (dorm.available ? 'available' : 'unavailable');
  const statusColor =
    availability === 'available'
      ? AppColors.success
      : availability === 'reserved'
        ? AppColors.warning
        : AppColors.error;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${dorm.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Image
        source={dorm.images[0] ? { uri: dorm.images[0] } : require('../../assets/placeholder.jpg')}
        style={[styles.image, compact && styles.compactImage]}
        contentFit="cover"
        transition={180}
      />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={styles.name} numberOfLines={1}>{dorm.name}</Text>
            <Text style={styles.address} numberOfLines={1}>{dorm.address}</Text>
          </View>
          <View style={styles.scoreBadge}>
            <Text style={styles.score}>{dorm.ranking_score}</Text>
            <Text style={styles.scoreLabel}>match</Text>
          </View>
        </View>

        <View style={styles.metrics}>
          <Text style={styles.price}>{formatPeso(dorm.price)}<Text style={styles.perMonth}> / month</Text></Text>
          <Text style={styles.rating}>
            ★ {dorm.rating_average || 'New'} {dorm.rating_count > 0 ? `(${dorm.rating_count})` : ''}
          </Text>
        </View>

        <View style={styles.footer}>
          <View style={styles.tags}>
            <Text style={[styles.tag, { color: statusColor, borderColor: statusColor }]}>
              {dorm.available && dorm.available_slots > 0 ? `${dorm.available_slots} left` : 'Unavailable'}
            </Text>
            {dorm.distance_km !== null && <Text style={styles.tag}>{dorm.distance_km} km</Text>}
            {dorm.lgu_certified && <Text style={styles.tag}>LGU</Text>}
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
  compactImage: { height: 110 },
  content: { padding: 14, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  titleCopy: { flex: 1 },
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
  scoreLabel: { color: '#DBEAFE', fontSize: 9, textTransform: 'uppercase' },
  metrics: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  price: { color: AppColors.accent, fontSize: 16, fontWeight: '700' },
  perMonth: { color: AppColors.textMuted, fontSize: 11, fontWeight: '500' },
  rating: { color: AppColors.warning, fontSize: 13, fontWeight: '600' },
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
