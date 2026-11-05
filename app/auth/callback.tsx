import { completeOAuthRedirect } from '@/lib/account-profile';
import { showError } from '@/components/error-toast';
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

export default function Callback() {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (Platform.OS === 'web') {
          await completeOAuthRedirect(window.location.href);
          // Do not leave auth codes or legacy tokens in browser history.
          window.history.replaceState({}, '', window.location.pathname);
        }
        if (active) router.replace('/');
      } catch {
        if (active) {
          showError('Google sign-in failed', 'Please return to Sign In and try again.');
          router.replace('/(auth)/sign-in');
        }
      }
    })();
    return () => { active = false; };
  }, [router]);
  return null;
}
