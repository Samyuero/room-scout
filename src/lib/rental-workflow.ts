export interface RentalRequestState {
  status: string;
  payment_status?: string | null;
  payment_verified_at?: string | null;
}

// Both payment methods allow withdrawal. Verified payments use the refund flow.
export function canCancelRentalRequest(request: RentalRequestState | null | undefined): boolean {
  return !!request && ['pending', 'awaiting_payment', 'awaiting_cash', 'payment_submitted', 'approved', 'reserved'].includes(request.status);
}

export function canRequestBookingRefund(request: RentalRequestState | null | undefined): boolean {
  return !!request && request.payment_status === 'paid' && ['approved', 'reserved', 'cancelled'].includes(request.status);
}

export function bookingStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Waiting for owner', awaiting_payment: 'Ready for QR payment', awaiting_cash: 'Pending cash payment',
    payment_submitted: 'Owner reviewing payment', approved: 'Active tenancy', reserved: 'Confirmed reservation',
    rejected: 'Declined', cancelled: 'Cancelled', refund_requested: 'Refund requested', refund_sent: 'Confirm refund receipt',
    refund_completed: 'Refund completed', completed: 'Stay completed',
  };
  return labels[status] || status.replace(/_/g, ' ');
}

export const rentalCancellationWarning = 'Are you sure you want to cancel this request? This cannot be undone. If you already uploaded a receipt, the owner will still review it. Cancelling does not transfer money or issue an automatic refund. After the owner confirms any payment, you can request a 90% refund here (10% deduction).';
export const bookingRefundWarning = 'Cancel this paid booking and request a 90% refund? A 10% deduction applies to the recorded payment. The owner must send the money to your GCash account and upload proof. Only confirm receipt after the money actually arrives. RoomScout records these steps; it does not transfer money automatically. Your occupied/reserved slot remains held until receipt is confirmed, unless the owner releases it earlier.';
