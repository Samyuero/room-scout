import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../src/hooks/useAuth';
import { supabase } from '../src/lib/supabase';
import { AppColors } from '@/constants/theme';

export default function Index() {
  const { user, loading: authLoading } = useAuth();
  const [checkingProfile, setCheckingProfile] = useState(true);
  const [hasUsername, setHasUsername] = useState(false);

  useEffect(() => {
    const checkProfile = async () => {
      if (!user) {
        setCheckingProfile(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('username')
          .eq('profile_id', user.id)
          .single();

        if (data && data.username) {
          setHasUsername(true);
        } else {
          setHasUsername(false);
        }
      } catch (err) {
        console.error('Error checking profile username:', err);
        setHasUsername(false);
      } finally {
        setCheckingProfile(false);
      }
    };

    if (!authLoading) {
      checkProfile();
    }
  }, [user, authLoading]);

  if (authLoading || checkingProfile) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (user) {
    if (!hasUsername) {
      return <Redirect href={"/(auth)/setup-username" as any} />;
    }
    return <Redirect href={"/(tabs)/home" as any} />;
  }

  return <Redirect href={"/(auth)/sign-in" as any} />;
}
