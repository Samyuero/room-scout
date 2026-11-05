# Rental flow verification — preview survey build

## Current cancellation rule

Cash and QR rental/reservation requests can be cancelled before or after payment confirmation. The confirmation must be accepted first. RoomScout does not transfer or refund money. Payments stay with the owner unless the renter arranges a return directly outside the app. Cancellation is not a payment reversal.

- Pending/accepted/unverified requests do not consume a tenant slot, so cancelling them never frees someone else's slot.
- Cancelling a confirmed rental ends its active tenancy and releases one slot. Cancelling a confirmed reservation releases its reserved slot without ending a separate rental.
- Payment amounts, receipts and verification history are retained. Submitted receipts can still be reviewed by the admin after cancellation; review never reopens a cancelled request or allocates a bed.
- Both participants receive database notifications. Owners retain cancelled requests in their request history.
- Repeating a successful cancellation is harmless. Other accounts cannot cancel or read the renter's request.

## Verified against the shared Supabase backend

Applied migrations:

- `20261103184351_unpaid_request_cancellation.sql`
- `20261103184938_rental_capacity_guards.sql`

The rolled-back suite in `supabase/tests/rental_workflow.sql` covers:

- Cash and QR, rental and reservation: submission, acceptance, payment confirmation and cancellation.
- Cancellation before acceptance, while awaiting payment, during receipt verification and after confirmation.
- Owner decline and renter re-request; rejected QR proof and corrected re-submission.
- Receipt verification/rejection after withdrawal, without creating a tenancy.
- Last-slot allocation, full-capacity rejection, duplicate open requests/active tenancies and repeated actions.
- Owner-ended rental followed by cancellation, without freeing a slot twice.
- Authenticated-role RLS, cross-account denial, forged payment status and late updates to cancelled requests.

Synthetic accounts, listings, receipts and notifications are rolled back. No real payment is transferred. These are database workflow tests, not an integration with GCash or another payment processor.

Local checks: `npm run test:build-config`, `npm run test:rental-workflow`, TypeScript, ESLint and `git diff --check`. The Android release bundle and online backend preflight are also checked with EAS **preview** variables and local dotenv loading disabled.

## Still required on the newly built APK

No physical Android APK or real payment was exercised in this verification. Before surveying, use separate renter/owner/admin accounts and sample receipt images:

1. Cash: request → owner accepts → renter cancels. The owner must no longer be able to confirm it.
2. Cash: request → accept → owner confirms receipt → renter cancels. Tenant disappears and exactly one slot returns.
3. QR: accept with contract/QR → upload sample receipt → cancel → admin reviews. Request stays cancelled.
4. QR: admin confirms → renter cancels. Receipt/payment history stays; no automatic refund occurs.
5. Repeat with a reservation, check unread notifications on both phones, and verify retry after a network interruption.

Database row locks protect confirmation/cancellation races, but simultaneous two-device stress testing remains part of the physical-device checklist.

## Existing security advisories

The authenticated cancellation RPC is intentionally callable by signed-in clients and validates `auth.uid()` itself; anonymous execution is revoked. Supabase flags authenticated SECURITY DEFINER functions for review ([advisory guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)). Existing public review/username-check functions and the server-only AI rate-limit table retain their intentional access restrictions.

Supabase's [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is still disabled in the existing Auth configuration. This work is not a production security certification or a guarantee that every unrelated app feature is bug-free.
