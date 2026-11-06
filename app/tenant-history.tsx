import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AppColors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function TenantHistoryScreen() {
  const router = useRouter();
  const { dormId } = useLocalSearchParams<{ dormId?: string }>();
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error: queryError } = await supabase.rpc('get_owner_tenant_history', { p_dorm_id: dormId || null });
      if (queryError) throw queryError;
      setHistory(Array.isArray(data) ? data : []); setError('');
    } catch { setError('Could not refresh tenant history. Tap to retry.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [dormId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
    {error && <Pressable style={styles.error} onPress={() => void load()}><Text style={styles.errorText}>{error}</Text></Pressable>}
    {loading ? <View style={styles.center}><ActivityIndicator color={AppColors.accent} /><Text style={styles.secondary}>Loading past stays…</Text></View> : <FlatList data={history} keyExtractor={(item) => item.rental_id} refreshing={refreshing} onRefresh={() => void load()} contentContainerStyle={styles.list} ListHeaderComponent={<Text style={styles.secondary}>Past tenants and their completed stay dates. Private tenant details are visible only to their dorm owner.</Text>} ListEmptyComponent={<View style={styles.center}><Ionicons name="time-outline" size={36} color={AppColors.textMuted} /><Text style={styles.title}>No past tenants yet</Text><Text style={styles.secondary}>Ended tenancies will be kept here.</Text></View>} renderItem={({ item }) => <View style={styles.card}>
      <Text style={styles.title}>{item.renters?.full_name || item.renter_name || 'Former tenant'}</Text>
      <Text style={styles.secondary}>{item.user_id ? '@' + (item.renters?.username || 'renter') : 'Offline tenant'}</Text>
      <View style={styles.previousStay}>
        <Text style={styles.stayLabel}>Previously rented</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={'Open dormitory: ' + (item.dorms?.name || 'Listing')} onPress={() => router.push({ pathname: '/(tabs)/[dormId]', params: { dormId: item.dorm_id } } as never)} style={({ pressed }) => [styles.dormRow, pressed && styles.pressed]}>
          <Ionicons name="home-outline" size={21} color={AppColors.accent} />
          <View style={styles.dormCopy}><Text style={styles.dormName}>Dormitory: {item.dorms?.name || 'Listing unavailable'}</Text>{item.dorms?.address ? <Text style={styles.secondary}>{item.dorms.address}</Text> : null}</View>
          <Ionicons name="chevron-forward" size={18} color={AppColors.accent} />
        </Pressable>
      </View>
      <Text style={styles.secondary}>Stay: {new Date(item.start_date).toLocaleDateString()} — {item.end_date ? new Date(item.end_date).toLocaleDateString() : 'Ended'}</Text>
      {item.extensions?.map((extension: any) => <Text key={extension.extension_id} style={styles.secondary}>Stay extended to {new Date(extension.new_end_date).toLocaleDateString()} on {new Date(extension.created_at).toLocaleDateString()}</Text>)}
    </View>} />}
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: AppColors.background }, list: { padding: 16, gap: 14, flexGrow: 1 }, card: { borderWidth: 1, borderColor: AppColors.borderSubtle, borderRadius: 14, borderCurve: 'continuous', backgroundColor: AppColors.surface, padding: 16, gap: 8 }, title: { color: AppColors.text, fontSize: 17, fontWeight: '700' }, secondary: { color: AppColors.textSecondary, lineHeight: 21 }, previousStay: { gap: 4, paddingVertical: 8 }, stayLabel: { color: AppColors.textMuted, fontSize: 12, fontWeight: '600' }, dormRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }, dormCopy: { flex: 1, minWidth: 0, gap: 4 }, dormName: { color: AppColors.text, fontWeight: '600', fontSize: 14, lineHeight: 21 }, pressed: { opacity: 0.65 }, center: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 14 }, error: { backgroundColor: AppColors.errorBg, padding: 12, margin: 16, borderRadius: 10 }, errorText: { color: AppColors.error } });
