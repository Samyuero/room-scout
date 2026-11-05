import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppLoadingScreen } from '@/components/app-loading-screen';
import { useAuth } from '../src/hooks/useAuth';
import { getAccountRegistration } from '@/lib/account-profile';
import { AppColors } from '@/constants/theme';

export default function Index() {
  const { user, loading: authLoading } = useAuth();
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const checkProfile = async () => {
      setCheckingProfile(true);
      setProfileError(false);
      if (!user) {
        setRegistrationComplete(false);
        setCheckingProfile(false);
        return;
      }
      try {
        const profile = await getAccountRegistration(user.id);
        if (active) setRegistrationComplete(profile.completed);
      } catch {
        if (active) setProfileError(true);
      } finally {
        if (active) setCheckingProfile(false);
      }
    };

    if (!authLoading) {
      checkProfile();
    }
    return () => { active = false; };
  }, [user, authLoading, retry]);

  if (authLoading || checkingProfile) {
    return <AppLoadingScreen />;
  }

  if (user) {
    if (profileError) return <View style={{ flex: 1, backgroundColor: AppColors.background, padding: 24, justifyContent: 'center', gap: 16 }}><Text style={{ color: AppColors.text }}>We couldn’t load your profile. Check your connection and try again.</Text><Pressable onPress={() => setRetry((value) => value + 1)}><Text style={{ color: AppColors.accent }}>Retry</Text></Pressable></View>;
    if (!registrationComplete) {
      return <Redirect href={"/(auth)/setup-username" as any} />;
    }
    return <Redirect href={"/(tabs)/home" as any} />;
  }

  return <Redirect href={"/(auth)/sign-in" as any} />;
}
