import { createContext, use, useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getErrorMessage, logEvent } from '@/lib/logger';

interface NotificationValue {
  notifications: any[];
  loading: boolean;
  unreadCount: number;
  pendingRequestCount: number;
  requestUnreadCount: number;
  tenantUnreadCount: number;
  profileBadgeCount: number;
  refreshUnreadCount: () => Promise<void>;
  markAllRead: () => Promise<void>;
}
const NotificationContext = createContext<NotificationValue | null>(null);
let subscriptionSequence = 0;

export function NotificationProvider({ children }: PropsWithChildren) {
  const [userId, setUserId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRequestIds, setPendingRequestIds] = useState<string[]>([]);
  const pendingRequestCount = pendingRequestIds.length;
  const requestVersion = useRef(0);
  const unreadCount = notifications.filter((item) => !item.read).length;

  const refreshUnreadCount = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!userId) { setNotifications([]); setPendingRequestIds([]); setLoading(false); return; }
    const [noticeResult, requestResult] = await Promise.all([
      supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('rental_requests').select('request_id').eq('owner_id', userId).in('status', ['pending', 'awaiting_cash', 'payment_submitted', 'refund_requested']),
    ]);
    if (version !== requestVersion.current) return;
    if (noticeResult.error || requestResult.error) logEvent('warn', 'notification_preload_failed', { message: getErrorMessage(noticeResult.error || requestResult.error) });
    if (!noticeResult.error) setNotifications(noticeResult.data || []);
    if (!requestResult.error) setPendingRequestIds((requestResult.data || []).map((item) => item.request_id));
    setLoading(false);
  }, [userId]);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
    if (error) throw error;
    requestVersion.current += 1;
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
  }, [userId]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setUserId(data.session?.user.id || null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      requestVersion.current += 1;
      setUserId(session?.user.id || null);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    void refreshUnreadCount();
    if (!userId) return;
    const channel = supabase.channel('notification-preload-' + userId + '-' + ++subscriptionSequence)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId }, () => void refreshUnreadCount())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rental_requests', filter: 'owner_id=eq.' + userId }, () => void refreshUnreadCount())
      .subscribe((status) => { if (status === 'SUBSCRIBED') void refreshUnreadCount(); });
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void refreshUnreadCount(); });
    return () => { appState.remove(); void supabase.removeChannel(channel); };
  }, [refreshUnreadCount, userId]);

  const requestUnreadCount = notifications.filter((item) => !item.read && item.related_request_id && !['approved', 'reserved', 'rental_accepted', 'rental_ended', 'cancelled', 'refund_completed'].includes(item.type)).length;
  const tenantUnreadCount = notifications.filter((item) => !item.read && ['approved', 'reserved', 'rental_accepted', 'rental_ended', 'cancelled', 'refund_completed'].includes(item.type)).length;
  const profileBadgeCount = unreadCount;
  return <NotificationContext.Provider value={{ notifications, loading, unreadCount, pendingRequestCount, requestUnreadCount, tenantUnreadCount, profileBadgeCount, refreshUnreadCount, markAllRead }}>{children}</NotificationContext.Provider>;
}
export function useNotifications() {
  const value = use(NotificationContext);
  if (!value) throw new Error('useNotifications must be used inside NotificationProvider');
  return value;
}
