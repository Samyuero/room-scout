import { Linking, Platform } from 'react-native';

export const SNAP_CONTACT_EMAIL = 'samuelcapuras.haha@gmail.com';

/** Open a draft only. The user reviews and sends it in their email application. */
export async function composeSnapEmail(): Promise<void> {
  const mailto = `mailto:${SNAP_CONTACT_EMAIL}`;
  if (Platform.OS === 'android') {
    try {
      const { startActivityAsync } = await import('expo-intent-launcher');
      // IntentLauncher applies packageName only together with a component class.
      await startActivityAsync('android.intent.action.SENDTO', {
        data: mailto,
        packageName: 'com.google.android.gm',
        className: 'com.google.android.gm.ComposeActivityGmail',
      });
      return;
    } catch {
      // Gmail may not be installed (or this APK may predate the native module).
      // Try any configured email app without requiring package-query permission.
    }
  }
  try {
    await Linking.openURL(mailto);
  } catch {
    throw new Error(`No email app could be opened. You can email SNAP at ${SNAP_CONTACT_EMAIL}.`);
  }
}
