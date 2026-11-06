# November 6 — discovery, transactions and administration

## Where to find the additions

| Area | Location and behavior |
| --- | --- |
| School search | Maps → school button. UCLM is built in; another school can be searched explicitly. The selected campus, not a fake GPS position, anchors the radius. |
| Distance pins | Maps: green within 70% of the radius, blue inside its edge, red outside. The separate strict distance filter removes outside results. |
| Search alternatives | Before searching, Search shows an introduction and available recommendations, not Matches. After submitting, Matches contains only strict matches. Recommended for you remains separate, even for zero matches; recommendations and suggestions exclude unavailable/reserved/full dorms. |
| Compare | Compact headers show overall scores and a green outline on the higher score. Show/hide comparison details reveals aligned categories. Blue text matches this account's profile preferences; green marks stronger metrics. |
| Payment review | Contract images stay inside the Android app with protected preview/full-screen viewing. The agreement is a centered radio control; the selected receipt is a tappable image to replace. Close/Submit are rounded, right-aligned. |
| Featured dormitories | Admin → Listings → expand → Feature. Home shows their circular main-photo carousel below the logo. |
| Owner identity | Profile → request verification. A government ID/permit is stored privately; only admin review grants verification. Rejected applications can replace the document and resubmit. |
| Instant listing | A verified owner publishes from Add Dormitory. There is no separate listing-approval queue. Ownership proof remains private; LGU certification still needs a separate proof review. |
| Listing management | Admin → Listings has compact searchable rows, edit, featured/LGU controls and reversible removal. Removal archives instead of deleting linked payment/tenant history. |
| Owner payments | Owner Dashboard → Requests. Cash and QR final confirmation belongs to the owner, after checking actual receipt. Admin Payments is read-only history with filters and proof viewers. |
| Reservations | Owner Dashboard → Reserved. Start tenancy reuses the reserved bed; Release slot is explicit and does not erase an owed refund. |
| Booking history/refunds | Profile → Bookings & history. Includes every request, reservation/stay, cancellation, refund QR/account details, the 90/10 calculation, owner proof, renter receipt confirmation and related support reports. |
| Owner activity | Requests, Reserved, Tenants and Closed requests have search and dorm filters. Tenant rows start collapsed. Closed requests means booking/request history; Past tenants is the separate ended-tenancy record. |
| Dorm selector | Owner Dashboard → Dormitory opens a dark searchable sheet with thumbnails, selected checks, All dormitories and Clear filter. Past tenant cards explicitly label the dorm where the person previously rented. |
| Featured availability | Featured entries disappear while unavailable/reserved/full and return automatically when available. The stored featured flag is not removed. |
| Contact shortcuts | About SNAP → Email Us opens a Gmail draft to samuelcapuras.haha@gmail.com, with another email-app fallback if Gmail is absent. It never sends automatically. Visit Website and Profile Settings shortcuts are hidden for now. |
| Tenant history/stays | Profile → Past tenants, or Owner Dashboard → Tenants → Past tenants. Active stays can be extended; ending a stay also completes its originating request. |
| Owner checks | Admin → Owner checks is the submitted ID/permit verification queue, not a directory of every owner. A zero count means no pending verification applications. |
| Support | Profile → Report an issue & my tickets. Old tickets remain. A ticket has persistent replies/status; admins can add private notes and assign another admin. Transaction reports link to payment history. |
| Accounts | Admin → Accounts: directory/search, suspend/restore app access, revoke admin/owner verification privileges, and inspect/review a renter ID previously submitted with a request. Identity review is separate from the review section's verified-past-renter badge. |
| Notifications | Notifications deep-link to their admin queue, support conversation, owner request/reservation/history or renter booking. Data and action counts preload; account changes clear private client state. |

## Analytics and privacy

Price analytics groups listings into roughly 550 m geographic areas, displayed as circular overlays. Its reference average uses listings actually inside the map viewport. It is a listed-rent comparison, not a property valuation. With GPS off and no selected school/place, Maps browses the pilot area without falsely selecting a school or showing a distance origin.

Maps now has Clear location (also inside the school sheet) and Reset map. Explicit Locate clears stale query/strict filters; failed GPS uses a clearly labeled default Opao radius, keeps all published pins, and colors outside-radius pins red. Price/Demand use that same dataset. Reset reloads the tile view, refreshes listings and fits all pins. Explicitly applied strict search filters still exclude results until cleared. Map fitting accounts for the height of the controls so analytics cards do not cover the pins.

Demand forecasts the next 30 days using per-listing recent/prior activity plus pooled history across all published listings (including archived listings and manually recorded tenancies), all-time totals, and 12 monthly windows. Newer dorms borrow a pooled prior instead of a gray “Limited history” tag. Gemini receives those aggregates and a reviewed Philippine student-housing context; history-based estimates remain when the service/quota is unavailable. Results are stable while panning and cached for 10 minutes, with one forecast run per activation. No renter identities, IDs, documents, messages or raw requests are exposed by the aggregate RPC. This is not a trained/validated occupancy model or a nationwide dorm-market feed.

