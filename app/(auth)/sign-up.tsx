import AsyncStorage from '@react-native-async-storage/async-storage';
import { completeOAuthRedirect, SIGNUP_ROLE_KEY } from '@/lib/account-profile';
import { AuthBrand, GoogleMark } from '@/components/auth-brand';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showError } from '@/components/error-toast';
import { AppColors } from '@/constants/theme';
import { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Pressable, Platform, Alert, useWindowDimensions } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export default function SignUp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 740 || fontScale > 1.15;
  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'renter' | 'owner'>('renter');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const validateIdentity = () => {
    if (!fullName.trim() || fullName.trim().length > 120) {
      showError('Check your name', 'Enter your full name using up to 120 characters.');
      return false;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(username.trim().toLowerCase())) {
      showError('Check your username', 'Use 3–30 letters, numbers or underscores.');
      return false;
    }
    return true;
  };

  const continueSignup = async () => {
    if (loading || googleLoading || !validateIdentity()) return;
    setLoading(true);
    try {
      const { data: available, error } = await supabase.rpc('is_username_available', { p_username: username.trim().toLowerCase() });
      if (error) throw error;
      if (!available) { showError('Username taken', 'Choose another username.'); return; }
      setStep(2);
    } catch (error: any) {
      if (error?.code === 'PGRST202') showError('Database update required', 'The signup database migration must be applied before creating an account.');
      else showError('Could not check username', 'Check your connection and try again. Your details have been kept.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (loading || googleLoading || !validateIdentity()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showError('Check your email', 'Enter a valid email address.');
      return;
    }
    if (phone.trim() && !/^\+?[0-9][0-9 ()-]{6,19}$/.test(phone.trim())) {
      showError('Check contact number', 'Enter a valid contact number or leave it blank.');
      return;
    }
    if (password.length < 8 || password.length > 128) {
      showError('Check your password', 'Use between 8 and 128 characters.');
      return;
    }
    if (password !== confirmPassword) {
      showError('Passwords do not match', 'Re-enter the same password in both fields.');
      return;
    }

    setLoading(true);
    try {
      const cleanUsername = username.trim().toLowerCase();
      // Recheck for a name claimed while this form was open. The database also
      // enforces uniqueness atomically when the account/profile is created.
      const { data: available, error: usernameError } = await supabase.rpc('is_username_available', { p_username: cleanUsername });
      if (usernameError) throw usernameError;
      if (!available) { setStep(1); showError('Username taken', 'Choose another username.'); return; }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: {
          full_name: fullName.trim(),
          username: cleanUsername,
          role,
          contact_phone: phone.trim() || null,
        } },
      });
      if (error) throw error;
      // Auth triggers create the profile even while email verification is pending.
      if (!data.session) {
        Alert.alert('Check your email', 'Open the verification link to finish creating your account.');
        router.replace('/(auth)/sign-in' as never);
      } else {
        router.replace('/' as never);
      }
    } catch (error: any) {
      // A concurrent signup can win after the availability check.
      const { data: stillAvailable } = await supabase.rpc('is_username_available', { p_username: username.trim().toLowerCase() });
      if (stillAvailable === false) { setStep(1); showError('Username taken', 'Choose another username.'); }
      else showError('Could not create account', error.message || 'Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    try {
      await AsyncStorage.setItem(SIGNUP_ROLE_KEY, role);
      // Determine redirect URL based on platform
      let redirectTo: string;
      if (Platform.OS === 'web') {
        // On web, we want to redirect the current window to the OAuth provider
        redirectTo = `${window.location.origin}/auth/callback`;
      } else {
        // On native, we use our custom scheme
        redirectTo = 'roomscout://google-auth';
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: Platform.OS !== 'web',
        },
      });

      if (error) throw error;

      if (Platform.OS === 'web') {
        // On web, the signInWithOAuth method will redirect the window to the OAuth provider.
        // We don't need to do anything else here; the window will navigate away.
        return;
      }

      // On native, we use WebBrowser to open the URL and then handle the result.
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type === 'success') {
          await completeOAuthRedirect(result.url);
          router.replace('/' as never);
        } else await AsyncStorage.removeItem(SIGNUP_ROLE_KEY);
      }
    } catch (error: any) {
      await AsyncStorage.removeItem(SIGNUP_ROLE_KEY).catch(() => {});
      showError('Google Sign-Up Error', error.message);
    } finally {
      // Only set loading to false if we are not on web (because on web we redirect and the component unmounts)
      if (Platform.OS !== 'web') {
        setGoogleLoading(false);
      }
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + Math.min(36, height * 0.04), paddingBottom: insets.bottom + 16 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <AuthBrand />
      <View style={[styles.form, compact && styles.compactForm]}>
        <Text style={styles.title}>Create Account</Text>
        <View style={styles.progress}>
          <Text style={styles.progressText}>Step {step} of 2 · {step === 1 ? 'About you' : 'Account details'}</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: step === 1 ? '50%' : '100%' }]} /></View>
        </View>

        {step === 1 ? <>
          <View style={[styles.inputGroup, compact && styles.compactGroup]}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput accessibilityLabel="Full Name" placeholderTextColor={AppColors.placeholder} style={[styles.input, compact && styles.compactInput]} value={fullName} onChangeText={setFullName} maxLength={120} placeholder="Enter your full name" autoComplete="name" editable={!loading && !googleLoading} />
          </View>
          <View style={[styles.inputGroup, compact && styles.compactGroup]}>
            <Text style={styles.label}>Username</Text>
            <TextInput accessibilityLabel="Username" placeholderTextColor={AppColors.placeholder} style={[styles.input, compact && styles.compactInput]} value={username} onChangeText={(value) => setUsername(value.toLowerCase())} maxLength={30} placeholder="Choose a unique username" autoCapitalize="none" autoCorrect={false} autoComplete="username-new" editable={!loading && !googleLoading} />
          </View>
          <View style={[styles.inputGroup, compact && styles.compactGroup]}>
            <Text style={styles.label}>I am a...</Text>
            <View style={styles.roleContainer}>
              {(['renter', 'owner'] as const).map((choice) => (
                <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: role === choice }} disabled={loading || googleLoading} onPress={() => setRole(choice)} style={[styles.roleButton, role === choice && styles.roleButtonActive]}>
                  <Text style={[styles.roleText, role === choice && styles.roleTextActive]}>{choice === 'renter' ? 'Student / Renter' : 'Dorm Owner'}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Pressable accessibilityRole="button" disabled={loading || googleLoading} onPress={continueSignup} style={[styles.primaryButton, (loading || googleLoading) && styles.disabled]}>
            <Text style={styles.buttonText}>{loading ? 'Checking username...' : 'Continue'}</Text>
          </Pressable>
          <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR</Text><View style={styles.dividerLine} /></View>
          <Pressable accessibilityRole="button" disabled={loading || googleLoading} onPress={handleGoogleSignUp} style={[styles.googleButton, (loading || googleLoading) && styles.disabled]}>
            <View style={styles.googleContent}><GoogleMark /><Text style={styles.buttonText}>{googleLoading ? 'Connecting...' : 'Sign Up with Google'}</Text></View>
          </Pressable>
        </> : <>
          <View style={[styles.inputGroup, compact && styles.compactGroup]}>
            <Text style={styles.label}>Email</Text>
            <TextInput accessibilityLabel="Email" placeholderTextColor={AppColors.placeholder} style={[styles.input, compact && styles.compactInput]} value={email} onChangeText={setEmail} maxLength={254} placeholder="Enter your email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" editable={!loading} />
          </View>
          <View style={[styles.inputGroup, compact && styles.compactGroup]}>
            <Text style={styles.label}>Contact Number <Text style={styles.optional}>· Optional</Text></Text>
            <TextInput accessibilityLabel="Contact Number" placeholderTextColor={AppColors.placeholder} style={[styles.input, compact && styles.compactInput]} value={phone} onChangeText={setPhone} maxLength={21} placeholder="e.g. 0917 123 4567" keyboardType="phone-pad" autoComplete="tel" editable={!loading} />
          </View>
          <View style={[styles.inputGroup, compact && styles.compactGroup]}>
            <Text style={styles.label}>Password</Text>
            <TextInput accessibilityLabel="Password" placeholderTextColor={AppColors.placeholder} style={[styles.input, compact && styles.compactInput]} value={password} onChangeText={setPassword} maxLength={128} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" autoComplete="new-password" editable={!loading} />
          </View>
          <View style={[styles.inputGroup, compact && styles.compactGroup]}>
            <Text style={styles.label}>Re-enter Password</Text>
            <TextInput accessibilityLabel="Re-enter Password" placeholderTextColor={AppColors.placeholder} style={[styles.input, compact && styles.compactInput]} value={confirmPassword} onChangeText={setConfirmPassword} maxLength={128} placeholder="Enter your password again" secureTextEntry autoCapitalize="none" autoComplete="new-password" editable={!loading} />
          </View>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => setStep(1)} style={[styles.backButton, loading && styles.disabled]}><Text style={styles.buttonText}>Back</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={loading} onPress={handleSignUp} style={[styles.primaryButton, styles.submitButton, loading && styles.disabled]}><Text style={styles.buttonText}>{loading ? 'Creating account...' : 'Sign Up'}</Text></Pressable>
          </View>
        </>}

        <Text style={styles.link} onPress={() => { if (!loading && !googleLoading) router.push('/(auth)/sign-in' as never); }}>Already have an account? Sign in</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: AppColors.background },
  container: { flexGrow: 1, paddingHorizontal: 24, alignItems: 'center' },
  form: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', justifyContent: 'center', paddingVertical: 20 },
  compactForm: { paddingVertical: 12 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8, color: AppColors.text, textAlign: 'left' },
  progress: { gap: 8, marginBottom: 16 },
  progressText: { fontSize: 12, color: AppColors.textSecondary },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: AppColors.borderSubtle, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: AppColors.accent },
  inputGroup: { marginBottom: 12 },
  compactGroup: { marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, color: AppColors.textSecondary },
  optional: { fontWeight: '400', color: AppColors.textMuted },
  input: { color: AppColors.text, backgroundColor: AppColors.input, borderWidth: 1, borderColor: AppColors.inputBorder, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  compactInput: { paddingVertical: 10 },
  primaryButton: { minHeight: 48, padding: 12, borderRadius: 10, backgroundColor: AppColors.accent, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: AppColors.white, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  googleButton: { minHeight: 48, padding: 12, borderRadius: 10, backgroundColor: AppColors.surfaceElevated, borderWidth: 1, borderColor: AppColors.border, alignItems: 'center', justifyContent: 'center' },
  googleContent: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  disabled: { opacity: 0.5 },
  link: { marginTop: 18, textAlign: 'center', color: AppColors.accent, fontSize: 13 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: AppColors.border },
  dividerText: { color: AppColors.textMuted, fontSize: 12 },
  roleContainer: { flexDirection: 'row', gap: 10 },
  roleButton: { flex: 1, minHeight: 46, padding: 10, borderWidth: 1, borderColor: AppColors.inputBorder, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  roleButtonActive: { borderColor: AppColors.accent, backgroundColor: AppColors.surfaceElevated },
  roleText: { color: AppColors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  roleTextActive: { color: AppColors.accent },
  actions: { flexDirection: 'row', gap: 10 },
  backButton: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: AppColors.border, borderRadius: 10, backgroundColor: AppColors.surfaceElevated, justifyContent: 'center', minWidth: 74 },
  submitButton: { flex: 1 },
});
