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
const { canCancelRentalRequest, rentalCancellationWarning } = moduleUnderTest.exports;

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

test('confirmation explains that cancellation does not refund any money', () => {
  assert.match(rentalCancellationWarning, /Are you sure/);
  assert.match(rentalCancellationWarning, /does not send or refund money/);
  assert.match(rentalCancellationWarning, /payment stays with the owner/);
  assert.match(rentalCancellationWarning, /outside RoomScout/);
});

test('renter actions use guarded updates and the atomic cancellation RPC', () => {
  const details = readFileSync('app/(tabs)/[dormId].tsx', 'utf8');
  assert.match(details, /Alert\.alert\(\s*'Cancel this request\?',\s*rentalCancellationWarning/);
  assert.match(details, /rpc\('cancel_rental_request'/);
  assert.match(details, /eq\('status', 'awaiting_payment'\)[\s\S]*?select\('request_id'\)\.single\(\)/);
  const admin = readFileSync('app/admin.tsx', 'utf8');
  assert.match(admin, /in\('status', \['payment_submitted', 'cancelled'\]\)/);
  assert.match(admin, /Verify receipt only/);
});
