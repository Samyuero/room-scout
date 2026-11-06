type NotificationLink = { pathname: string; params?: Record<string,string>; label: string };
type NotificationRecord = { type?: string; related_dorm_id?: string; related_request_id?: string; related_ticket_id?: string; related_verification_id?: string; related_certification_id?: string };

/** Explicit, allowlisted destinations only; never navigate to user-supplied paths. */
export function notificationDestination(item: NotificationRecord,isAdmin = false,isRequestOwner = false): NotificationLink | null {
  const type = item.type || '';
  if (item.related_ticket_id) return { pathname: '/support-ticket',params: { ticketId: item.related_ticket_id },label: 'View report and replies' };
  const adminNotice = isAdmin || type.startsWith('admin_');
  if (adminNotice && /owner.*verif|verif.*owner/.test(type)) return { pathname: '/admin',params: { tab: 'verifications',...(item.related_verification_id ? { itemId: item.related_verification_id } : {}) },label: 'Review owner verification' };
  if (adminNotice && /lgu|listing|dorm_submitted/.test(type)) return { pathname: '/admin',params: { tab: 'dorms',...(item.related_dorm_id ? { itemId: item.related_dorm_id } : {}) },label: 'View listing moderation' };
  if (adminNotice && /payment|refund/.test(type)) return { pathname: '/admin',params: { tab: 'payments',...(item.related_request_id ? { itemId: item.related_request_id } : {}) },label: 'View payment history' };
  if (adminNotice && /support/.test(type)) return { pathname: '/admin',params: { tab: 'support' },label: 'View support reports' };
  if (/owner.*verif|verif.*owner/.test(type)) return { pathname: '/(auth)/owner-verification',label: 'View owner verification' };
  if (isRequestOwner && item.related_request_id) return { pathname: '/owner-panel',params: { requestId: item.related_request_id, ...(item.related_dorm_id ? { dormId: item.related_dorm_id } : {}), tab: type === 'reserved' ? 'reservations' : ['completed','refund_completed','rejected','cancelled'].includes(type) ? 'history' : type === 'approved' || type === 'rental_extended' ? 'tenants' : 'requests' },label: 'View owner activity' };
  if (type === 'rental_request' && item.related_dorm_id) return { pathname: '/owner-panel',params: { dormId: item.related_dorm_id,...(item.related_request_id ? { requestId: item.related_request_id } : {}) },label: 'View rental request' };
  if (item.related_request_id && /refund|reserved|completed|cancelled|rental_extended/.test(type)) return { pathname: '/booking-history',params: { requestId: item.related_request_id },label: 'View booking and history' };
  if (item.related_dorm_id) return { pathname: '/(tabs)/[dormId]',params: { dormId: item.related_dorm_id },label: 'View dormitory and request' };
  return null;
}
