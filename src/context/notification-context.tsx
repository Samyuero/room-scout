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
  ownerRequestIds: string[];
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
  const [ownerRequestIds, setOwnerRequestIds] = useState<string[]>([]);
  const pendingRequestCount = pendingRequestIds.length;
  const requestVersion = useRef(0);
  const currentUserId = useRef<string | null>(null);
  const unreadCount = notifications.filter((item) => !item.read).length;

  const refreshUnreadCount = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!userId) { setNotifications([]); setPendingRequestIds([]); setOwnerRequestIds([]); setLoading(false); return; }
    const [noticeResult, requestResult] = await Promise.all([
      supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('rental_requests').select('request_id,status').eq('owner_id', userId),
    ]);
    if (version !== requestVersion.current) return;
    if (noticeResult.error || requestResult.error) logEvent('warn', 'notification_preload_failed', { message: getErrorMessage(noticeResult.error || requestResult.error) });
    if (!noticeResult.error) setNotifications(noticeResult.data || []);
    if (!requestResult.error) {
      setOwnerRequestIds((requestResult.data || []).map((item) => item.request_id));
      setPendingRequestIds((requestResult.data || []).filter((item) => ['pending','awaiting_cash','payment_submitted','refund_requested'].includes(item.status)).map((item) => item.request_id));
    }
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
    const setIdentity = (nextId: string | null) => {
      if (currentUserId.current !== nextId) {
        setNotifications([]); setPendingRequestIds([]); setOwnerRequestIds([]); setLoading(Boolean(nextId));
        currentUserId.current = nextId;
      }
      setUserId(nextId);
    };
    supabase.auth.getSession().then(({ data }) => { if (active) setIdentity(data.session?.user.id || null); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      requestVersion.current += 1;
      const nextId = session?.user.id || null;
      setIdentity(nextId);
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
  return <NotificationContext.Provider value={{ notifications, loading, unreadCount, pendingRequestCount, requestUnreadCount, tenantUnreadCount, profileBadgeCount, ownerRequestIds, refreshUnreadCount, markAllRead }}>{children}</NotificationContext.Provider>;
}
export function useNotifications() {
  const value = use(NotificationContext);
  if (!value) throw new Error('useNotifications must be used inside NotificationProvider');
  return value;
}
