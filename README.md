# Room Scout

Room Scout is an Expo React Native app for finding and listing dormitories. It uses Expo Router, Supabase, and native Android maps through `react-native-maps`.

## Prerequisites

Install these before running the app:

- Node.js 22.13.x or newer for Expo SDK 56
- npm
- Git
- Android Studio with Android SDK, platform tools, and an Android emulator
- Expo/EAS CLI when building APKs: `npm install -g eas-cli`
- A Supabase project
- A Google Cloud project with Maps SDK for Android enabled

## First-Time Setup

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd room-scout
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your local environment file:

   ```bash
   copy .env.example .env
   ```

4. Fill in `.env`:

   ```env
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   GOOGLE_MAPS_API_KEY=your_android_google_maps_api_key
   ```

5. Set up Supabase:

   - Open your Supabase project.
   - Go to SQL Editor.
   - Run `supabase/schema.sql`.
   - If needed, run `supabase/additions.sql`.
   - Create a public storage bucket named `uploaded_images` for dorm photos.

## Google Maps Setup

Android APKs need a real Google Maps API key. Do not use a fake demo key.

1. In Google Cloud Console, enable **Maps SDK for Android**.
2. Create an API key.
3. Restrict the key to Android apps.
4. Add this package name:

   ```text
   com.snap.rooms
   ```

5. Add the SHA-1 certificate fingerprint for the keystore used by the build.
   - For local/debug builds, use your debug keystore SHA-1.
   - For EAS builds, get the SHA-1 from the Expo project credentials after a build is created.
6. Put the key in `.env` as `GOOGLE_MAPS_API_KEY`.
7. Rebuild the APK after changing the key. The key is native build config, so updating `.env` alone will not fix an already-built APK.

The key is read by `app.config.js` and passed to the Expo `react-native-maps` config plugin as `androidGoogleMapsApiKey`.

For EAS cloud builds, also create the key in the EAS environment used by the build profile:

```bash
eas env:create --name GOOGLE_MAPS_API_KEY --value your_android_google_maps_api_key --environment preview --visibility sensitive
```

Repeat for `development` or `production` if you build those profiles.

## Run on Android Emulator

Start an Android emulator from Android Studio first, then run:

```bash
npm run android
```

If Metro is already running:

```bash
npm start
```

Then press `a` in the Expo terminal.

## Build an APK

```bash
eas login
eas build -p android --profile preview
```

Before building, make sure `.env` contains `GOOGLE_MAPS_API_KEY`. If the Maps tab or Add Dorm map closes the app in an APK, rebuild with a valid Maps SDK for Android key and the correct SHA-1 restriction.

## Useful Scripts

- `npm start` - Start the Expo dev server
- `npm run android` - Start on Android emulator
- `npm run web` - Start web build
- `npm run lint` - Run Expo lint
- `npm run verify-setup` - Check local setup files
- `npm run setup-supabase` - Create/update `.env` with Supabase credentials

## GitHub Workflow

After making changes:

```bash
git status
git add .
git commit -m "Describe the change"
git push origin main
```

If this is a new repository:

```bash
git remote add origin <github-repository-url>
git branch -M main
git push -u origin main
```

Do not commit `.env`, keystores, APK files, or Google Maps API keys.
