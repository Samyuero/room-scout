import { useEffect } from 'react';
import { supabase } from '../../src/lib/supabase';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

export default function Callback() {
  const router = useRouter();

  useEffect(() => {
    // If we are not on web, redirect to home (this route should only be hit on web)
    if (Platform.OS !== 'web') {
      router.replace('/');
      return;
    }

    const handleCallback = async () => {
      try {
        // The tokens are in the URL hash (for implicit flow) or query params (for auth code flow)
        // We are using PKCE, which is an auth code flow, so the tokens are exchanged and the redirect
        // will contain the tokens in the hash? Actually, with PKCE, Supabase redirects with the tokens in the hash.
        // Let's check both hash and query.
        const hash = window.location.hash.substring(1);
        const query = window.location.search.substring(1);

        let params = new URLSearchParams(hash || query);

        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });

          if (error) {
            throw error;
          }

          // Redirect to the index to check for username and then go to home or setup
          router.replace('/');
        } else {
          // If we don't have tokens, maybe we are in the web flow and the tokens are in the hash as fragment?
          // Alternatively, we can try to get the session from Supabase by exchanging the code?
          // But note: we are using PKCE and the flowType is set to 'pkce', so the redirect should have the tokens.
          // If not, we might need to exchange the code.
          // However, for simplicity, we'll just try to get the session and then redirect.
          const { data: { session }, error } = await supabase.auth.getSession();
          if (session) {
            router.replace('/');
          } else {
            // No session, redirect to sign-in
            router.replace('/(auth)/sign-in');
          }
        }
      } catch (err) {
        console.error('Callback error:', err);
        router.replace('/(auth)/sign-in');
      }
    };

    handleCallback();
  }, [router]);

  return null; // We don't render anything, just redirect
}