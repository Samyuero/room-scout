# Room Scout

Room Scout is an Android-first Expo SDK 57 dorm finder for the SNAP team. The app uses Supabase for authentication/data/realtime and Leaflet with OpenStreetMap for its main discovery map. It can run with cached demo/UI states while unfinished, but production transactions require the supplied Supabase migrations and private document storage.

## Included now

- GPS-ranked nearby listings, explicit scoring, radius and detailed filters
- Home, Search, Leaflet Map/price analytics, Compare, Profile, About SNAP, notifications and local dorm-assistant UI
- Cache-first dorm loading, preloading, realtime refresh and optimistic comparison
- Reviews with photos, ratings, and a verified-renter badge while exposing only a limited public reviewer display
- Owner listing proof and admin approval UI
- Rental/reservation request, owner acceptance/QR, payment proof and admin verification states
- Structured JSON logs and database-generated notification/audit paths

## Local setup

Requirements: Node.js 22.13+, npm, Android Studio/device tooling, a Supabase project, and Java 17 for native Android builds.

```powershell
npm install
Copy-Item .env.example .env
npm start -- --localhost
```

For a physical Android phone, `--lan` is normally easier because `localhost` on the phone means the phone itself:

```powershell
npm start -- --lan
```

All maps, including the owner location picker, use Leaflet with OpenStreetMap tiles and need internet access for tiles.

## Environment

Fill `.env` locally. Never commit it.

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
# Legacy projects may use EXPO_PUBLIC_SUPABASE_ANON_KEY instead.
```

`.env`, keystores and APK files are ignored by Git. Public/publishable Supabase keys are safe in an app only when Row Level Security remains enabled; service-role keys must never be placed in Expo code.

Do not add `GEMINI_API_KEY` to the Expo `.env`, even under a name without
`EXPO_PUBLIC_`. A mobile application cannot keep a provider secret: if the app
uses the key directly, it must ship enough information for an attacker to
recover and misuse it. RoomScout calls the authenticated `dorm-assistant`
Supabase Edge Function instead, and that server reads `GEMINI_API_KEY` from the
Supabase project's Edge Function secrets.

## Teammate and GitHub setup

Commit the example files and setup instructions, never the real credentials:

1. Clone the repository and copy `.env.example` to `.env`.
2. Ask a Supabase project administrator for the project URL and publishable key,
   or retrieve them after being invited to the Supabase project. These two
   values are intended for the Expo client and are still protected by RLS.
3. Run `npm install`, then `npm run verify-setup`.
4. The shared deployed app does not need a Gemini key on each teammate's
   computer. It calls the already configured Supabase Edge Function.
5. A teammate developing the Edge Function locally may copy
   `supabase/functions/.env.example` to `supabase/functions/.env` and obtain a
   development key through a private password manager or create their own key.
   The local file is ignored by Git.

Authorized Supabase maintainers can update the production key without exposing
it to GitHub:

```powershell
supabase secrets set GEMINI_API_KEY=your_key --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_MODEL=gemini-3.5-flash-lite --project-ref YOUR_PROJECT_REF
```

GitHub collaborators need repository access for code and an explicit Supabase
project invitation for backend administration. GitHub access alone must not
grant access to production secrets.

## Supabase setup order

For the current storyboard database, run these in the Supabase SQL editor in this exact order:

1. `supabase/schema_v2.sql`
2. `supabase/capstone42_updates.sql`
3. `supabase/security_hardening.sql`
4. Apply every file in `supabase/migrations` in filename order. For a linked project, use `supabase db push` only after confirming its migration history matches your target project. Do not re-run the base schema over the shared RoomScout project.

The `20261103181120_signup_identity_and_self_rental_guards.sql` migration is applied to the shared backend. Its signup, phone, uniqueness and self-rental tests passed using rolled-back fixtures. Its public username check returns only a boolean, not user profiles.

Do not deploy `schema_v2.sql` alone: the last migration removes unsafe self-admin policies, restricts private profiles and system logs, validates state transitions, protects listing approval fields, creates storage limits, and provides atomic payment verification.

In Supabase Authentication, enable email confirmation. For Google sign-in, configure the Google provider and allow the native `roomscout://google-auth` redirect and your web `/auth/callback` URL. Put privileged AI/payment operations in a Supabase Edge Function; never ship provider secrets in `EXPO_PUBLIC_*` variables.

## APK

