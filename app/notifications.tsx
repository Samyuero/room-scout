import { useState,useCallback } from 'react';
import { View,Text,StyleSheet,FlatList,ActivityIndicator,Pressable,RefreshControl } from 'react-native';
import { Stack,useFocusEffect,useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { AppColors,BorderRadius,Spacing } from '@/constants/theme';
import { useNotifications } from '@/context/notification-context';
import { notificationDestination } from '@/lib/notification-routing';
import { supabase } from '@/lib/supabase';

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { notifications,loading,unreadCount,refreshUnreadCount,markAllRead,ownerRequestIds } = useNotifications();
  const [refreshing,setRefreshing] = useState(false);
  const [isAdmin,setIsAdmin] = useState(false);
  const [error,setError] = useState('');
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await refreshUnreadCount(); await markAllRead(); setError(''); }
    catch { setError('Notifications could not be refreshed. Pull down to retry.'); }
    finally { setRefreshing(false); }
  },[refreshUnreadCount,markAllRead]);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (unreadCount > 0) void markAllRead().catch(() => { if (active) setError('Could not mark notifications as read. Pull down to retry.'); });
    if (user) void supabase.from('admins').select('admin_id').eq('admin_id',user.id).maybeSingle().then(({ data }) => { if (active) setIsAdmin(!!data); });
    return () => { active = false; };
  },[markAllRead,unreadCount,user]));
  return <View style={[styles.screen,{ paddingBottom: insets.bottom }]}><Stack.Screen options={{ headerShown: true,title: 'Notifications',headerStyle: { backgroundColor: AppColors.background },headerTintColor: AppColors.text }} />{loading && notifications.length === 0 ? <View style={styles.empty}><ActivityIndicator color={AppColors.accent} /></View> : !user ? <View style={styles.empty}><Text style={styles.secondary}>Sign in to view your notifications.</Text></View> : <FlatList data={notifications} keyExtractor={(item) => item.notification_id} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={AppColors.accent} />} ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null} renderItem={({ item }) => {
    const destination = notificationDestination(item,isAdmin,ownerRequestIds.includes(item.related_request_id));
    return <Pressable disabled={!destination} onPress={() => { if (destination) router.push({ pathname: destination.pathname,params: destination.params } as never); }} style={({ pressed }) => [styles.row,!item.read && styles.unread,pressed && styles.pressed]}><View style={styles.rowHeader}><Ionicons name={item.related_ticket_id ? 'chatbubble-outline' : /payment|refund/.test(item.type) ? 'receipt-outline' : /verif|lgu/.test(item.type) ? 'shield-checkmark-outline' : 'notifications-outline'} size={22} color={AppColors.accent} /><Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text></View><Text style={styles.title}>{item.title}</Text><Text style={styles.secondary}>{item.message}</Text>{destination && <Text style={styles.link}>{destination.label} →</Text>}</Pressable>;
  }} ListEmptyComponent={<View style={styles.empty}><Ionicons name="notifications-off-outline" size={36} color={AppColors.textMuted} /><Text style={styles.title}>You’re all caught up</Text><Text style={styles.secondary}>New updates will appear here.</Text></View>} />}</View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1,backgroundColor: AppColors.background },list: { flexGrow: 1,padding: Spacing.three,paddingBottom: Spacing.four },row: { padding: Spacing.three,gap: Spacing.two,marginBottom: Spacing.two,borderRadius: BorderRadius.md,borderCurve: 'continuous',backgroundColor: AppColors.surface },rowHeader: { flexDirection: 'row',alignItems: 'center',justifyContent: 'space-between',gap: Spacing.two,flexWrap: 'wrap' },unread: { backgroundColor: AppColors.surfaceElevated },time: { color: AppColors.textMuted,fontSize: 12 },title: { color: AppColors.text,fontWeight: '600',fontSize: 16 },secondary: { color: AppColors.textSecondary,fontSize: 14,lineHeight: 21 },link: { color: AppColors.accent,fontSize: 13,fontWeight: '600' },empty: { flex: 1,justifyContent: 'center',alignItems: 'center',padding: Spacing.four,gap: Spacing.three },error: { color: AppColors.error,paddingBottom: Spacing.three,lineHeight: 20 },pressed: { opacity: 0.65 },
});
