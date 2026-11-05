# Google account registration

Google authenticates the person; RoomScout separately registers their account type and details.

1. New Google users confirm full name, unique username and Student / Renter or Dorm Owner.
2. They review their Google email and may add a contact number. No RoomScout password is requested for Google sign-in.
3. Supabase saves the registration atomically. Renter accounts continue Home; owners continue to the verification screen. Becoming an owner does not automatically verify the account.

`renters` contains a baseline identity for preferences, reviews and rental requests for every account type. That row no longer means Google chose the renter role. `registration_role` and `registration_completed_at` identify the completed registration. Existing manual registrations and owner/admin accounts are preserved. Legacy Google-only renter profiles complete the new form once.

Files:

- `app/(auth)/setup-username.tsx`: the two-step Google completion form, including save/error/retry states.
- `src/lib/account-profile.ts`: OAuth exchange and registration-state lookup; local role hints never grant a role.
- `app/index.tsx`: waits for the saved registration before routing; load errors offer Retry.
- `supabase/migrations/20261105143039_google_registration_completion.sql`: applied on the shared backend, with authenticated completion RPC, validation, uniqueness and private profile policies.

Verification: `npm run test:account-registration` and `supabase/tests/google_registration.sql`. The SQL suite uses rolled-back synthetic fixtures. Local UI testing used an isolated mocked backend and the actual screen components: taken username, role selection, optional empty phone, failed save preserving details, retry and owner-verification handoff. Form dimensions were checked at a 360×800 viewport; screenshot/theme inspection used the browser's default viewport. No real Google consent or installed Android APK was exercised. Creating a persistent remote test credential was blocked by the safety check and was not retried; no remote test login was created.

The UI follows existing `AppColors`/auth branding, with a dark native role picker. Owner verification uses the same theme. Test-only preview files live under ignored `.expo`; they are not part of the APK or GitHub source.
