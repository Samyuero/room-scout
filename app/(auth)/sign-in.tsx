import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Pressable, Platform } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AppColors, BorderRadius } from '@/constants/theme';

WebBrowser.maybeCompleteAuthSession();

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace('/' as any);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      let redirectTo: string;
      if (Platform.OS === 'web') {
        redirectTo = `${window.location.origin}/auth/callback`;
      } else {
        redirectTo = 'roomscout://google-auth';
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });

      if (error) throw error;

      if (Platform.OS === 'web') return;

      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') {
          const { url } = result;
          const params = url.split('#')[1] || url.split('?')[1];
          if (params) {
            const dict: { [key: string]: string } = {};
            params.split('&').forEach((pair) => {
              const [k, v] = pair.split('=');
              dict[k] = decodeURIComponent(v);
            });
            if (dict.access_token && dict.refresh_token) {
              const { error: sessionError } = await supabase.auth.setSession({
                access_token: dict.access_token,
                refresh_token: dict.refresh_token,
              });
              if (sessionError) throw sessionError;
              router.replace('/' as any);
            }
          }
        }
      }
    } catch (error: any) {
      Alert.alert('Google Sign-In Error', error.message);
    } finally {
      if (Platform.OS !== 'web') {
        setGoogleLoading(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.brandBlock}>
        <Text style={styles.brandName}>Room Scout</Text>
        <Text style={styles.brandTagline}>Find your space near campus</Text>
      </View>

      <Text style={styles.title}>Sign In</Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Enter your email"
          placeholderTextColor={AppColors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
        />
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Enter your password"
          placeholderTextColor={AppColors.textMuted}
          secureTextEntry
        />
      </View>

      <Pressable
        style={[styles.primaryButton, (loading || googleLoading) && styles.buttonDisabled]}
        onPress={handleSignIn}
        disabled={loading || googleLoading}
      >
        <Text style={styles.primaryButtonText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
      </Pressable>

      <Pressable
        style={[styles.googleButton, (loading || googleLoading) && styles.buttonDisabled]}
        onPress={handleGoogleSignIn}
        disabled={loading || googleLoading}
      >
        <Text style={styles.googleButtonText}>
          {googleLoading ? 'Connecting...' : 'Sign In with Google'}
        </Text>
      </Pressable>

      <Text
        style={styles.link}
        onPress={() => router.push('/(auth)/sign-up' as any)}
      >
        Don't have an account? Sign up
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: AppColors.background,
    justifyContent: 'center',
  },
  brandBlock: {
    marginBottom: 40,
    alignItems: 'center',
  },
  brandName: {
    fontSize: 32,
    fontWeight: '700',
    color: AppColors.text,
    letterSpacing: -1,
  },
  brandTagline: {
    fontSize: 15,
    color: AppColors.textSecondary,
    marginTop: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 24,
    color: AppColors.text,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    color: AppColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    backgroundColor: AppColors.input,
    borderRadius: BorderRadius.md,
    padding: 14,
    fontSize: 16,
    color: AppColors.text,
  },
  primaryButton: {
    backgroundColor: AppColors.accent,
    borderRadius: BorderRadius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: AppColors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  googleButton: {
    backgroundColor: AppColors.surfaceElevated,
    borderWidth: 1,
    borderColor: AppColors.border,
    paddingVertical: 15,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    marginTop: 12,
  },
  googleButtonText: {
    color: AppColors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  link: {
    marginTop: 24,
    textAlign: 'center',
    color: AppColors.accent,
    fontSize: 15,
  },
});
