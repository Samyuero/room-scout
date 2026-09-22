# Room Scout

Room Scout is an Android-first Expo SDK 56 dorm finder for the SNAP team. The app uses Supabase for authentication/data/realtime and Leaflet with OpenStreetMap for its main discovery map. It can run with cached demo/UI states while unfinished, but production transactions require the supplied Supabase migrations and private document storage.

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

## Supabase setup order

For the current storyboard database, run these in the Supabase SQL editor in this exact order:

1. `supabase/schema_v2.sql`
2. `supabase/capstone42_updates.sql`
3. `supabase/security_hardening.sql`

Do not deploy `schema_v2.sql` alone: the last migration removes unsafe self-admin policies, restricts private profiles and system logs, validates state transitions, protects listing approval fields, creates storage limits, and provides atomic payment verification.

In Supabase Authentication, enable email confirmation. For Google sign-in, configure the Google provider and allow `roomscout://auth/callback` in redirect URLs. Put privileged AI/payment operations in a Supabase Edge Function; never ship provider secrets in `EXPO_PUBLIC_*` variables.

## APK

`eas.json` contains Android profiles. A preview APK can be built with:

```powershell
npm install --global eas-cli
eas login
eas build --platform android --profile preview
```

For a fully local native build, install the Android SDK/JDK and run `npx expo run:android`. Test Google OAuth using a development build or APK, not only Expo Go.

## AI assistant path

`src/lib/dorm-assistant.ts` is a privacy-safe, deterministic local assistant today. It accepts natural-language budget/radius/features and ranks public listings, so the app remains usable with no AI bill. Later, call a server-side Edge Function with `DORM_ASSISTANT_SYSTEM_PROMPT` and `getAssistantListingContext`, rate-limit requests, and validate the returned dorm IDs. Never send government IDs, payment proofs, emails, OTPs, reviewer identities, search history, or other users' preferences to a model.

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