`eas.json` contains Android profiles. A preview APK can be built with:

```powershell
npm install --global eas-cli
eas login
npm run verify-build
npm run test:build-config
npm run verify-survey
eas build --platform android --profile preview --clear-cache
```

The preview profile explicitly uses the EAS `preview` environment. The shared Expo project now has `EXPO_PUBLIC_SUPABASE_URL` and the public anon key there; `.env` itself is not uploaded. Gemini stays only in Supabase Edge Function secrets. The `eas-build-pre-install` check refuses missing, placeholder, wrong-project, expired or privileged server-key settings before native compilation. The root layout also stops unconfigured builds without making auth/data/storage/function requests.

Changing local `.env` cannot repair an already installed APK: the values are compiled into the JavaScript bundle. Rebuild and install the new APK. Preview Android version codes increment automatically. Localhost/Metro is not needed on a tester's phone, but Supabase and OpenStreetMap still require internet access.

Before a survey, test on a physical Android phone: email verification/sign-in, Google return-to-app, GPS permission denied/granted, multiple photos, rental/reservation submission, owner acceptance and notification badges. A successful bundle export or backend check is not a substitute for these device checks.

For a fully local native build, install the Android SDK/JDK and run `npx expo run:android`. Test Google OAuth using a development build or APK, not only Expo Go.

## AI assistant path

`supabase/functions/dorm-assistant/index.ts` is the authenticated Gemini gateway. It sends only approved public listing fields, the signed-in renter's own preferences, and a redacted current message. `src/lib/dorm-assistant.ts` remains the deterministic local fallback, so dorm recommendations still work if the free Gemini quota is unavailable. Never send government IDs, payment proofs, emails, OTPs, reviewer identities, search history, or other users' preferences to a model.

The gateway also enforces a server-side quota per signed-in account: 8 AI requests per 10 minutes and 40 per UTC day. Invalid requests and local fallback recommendations do not consume Gemini quota. Apply the latest migration in `supabase/migrations` before deploying the function.

## Main file map

- `app/(tabs)/home.tsx`, `search.tsx`, `map.tsx`, `compare.tsx` — renter discovery UI
- `src/context/discovery-context.tsx` — cache, preload, realtime and shared comparison/filter state
- `src/lib/dorm-discovery.ts` — filters, distance and explainable ranking
- `src/components/leaflet-map-view.tsx` — hardened Leaflet WebView
- `app/owner-panel.tsx`, `app/admin.tsx`, `app/(tabs)/[dormId].tsx` — transaction actors
- `supabase/security_hardening.sql` — production-facing RLS and workflow enforcement

## Checks

```powershell
npx tsc --noEmit
npm run lint
npx expo config --type public
git diff --check
```

Before real users, run the migrations in a staging project, test every RLS and private-storage policy with renter/owner/admin accounts, test the full capacity and refund workflows concurrently, and complete a legal/privacy review of the contract and refund wording.

## Requests, notifications, and cash payments

Home uses the Search tab for searching. Dorm details separate price/rating, reservation fee, room type and remaining slots from house features. Tap listing or review photos to open the image viewer; swipe between photos and use the dots to see your position.

A renter chooses rental/reservation and QR/cash in the fixed-height request form, previews their government ID, and can send a message. Cash and QR requests can be cancelled while pending, accepted, awaiting payment, under receipt review, or after payment confirmation. The confirmation explains that RoomScout does not send/refund money: any payment remains with the owner unless renter and owner arrange a return directly outside this app. Cancelling a confirmed stay releases its tenant slot and ends its active tenancy; cancelling an unpaid request does not change capacity.

The shared backend has `20261103184351_unpaid_request_cancellation.sql` and `20261103184938_rental_capacity_guards.sql` applied. Cancellation locks the request, preserves receipts/payment history, notifies both participants, and safely tolerates retries. A receipt submitted before cancellation remains in the admin payment queue. Its review cannot reopen the cancelled request or allocate a slot. Unique indexes stop duplicate open requests and duplicate active tenancies for the same renter/dorm. Owners can see cancelled requests in their request history. Existing reservation-refund RPCs remain for legacy records, but the current cancellation action does not initiate an in-app refund.

`npm run test:rental-workflow` checks the UI eligibility and confirmation wiring. `supabase/tests/rental_workflow.sql` exercises cash/QR rental/reservation transitions, paid and unpaid cancellations, receipt review after withdrawal, capacity protection, retry safety and authenticated RLS/tampering checks. It uses synthetic fixtures inside a rolled-back transaction; it does not transfer money or leave test accounts/listings behind. These checks do not replace a physical Android APK walkthrough.

