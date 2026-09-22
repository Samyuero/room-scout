import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppColors, BorderRadius } from '@/constants/theme';
import type { DormFilters } from '@/types/dorm';

interface Props {
  visible: boolean;
  filters: DormFilters;
  onApply: (filters: DormFilters) => void;
  onClose: () => void;
}

const GROUPS = {
  amenities: ['Wi-Fi', 'Air Conditioning', 'Laundry', 'Kitchen', 'Study Area', 'Furnished', 'Security'],
  utilities: ['Water', 'Electricity', 'Internet', 'Generator'],
  parking: ['Motorcycle', 'Car', 'Bicycle'],
};
const ROOM_TYPES = ['Bed space', 'Shared room', 'Private room', 'Studio', 'Apartment'];

function toggleItem(items: string[], item: string) {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function FilterSheet({ visible, filters, onApply, onClose }: Props) {
  const [draft, setDraft] = useState(filters);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} onShow={() => setDraft(filters)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Search filters</Text>
              <Text style={styles.subtitle}>Only public listing details are used.</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>Monthly budget</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                placeholder="Minimum"
                placeholderTextColor={AppColors.textMuted}
                value={draft.minPrice === null ? '' : String(draft.minPrice)}
                onChangeText={(value) => setDraft({ ...draft, minPrice: value ? Number(value) : null })}
              />
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                placeholder="Maximum"
                placeholderTextColor={AppColors.textMuted}
                value={draft.maxPrice === null ? '' : String(draft.maxPrice)}
                onChangeText={(value) => setDraft({ ...draft, maxPrice: value ? Number(value) : null })}
              />
            </View>

            <Text style={styles.label}>Within {draft.radiusKm} km</Text>
            <View style={styles.chips}>
              {[1, 3, 5, 10, 20].map((radius) => (
                <Chip key={radius} label={`${radius} km`} selected={draft.radiusKm === radius} onPress={() => setDraft({ ...draft, radiusKm: radius })} />
              ))}
            </View>

            <Text style={styles.label}>Gender policy</Text>
            <View style={styles.chips}>
              {[
                ['Any', ''],
                ['Male', 'male'],
                ['Female', 'female'],
                ['Co-ed', 'co-ed'],
              ].map(([label, value]) => (
                <Chip key={label} label={label} selected={draft.genderPolicy === value} onPress={() => setDraft({ ...draft, genderPolicy: value })} />
              ))}
            </View>

            <Text style={styles.label}>Policies</Text>
            <View style={styles.chips}>
              <Chip label="Available now" selected={draft.onlyAvailable} onPress={() => setDraft({ ...draft, onlyAvailable: !draft.onlyAvailable })} />
              <Chip label="LGU certified" selected={draft.lguCertified} onPress={() => setDraft({ ...draft, lguCertified: !draft.lguCertified })} />
              <Chip label="Pet friendly" selected={draft.petFriendly} onPress={() => setDraft({ ...draft, petFriendly: !draft.petFriendly })} />
              <Chip label="Parking" selected={draft.parkingRequired} onPress={() => setDraft({ ...draft, parkingRequired: !draft.parkingRequired })} />
            </View>

            <Text style={styles.label}>Curfew</Text>
            <View style={styles.chips}>
              {[['Any', ''], ['Has curfew', 'with-curfew'], ['No curfew', 'no-curfew']].map(([label, value]) => (
                <Chip key={label} label={label} selected={draft.curfewPolicy === value} onPress={() => setDraft({ ...draft, curfewPolicy: value as typeof draft.curfewPolicy })} />
              ))}
            </View>

            <Text style={styles.label}>Room type</Text>
            <View style={styles.chips}>
              {ROOM_TYPES.map((item) => <Chip key={item} label={item} selected={draft.roomTypes.includes(item)} onPress={() => setDraft({ ...draft, roomTypes: toggleItem(draft.roomTypes, item) })} />)}
            </View>

            {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((group) => (
              <View key={group}>
                <Text style={styles.label}>{group[0].toUpperCase() + group.slice(1)}</Text>
                <View style={styles.chips}>
                  {GROUPS[group].map((item) => (
                    <Chip
                      key={item}
                      label={item}
                      selected={draft[group].includes(item)}
                      onPress={() => setDraft({ ...draft, [group]: toggleItem(draft[group], item) })}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              style={styles.resetButton}
              onPress={() => setDraft({ ...filters, minPrice: null, maxPrice: null, genderPolicy: '', amenities: [], utilities: [], parking: [], parkingRequired: false, roomTypes: [], curfewPolicy: '', lguCertified: false, petFriendly: false, onlyAvailable: true })}
            >
              <Text style={styles.resetText}>Clear</Text>
            </Pressable>
            <Pressable style={styles.applyButton} onPress={() => onApply(draft)}>
              <Text style={styles.applyText}>Show matches</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    backgroundColor: AppColors.surface,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: AppColors.borderSubtle },
  title: { color: AppColors.text, fontSize: 22, fontWeight: '800' },
  subtitle: { color: AppColors.textMuted, fontSize: 12, marginTop: 3 },
  closeButton: { padding: 8 },
  closeText: { color: AppColors.accent, fontWeight: '700' },
  content: { padding: 20, gap: 10, paddingBottom: 28 },
  label: { color: AppColors.text, fontSize: 14, fontWeight: '700', marginTop: 8 },
  inputRow: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, color: AppColors.text, backgroundColor: AppColors.input, borderWidth: 1, borderColor: AppColors.inputBorder, borderRadius: BorderRadius.md, padding: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { borderWidth: 1, borderColor: AppColors.border, borderRadius: BorderRadius.full, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: AppColors.surfaceElevated },
  chipSelected: { borderColor: AppColors.accent, backgroundColor: AppColors.accentMuted },
  chipText: { color: AppColors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: AppColors.white },
  actions: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: AppColors.borderSubtle },
  resetButton: { paddingHorizontal: 22, paddingVertical: 14, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: AppColors.border },
  resetText: { color: AppColors.textSecondary, fontWeight: '700' },
  applyButton: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: BorderRadius.md, backgroundColor: AppColors.accent },
  applyText: { color: AppColors.white, fontWeight: '800' },
});
