import AsyncStorage from '@react-native-async-storage/async-storage';
import { Host, Picker } from '@expo/ui';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthBrand, GoogleMark } from '@/components/auth-brand';
import { showError } from '@/components/error-toast';
import { AppColors, BorderRadius, Spacing } from '@/constants/theme';
import { getAccountRegistration, SIGNUP_ROLE_KEY } from '@/lib/account-profile';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export default function SetupUsername() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading: authLoading } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'' | 'renter' | 'owner'>('');
  const [avatar, setAvatar] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    if (!user) { router.replace('/(auth)/sign-in'); return; }
    setLoadingProfile(true);
    setProfileError(false);
    void (async () => {
      try {
        const [profile, hint] = await Promise.all([getAccountRegistration(user.id), AsyncStorage.getItem(SIGNUP_ROLE_KEY)]);
        if (!active) return;
        if (profile.completed) { router.replace('/(tabs)/home'); return; }
        setFullName(profile.fullName || user.user_metadata?.full_name || user.user_metadata?.name || '');
        setUsername(profile.username);
        setPhone(profile.phone);
        setAvatar(profile.avatarUrl || user.user_metadata?.avatar_url || user.user_metadata?.picture || '');
        setRole(profile.role === 'owner' || hint === 'owner' ? 'owner' : hint === 'renter' ? 'renter' : '');
      } catch {
        if (active) setProfileError(true);
      } finally {
        if (active) setLoadingProfile(false);
      }
    })();
    return () => { active = false; };
  }, [authLoading, user?.id, retry, router, user]);

  const continueSetup = async () => {
    if (saving) return;
    if (!fullName.trim() || fullName.trim().length > 120) { showError('Check your name', 'Enter your full name using up to 120 characters.'); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(username.trim().toLowerCase())) { showError('Check your username', 'Use 3–30 letters, numbers or underscores.'); return; }
    if (!role) { showError('Choose an account type', 'Select Student / Renter or Dorm Owner to continue.'); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('is_username_available', { p_username: username.trim().toLowerCase() });
      if (error) throw error;
      if (!data) { showError('Username taken', 'Choose another username.'); return; }
      setStep(2);
    } catch {
      showError('Could not check username', 'Check your connection and try again. Your details have been kept.');
    } finally { setSaving(false); }
  };

  const completeSetup = async () => {
    if (!user || saving || !role) return;
    if (phone.trim() && !/^\+?[0-9][0-9 ()-]{6,19}$/.test(phone.trim())) { showError('Check contact number', 'Enter a valid contact number or leave it blank.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('complete_account_registration', {
        p_full_name: fullName.trim(), p_username: username.trim().toLowerCase(), p_role: role, p_phone: phone.trim() || null,
      });
      if (error) throw error;
      await AsyncStorage.removeItem(SIGNUP_ROLE_KEY).catch(() => {});
      router.replace(role === 'owner' ? '/(auth)/owner-verification' : '/');
    } catch (error: any) {
      if (error?.code === '23505') { setStep(1); showError('Username taken', 'Someone just claimed that username. Choose another.'); }
      else showError('Could not finish registration', error?.message || 'Check your connection and try again. Your details have been kept.');
    } finally { setSaving(false); }
  };

  const changeAccount = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await AsyncStorage.removeItem(SIGNUP_ROLE_KEY).catch(() => {});
      router.replace('/(auth)/sign-in');
    } catch { showError('Could not sign out', 'Check your connection and try again.'); }
    finally { setSaving(false); }
  };

  if (authLoading || loadingProfile) return <View style={styles.loading}><ActivityIndicator color={AppColors.accent} /><Text style={styles.subtitle}>Preparing your profile…</Text></View>;
  if (profileError) return <View style={styles.loading}><Text style={styles.title}>Let’s try that again</Text><Text style={styles.subtitle}>We couldn’t load your account details. Check your connection to continue.</Text><Pressable style={styles.primary} onPress={() => setRetry((value) => value + 1)}><Text style={styles.primaryText}>Retry</Text></Pressable></View>;

  return <ScrollView style={styles.screen} contentContainerStyle={[styles.container, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four }]} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
    <AuthBrand />
    <View style={styles.form}>
      <Text style={styles.title}>Complete your account</Text>
      <Text style={styles.subtitle}>A few details, then you’re ready to find your place.</Text>
      <Text style={styles.step}>Step {step} of 2 · {step === 1 ? 'About you' : 'Confirm your details'}</Text>
      <View style={styles.progress}><View style={[styles.progressFill, { width: step === 1 ? '50%' : '100%' }]} /></View>
      {step === 1 ? <>
        <View style={styles.field}><Text style={styles.label}>Full Name</Text><TextInput accessibilityLabel="Full Name" value={fullName} onChangeText={setFullName} maxLength={120} autoComplete="name" placeholder="Enter your full name" placeholderTextColor={AppColors.placeholder} style={styles.input} editable={!saving} /></View>
        <View style={styles.field}><Text style={styles.label}>Username</Text><TextInput accessibilityLabel="Username" value={username} onChangeText={(value) => setUsername(value.toLowerCase())} maxLength={30} autoCapitalize="none" autoCorrect={false} autoComplete="username-new" placeholder="Choose a unique username" placeholderTextColor={AppColors.placeholder} style={styles.input} editable={!saving} /></View>
        <View style={styles.field}><Text style={styles.label}>I am a…</Text><View style={styles.roleInput}><Host colorScheme="dark" seedColor={AppColors.accent} matchContents><Picker testID="registration-role" selectedValue={role} onValueChange={(value) => setRole(value as typeof role)} enabled={!saving}><Picker.Item label="Choose your account type" value="" /><Picker.Item label="Student / Renter" value="renter" /><Picker.Item label="Dorm Owner" value="owner" /></Picker></Host></View></View>
        <Pressable accessibilityRole="button" disabled={saving} onPress={continueSetup} style={({ pressed }) => [styles.primary, (saving || pressed) && styles.dim]}><Text style={styles.primaryText}>{saving ? 'Checking username…' : 'Continue'}</Text></Pressable>
      </> : <>
        <View style={styles.identity}>
          {avatar ? <Image source={{ uri: avatar }} contentFit="cover" style={styles.avatar} /> : <Ionicons name="person-circle-outline" size={48} color={AppColors.accent} />}
          <View style={styles.identityText}><Text style={styles.identityName}>{fullName.trim()}</Text><Text style={styles.subtitle}>@{username.trim().toLowerCase()} · {role === 'owner' ? 'Dorm Owner' : 'Student / Renter'}</Text></View>
        </View>
        <View style={styles.field}><Text style={styles.label}>Email</Text><View style={styles.email}><GoogleMark /><Text selectable style={styles.emailText}>{user?.email || 'Your Google account'}</Text><Ionicons name="lock-closed-outline" size={16} color={AppColors.textSecondary} /></View><Text style={styles.hint}>Your sign-in is managed by Google. No new password is needed.</Text></View>
        <View style={styles.field}><Text style={styles.label}>Contact Number <Text style={styles.hint}>(optional)</Text></Text><TextInput accessibilityLabel="Contact Number" value={phone} onChangeText={setPhone} maxLength={21} keyboardType="phone-pad" autoComplete="tel" placeholder="e.g. 0917 123 4567" placeholderTextColor={AppColors.placeholder} style={styles.input} editable={!saving} /></View>
        {role === 'owner' && <Text style={styles.hint}>Owner verification is a separate step. Choosing Dorm Owner does not mark your account as verified.</Text>}
        <Pressable accessibilityRole="button" disabled={saving} onPress={completeSetup} style={({ pressed }) => [styles.primary, (saving || pressed) && styles.dim]}><Text style={styles.primaryText}>{saving ? 'Creating your profile…' : 'Complete registration'}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => setStep(1)} style={styles.linkButton}><Text style={styles.link}>Back to your details</Text></Pressable>
      </>}
      <Pressable accessibilityRole="button" disabled={saving} onPress={changeAccount} style={styles.linkButton}><Text style={styles.subtitle}>Use a different account</Text></Pressable>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AppColors.background },
  container: { flexGrow: 1, paddingHorizontal: Spacing.four, gap: Spacing.four },
  form: { width: '100%', maxWidth: 440, alignSelf: 'center', paddingBottom: Spacing.three },
  loading: { flex: 1, backgroundColor: AppColors.background, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  title: { color: AppColors.text, fontSize: 24, fontWeight: '700', marginBottom: Spacing.two },
  subtitle: { color: AppColors.textSecondary, fontSize: 14, lineHeight: 21 },
  step: { color: AppColors.textSecondary, fontSize: 12, marginTop: Spacing.four, marginBottom: Spacing.two },
  progress: { height: Spacing.one, backgroundColor: AppColors.surfaceElevated, borderRadius: BorderRadius.full, marginBottom: Spacing.four, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: AppColors.accent },
  field: { marginBottom: Spacing.three, gap: Spacing.two },
  label: { color: AppColors.textSecondary, fontSize: 14, fontWeight: '600' },
  input: { color: AppColors.text, backgroundColor: AppColors.input, borderColor: AppColors.inputBorder, borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.three, fontSize: 16, minHeight: 50 },
  roleInput: { backgroundColor: AppColors.input, borderWidth: 1, borderColor: AppColors.inputBorder, borderRadius: BorderRadius.md, padding: Spacing.two, minHeight: 50 },
  primary: { backgroundColor: AppColors.accent, borderRadius: BorderRadius.md, minHeight: 50, padding: Spacing.three, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
  primaryText: { color: AppColors.white, fontSize: 16, fontWeight: '700' },
  dim: { opacity: 0.6 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three, marginBottom: Spacing.three },
  identityText: { flex: 1, minWidth: 0 },
  identityName: { color: AppColors.text, fontSize: 17, fontWeight: '700' },
  avatar: { width: 48, height: 48, borderRadius: BorderRadius.full },
  email: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, backgroundColor: AppColors.surface, borderRadius: BorderRadius.md },
  emailText: { flex: 1, minWidth: 0, color: AppColors.text, fontSize: 14 },
  hint: { color: AppColors.textSecondary, fontSize: 12, lineHeight: 18 },
  linkButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingVertical: Spacing.two, marginTop: Spacing.two },
  link: { color: AppColors.accent, fontSize: 14, fontWeight: '600' },
});
