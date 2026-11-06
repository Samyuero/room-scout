# November 7 — search, demand areas and SNAP notices

## What changed

- Maps no longer displays the “Browse without a location” control. Clear location appears only when there is an origin; the school picker offers it only after a campus is selected. Reset map remains available.
- Demand mode adds circular 400 m area averages. Each circle averages completed forecasts for dorms actually inside its radius, with Low=1, Moderate=2 and High=3. Tap a circle for its index and sample count. These are estimates, not occupancy percentages.
- The demand card separately shows the selected campus/device/default radius average (or viewport average without an origin) and the average across all displayed pins. Outside pins remain available unless an explicit strict search excludes them. Opening analytics frames pins below the control panel without reloading map tiles.
- Search matches word beginnings, not arbitrary substrings. For example, “Le” matches “Lebron” but not the middle of “Electricity” on an unrelated listing. Submitted matches and search-sheet suggestions share the same function.
- Tapping a dorm suggestion closes search and opens that exact dorm ID, without requiring a second search submission. Result-list taps work while the keyboard is open.
- Before searching, Search and the search sheet show at most two available dorms in the displayed Match Score order. Initial recommendations do not spend an online model request. Without saved preferences, existing listing/rating ranking remains the fallback.
- Recommended for you is omitted entirely when there are no alternatives. Unavailable, reserved and full properties remain excluded from suggestions/recommendations.
- Real rate-limit responses show a warning at the application's safe-area-aware top edge. It starts fading after three seconds. Chat, comparison, recommendation ranking and demand use the same notice; local fallbacks remain usable.
- User-facing analysis, responses and prediction reasons use SNAP branding, not the model vendor's name. Internal source/type names and server configuration still identify the actual provider for maintainability.

The API tells the app when a request/project/provider limit is reached; it does not expose a reliable “almost exhausted” percentage. Ordinary network failures do not falsely report an exhausted quota. The warning is not a claim that every 429 means the daily free allocation is permanently exhausted.

## Main files

- `app/(tabs)/map.tsx`, `src/lib/map-analytics.ts`, `src/components/leaflet-map-view.tsx`, `src/components/school-picker.tsx`
- `app/(tabs)/search.tsx`, `src/components/discovery-search.tsx`, `src/lib/dorm-discovery.ts`
- `src/components/error-toast.tsx`, `src/components/error-notice.tsx`, `src/lib/gemini-assistant.ts`, `app/chat.tsx`, `app/(tabs)/compare.tsx`

## Verification

All 72 `scripts/test-*.js` checks, TypeScript, Expo lint, secret scanning and diff whitespace checks pass. Android Hermes export using the existing EAS preview environment passes. No APK build, new SQL migration, Edge Function deployment or GitHub push is required/performed for this client-side batch.

Sample-data browser checks cover initial two recommendations, short-query zero matches, hiding empty alternative sections, selecting/clearing a campus, demand circles/pin spacing, and a simulated HTTP 429 warning appearing and disappearing. These checks do not consume the real model quota or access private accounts/documents. Exact suggestion-to-ID navigation is also regression-tested. A physical Android smoke test remains necessary before survey distribution.

Rebuild from the updated source for testing:

```powershell
eas build --platform android --profile preview --clear-cache
```

The previous dependency-security advisories remain open; this UI batch does not resolve or dismiss them. See `NOVEMBER_6_UPDATE.md`.