Demand pins use only Low, Moderate and High. The overall average is a categorical index across the displayed forecasted dorms: Low=1, Moderate=2, High=3; arithmetic mean, nearest category (below 1.5 Low, below 2.5 Moderate, otherwise High). It is not an occupancy percentage or probability. Listings without a completed forecast do not count toward the mean.

The context sources are [CHED's AY 2024–25 institution distribution](https://legacy.ched.gov.ph/2025-statistics-heis/) and [University of Cebu's enrollment portal](https://enrollment.uc.edu.ph/college), reviewed November 6, 2026. Enrollment, affordability, campus proximity and student amenities are qualitative context—not measured housing demand or proof of future occupancy. No national shortage percentage or unverified UCLM calendar is invented. Refresh the server-side context when new authoritative data is available.

Gemini receives approved public listing facts, aggregate ratings, the signed-in account's allowlisted preferences and rounded distances. It does not receive the origin's exact coordinates, other renters' profiles, support messages, documents, or transaction records. Search reranking is debounced and cached per account; per-user and shared server quotas keep the local fallback useful when the free service is unavailable. Gemini's key remains an Edge Function secret, not an Expo environment value.

School/place lookup uses Photon/OpenStreetMap on explicit submission, with timeouts and a seven-day device cache. The public geocoder and OSM tile/CDN services require internet and have no app-specific availability guarantee; a managed/self-hosted provider is appropriate if usage grows.

## Backend applied to the shared project

The `20261106*` migrations in `supabase/migrations` implement instant publication, verification resubmission, support conversations, owner payment/refund steps, history, access guards, renter identity review, project AI quotas and protected capacity fields. They were applied through versioned migrations, and `dorm-assistant` was redeployed with JWT verification kept on.

Suspension denies RoomScout database/storage/workflow access; it does not delete the person's Google/Supabase account. Private documents use RLS and short-lived URLs. Screenshot protection cannot prevent an external camera or a compromised device.

The Supabase advisor still reports leaked-password protection disabled. Enable it before a public/real-money release if the project's plan supports it: [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The two quota tables intentionally have no client RLS policies (server-only), and guarded role-checked RPCs intentionally use security-definer execution; these are not claims of a completed independent penetration test.

The refund flow records a participant-to-participant GCash transfer; RoomScout is not a payment processor and does not automatically debit, hold, send, or guarantee funds. Review the 90%/10% contract wording before using real money.

## Verification and survey checklist

Automated checks: TypeScript, Expo lint, all 59 checks in `scripts/test-*.js`, secret scanning, EAS preview configuration/online preflight and Android JavaScript export. Workflow SQL tests use synthetic users/documents in `BEGIN … ROLLBACK`; the demand test reads aggregates as an existing admin inside a rolled-back transaction. They do not leave test accounts or transfer money:

- `supabase/tests/rental_completion.sql`: cash/QR, duplicate confirmation/capacity, reservation conversion, refunds/retry safety, cancellation, extension, history and participant isolation.
- `supabase/tests/admin_support_security.sql`: authenticated RLS, self-verification rejection, guarded resubmission, instant publishing, moderation/capacity tampering, private admin notes, ticket isolation, identity review and suspension.
- `supabase/tests/demand_forecast.sql`: all-listing aggregation, 12 monthly windows, fixed horizon, authenticated access and no private fields.

Local sample-data visual checks cover narrow Home/Search/Map/Profile/Owner/Admin layouts. These are not physical-Android or real-Google-login tests. Before distributing a survey APK, use three separate test accounts on physical Android devices and check:

1. Owner verification → instant listing → LGU approval → featured toggle.
2. GPS off → browse without an origin → explicitly choose UCLM/another campus → strict filters and available-only alternatives.
3. Cash rental; QR rental; paid reservation → tenancy; two renters competing for the last slot.
4. Unpaid withdrawal, uploaded-but-unverified receipt withdrawal, paid 90% refund with proof/receipt confirmation and a support report.
5. Large system fonts, Android three-button navigation, notification deep links and image upload/viewing.

Build after pulling the new source and use the configured EAS preview environment:

```powershell
eas build --platform android --profile preview --clear-cache
```

No paid cloud APK build is started by the code/bundle verification itself. This batch is not automatically pushed to GitHub.

The Gmail compose change adds the SDK-compatible `expo-intent-launcher` native module, so rebuild the APK; an old installed APK cannot gain that native module through JavaScript reload. Gmail's actual activity launch still needs a physical Android check.

Dependency audit after installing the module reports 32 existing dependency advisories (1 critical, 12 high, 18 moderate, 1 low). The lockfile addition is only the new module, not a broad update. Some suggested fixes require a major SDK/router change, which was not forced into this UI batch. Do not treat the survey build as a completed security release or run `npm audit fix --force` blindly; schedule a compatible dependency-security update before public release.
