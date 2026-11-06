const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const moduleUnderTest = { exports: {} };
const code = ts.transpileModule(readFileSync('src/lib/rental-workflow.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(code, { exports: moduleUnderTest.exports, module: moduleUnderTest });
const { canCancelRentalRequest, canRequestBookingRefund, bookingStatusLabel, rentalCancellationWarning, bookingRefundWarning } = moduleUnderTest.exports;

test('cash and QR requests can cancel before and after payment confirmation', () => {
  for (const payment_method of ['cash', 'qr']) {
    for (const status of ['pending', 'awaiting_payment', 'awaiting_cash', 'payment_submitted', 'approved', 'reserved']) {
      assert.equal(canCancelRentalRequest({ status, payment_method, payment_status: status === 'approved' || status === 'reserved' ? 'paid' : 'unpaid' }), true);
    }
  }
});

test('closed or refund-in-progress requests cannot be cancelled twice in the UI', () => {
  for (const status of ['cancelled', 'rejected', 'refund_requested', 'refund_sent', 'refund_completed', 'unknown']) {
    assert.equal(canCancelRentalRequest({ status }), false);
  }
  assert.equal(canCancelRentalRequest(null), false);
});

test('withdrawal and paid refund confirmations explain the actual workflow', () => {
  assert.match(rentalCancellationWarning, /Are you sure/);
  assert.match(rentalCancellationWarning, /does not transfer money or issue an automatic refund/);
  assert.match(rentalCancellationWarning, /90% refund/);
  assert.match(bookingRefundWarning, /10% deduction/);
  assert.match(bookingRefundWarning, /Only confirm receipt after the money actually arrives/);
  assert.match(bookingRefundWarning, /slot remains held until receipt is confirmed/);
});

test('only confirmed paid bookings enter the refund flow', () => {
  for (const status of ['approved', 'reserved', 'cancelled']) {
    assert.equal(canRequestBookingRefund({ status, payment_status: 'paid' }), true);
    assert.equal(canRequestBookingRefund({ status, payment_status: 'pending_verification' }), false);
  }
  for (const status of ['pending', 'refund_requested', 'refund_sent', 'refund_completed', 'completed']) {
    assert.equal(canRequestBookingRefund({ status, payment_status: 'paid' }), false);
  }
  assert.equal(canRequestBookingRefund(null), false);
});

test('booking statuses describe the next step in plain language', () => {
  assert.equal(bookingStatusLabel('reserved'), 'Confirmed reservation');
  assert.equal(bookingStatusLabel('payment_submitted'), 'Owner reviewing payment');
  assert.equal(bookingStatusLabel('refund_sent'), 'Confirm refund receipt');
  assert.equal(bookingStatusLabel('completed'), 'Stay completed');
});

test('renter actions use guarded updates and the atomic cancellation RPC', () => {
  const details = readFileSync('app/(tabs)/[dormId].tsx', 'utf8');
  assert.match(details, /Alert\.alert\(\s*'Cancel this request\?',\s*rentalCancellationWarning/);
  assert.match(details, /rpc\('cancel_rental_request'/);
  assert.match(details, /eq\('status', 'awaiting_payment'\)[\s\S]*?select\('request_id'\)\.single\(\)/);
  const owner = readFileSync('app/owner-panel.tsx', 'utf8');
  assert.match(owner, /owner_confirm_qr_payment/);
  assert.match(owner, /convert_reservation_to_rental/);
  assert.match(owner, /owner_submit_refund/);
  const history = readFileSync('app/booking-history.tsx', 'utf8');
  assert.match(history, /get_renter_booking_history/);
  assert.match(history, /request_booking_refund/);
  assert.match(history, /confirm_booking_refund/);
  assert.match(history, /create_support_ticket/);
});
