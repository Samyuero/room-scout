export interface RentalRequestState {
  status: string;
  payment_status?: string | null;
  payment_verified_at?: string | null;
}

// Payment method does not affect the renter's right to withdraw a request.
export function canCancelRentalRequest(request: RentalRequestState | null | undefined): boolean {
  return !!request && ['pending', 'awaiting_payment', 'awaiting_cash', 'payment_submitted', 'approved', 'reserved'].includes(request.status);
}

export const rentalCancellationWarning = 'Are you sure you want to cancel? This cannot be undone, and any confirmed tenant slot will be released. RoomScout does not send or refund money. If you have already paid, the payment stays with the owner unless you arrange a return directly with them outside RoomScout.';