For QR payment, the owner sends the required amount, QR image and contract. The renter reviews the contract and uploads proof of payment; admin verification confirms the transaction and updates capacity. For cash in person, owner acceptance creates a **Pending cash payment** request. After receiving the cash, the owner confirms receipt; an atomic database function updates capacity and adds a rental to Tenants. A reservation instead records the reserved slot.

Owner requests start as compact, expandable rows. Expanding a request loads its protected ID and payment-proof previews. Tap a preview for a clearer protected view.

The root NotificationProvider preloads notifications and owner action counts after sign-in and updates the Profile badge through Realtime. The owner panel preloads requests and active tenants together, supports filtering from a dorm detail page, and uses atomic RPCs to add offline tenants or end a rental.

Existing databases need all current `supabase/migrations` files, including the November 2 profile-integrity and cash-workflow updates. These also repair missing renter identities for owner/admin accounts, retain cancelled request history, and add optional phone numbers to renter, owner and admin profiles.

Government IDs are opened in the owner-only `app/view-id.tsx` screen. It enables Android screenshot/recording protection before loading a short-lived private image, disables image caching, and provides no export action. Rebuild the APK after installing `expo-screen-capture`; older installed builds show an update message for protected viewing. External cameras and compromised devices cannot be prevented from copying displayed information.

The SNAP greeting appears once for five seconds and stays dismissed on later Home visits. Home includes unavailable listings with a dimmed appearance. Profile indicators follow unread notifications and clear when notifications are read.

Owners can edit their own listing from the Edit icon above its map. Existing photos and ownership proof are retained unless replaced. LGU certification requires a certificate upload and a separate admin decision in Manage Dorms; owners cannot enable the public certification flag themselves.

Apply the LGU review and storage-policy cleanup migrations in `supabase/migrations` for new environments. The shared backend has already received them. The storage cleanup removes older broad policies that would otherwise override private-document access restrictions.
## Current discovery and account behavior

Google sign-up now opens the same two-stage identity flow: confirm full name, unique username and Student / Renter or Dorm Owner, then review the Google email and add a contact number if wanted. Google manages the password, so this flow does not ask for another password. The setup and owner-verification screens use the shared RoomScout dark theme.

The shared backend has `20261105143039_google_registration_completion.sql` applied. A baseline `renters` row is used for preferences/reviews by every account; it no longer means Google users have chosen the renter role. `registration_role` and `registration_completed_at` record the explicit completed registration. New Google users (and legacy Google-only renter profiles) complete this once. Existing manual, owner and admin registrations are preserved. Owners still require separate verification; no client can register itself as admin.

Run `npm run test:account-registration` and `npm run check-secrets` before sharing changes. The database assertions in `supabase/tests/google_registration.sql` roll back their synthetic fixtures. Teammates pull the source and use their own ignored `.env`; Gemini secrets remain only on the deployed Supabase function. Do not commit local credentials, APKs, or generated `.expo` previews.

- Sign-in and sign-up share the dark theme, large RoomScout logo and centered Google actions. The opening/loading screen carries the By SNAP credit; the auth forms do not. Google avatars populate missing profile photos without replacing a custom photo.
- Sign-up has two steps: name/unique username/account type, then email/optional phone/password confirmation. Profile contact numbers prefill empty listing contact fields; listing phones are optional. Own-listing rental controls are derived from the current signed-in user, and the signup migration adds a database self-rental constraint.
- Profile preferences include a custom positive search radius, budget/location, amenities, utilities, house rules, gender policy, room type, curfew, parking, pets, furnishing and LGU certification. Each preference is optional and is stored in the signed-in account's `renters.behavior_preferences` JSON. This baseline identity also exists for owner/admin accounts; it does not change their role.
- Choosing a preference-map pin saves coordinates directly. A reverse-geocoding service is not required; the area label can be edited.
- Search ranks matching listings first and recommends remaining listings afterward rather than hiding every listing when preferences do not match.
- Demand estimates use a frozen listing snapshot for each activation and a 10-minute in-memory cache keyed by listing capacity/availability facts. Realtime listing updates do not rerun an active prediction. High, moderate and steady use red, yellow and green consistently. Estimates are guidance, not guaranteed occupancy forecasts.
