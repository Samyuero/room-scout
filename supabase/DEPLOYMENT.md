# RoomScout Supabase setup

The mobile app keeps all secrets off the device. Public Supabase URL/anon-key values may be used by the Expo client, while the Gemini key must exist only as an Edge Function secret.

## Existing project update

1. Open the Supabase SQL editor and run `roomscout_runtime_update.sql`.
2. For the complete transaction, review, RLS, and audit workflow, run `security_hardening.sql` after the project has `schema_v2.sql` and `capstone42_updates.sql`.
3. Confirm the Storage page contains:
   - `uploaded_images` (public listing/review photos; JPEG, PNG, or WebP; 8 MB maximum)
   - `private_documents` (private IDs, payment proofs, contracts, and ownership proof)

The runtime update ends with a PostgREST schema-cache reload. It fixes the `request_type column ... not found in the schema cache` error shown by older databases and adds review-photo support, the review insert policy, and the privacy-safe public review function.

## Gemini assistant

Set the key as a server secret; never add it to the Expo `.env`, `app.json`, source control, or the APK:

```sh
supabase secrets set GEMINI_API_KEY=your_key
supabase secrets set GEMINI_MODEL=gemini-3.5-flash-lite
supabase functions deploy dorm-assistant
```

The function requires a signed-in Supabase user. It sends Gemini only approved public listing facts, the signed-in renter's own preferences, and the current message after basic contact-number/email redaction. It does not query or send other renters' profiles, requests, IDs, payments, or messages.

The app has a local rules-based recommendation fallback when the function is not deployed or the free Gemini quota is unavailable.

For local Edge Function work only, copy `functions/.env.example` to
`functions/.env`. That file is ignored by Git. Share secrets through the
Supabase project secret manager or a private team password manager, not through
GitHub, chat, screenshots, or committed environment files. Teammates using the
deployed backend do not need the Gemini key on their devices.

## Listing photos

The owner selects up to 10 local images. The app validates JPEG/PNG/WebP and an 8 MB limit, uploads each file to the `uploaded_images` bucket, and stores the resulting public URLs in `dorms.images`. This is what makes the images visible on other installed copies of the app.

## Before an APK release

- Apply the SQL files to the production Supabase project.
- Deploy `dorm-assistant` and set its secrets.
- Confirm email verification and Google Auth redirect URLs in Supabase Auth.
- Build an Android development/preview APK and test location, image selection, request submission, and notification badges on a physical device.
- Remote phone notifications additionally require `expo-notifications`, an EAS project ID, a development/production build (not Expo Go), token registration, and a trusted server sender. Database notifications and exact in-app unread badges already update through Supabase Realtime.
