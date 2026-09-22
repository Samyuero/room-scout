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
        const [renter, owner, admin] = await Promise.all([
          supabase.from('renters').select('username').eq('renter_id', user.id).maybeSingle(),
          supabase.from('owners').select('username').eq('owner_id', user.id).maybeSingle(),
          supabase.from('admins').select('username').eq('admin_id', user.id).maybeSingle()
        ]);

        const username = renter.data?.username || owner.data?.username || admin.data?.username;

        if (username) {
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000000' }}>
        <ActivityIndicator size="large" color={AppColors.accent} />
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
