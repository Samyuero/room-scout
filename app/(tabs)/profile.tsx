import { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, TextInput, Alert, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useRouter } from 'expo-router';
import { AppColors, BorderRadius } from '@/constants/theme';

export default function Profile() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<any>(null);
  const [dorms, setDorms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editedProfile, setEditedProfile] = useState<any>({});
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;

      setLoading(true);
      try {
        // Get profile
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('profile_id', user.id)
          .single();

        if (profileError && profileError.code !== 'PGRST116') throw profileError; // Ignore if not found (will create)

        // Get user's dorms
        const { data: dormsData, error: dormsError } = await supabase
          .from('dorms')
          .select('*')
          .eq('owner_id', user.id);

        if (dormsError) throw dormsError;

        setProfile(profileData || {
          profile_id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || '',
          username: user.user_metadata?.username || '',
          avatar_url: user.user_metadata?.avatar_url || '',
          role: 'user',
        });

        setDorms(dormsData || []);
        setEditedProfile(profileData || {});

        const { count, error: notifError } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('read', false);

        if (!notifError && count !== null) {
          setUnreadCount(count);
        } else {
          setUnreadCount(0);
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;

    try {
      // Update Supabase auth user metadata
      await supabase.auth.updateUser({
        data: {
          full_name: editedProfile.full_name,
          username: editedProfile.username,
          avatar_url: editedProfile.avatar_url,
        }
      });

      // Update or insert profile
      const { error } = await supabase
        .from('profiles')
        .upsert({
          profile_id: user.id,
          updated_at: new Date().toISOString(),
          ...editedProfile,
        });

      if (error) throw error;

      setEditMode(false);
      setProfile(editedProfile);
    } catch (error) {
      console.error('Error saving profile:', error);
    }
  };

  const handleApplyForOwner = async () => {
    if (!user) return;

    // Check if email is verified
    const isEmailVerified = !!user.email_confirmed_at;
    if (!isEmailVerified) {
      // Send verification email via Supabase OTP
      try {
        const { error: otpError } = await supabase.auth.resend({
          type: 'signup',
          email: user.email!,
        });
        if (otpError) console.error('Error sending verification email:', otpError);
      } catch (e) {
        console.error('Failed to send verification:', e);
      }

      Alert.alert(
        'Email Verification Required',
        'To apply as a Dorm Owner, your email must be verified. We have sent a verification link to your email address. Please verify and try again.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: 'pending_owner' })
        .eq('profile_id', user.id);

      if (error) throw error;

      setProfile((prev: any) => ({ ...prev, role: 'pending_owner' }));
      Alert.alert(
        'Application Submitted',
        'Your application for Dorm Owner status has been submitted and is pending admin verification.'
      );
    } catch (error: any) {
      console.error('Error applying for owner:', error);
      Alert.alert('Error', error.message);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      router.replace('/(auth)/sign-in' as any);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={AppColors.accent} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.notSignedIn}>Please sign in to view your profile</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.title}>My Profile</Text>
        {!editMode && (
          <Pressable style={styles.editButton} onPress={() => setEditMode(true)}>
            <Text style={styles.editButtonText}>Edit</Text>
          </Pressable>
        )}
      </View>

      {editMode ? (
        <View style={styles.editForm}>
          <Text style={styles.formLabel}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={editedProfile.full_name || ''}
            onChangeText={(text) => setEditedProfile((prev: any) => ({ ...prev, full_name: text }))}
            placeholder="Enter your full name"
          />

          <Text style={styles.formLabel}>Username</Text>
          <TextInput
            style={styles.input}
            value={editedProfile.username || ''}
            onChangeText={(text) => setEditedProfile((prev: any) => ({ ...prev, username: text }))}
            placeholder="Choose a username"
          />

          <Text style={styles.formLabel}>Avatar URL</Text>
          <TextInput
            style={styles.input}
            value={editedProfile.avatar_url || ''}
            onChangeText={(text) => setEditedProfile((prev: any) => ({ ...prev, avatar_url: text }))}
            placeholder="URL to your avatar image"
          />

          <Pressable style={styles.saveButton} onPress={handleSaveProfile}>
            <Text style={styles.saveButtonText}>Save Profile</Text>
          </Pressable>
          <Pressable style={styles.cancelButton} onPress={() => setEditMode(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.profileContent}>
          {typeof profile?.avatar_url === 'string' && profile.avatar_url.length > 0 ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={styles.avatar}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>
                {(profile?.full_name || profile?.email || '').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <Text style={styles.name}>{profile?.full_name || profile?.email || 'Anonymous'}</Text>
          <Text style={styles.username}>@{profile?.username || 'username'}</Text>
          <Text style={styles.email}>{profile?.email || 'No email'}</Text>

          {/* Role Badge */}
          <View style={[
            styles.badge,
            profile?.role === 'admin' && styles.adminBadge,
            profile?.role === 'owner' && styles.ownerBadge,
            profile?.role === 'pending_owner' && styles.pendingBadge,
          ]}>
            <Text style={[
              styles.badgeText,
              profile?.role === 'admin' && styles.adminBadgeText,
              profile?.role === 'owner' && styles.ownerBadgeText,
              profile?.role === 'pending_owner' && styles.pendingBadgeText,
            ]}>
              {profile?.role === 'admin' && 'Administrator'}
              {profile?.role === 'owner' && 'Verified Dorm Owner'}
              {profile?.role === 'pending_owner' && 'Pending Verification'}
              {(profile?.role === 'user' || !profile?.role) && 'Standard User'}
            </Text>
          </View>

          {/* Stats Container (only for owners/admins) */}
          {(profile?.role === 'owner' || profile?.role === 'admin') && (
            <View style={styles.statsContainer}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>Dorms Listed</Text>
                <Text style={styles.statValue}>{dorms.length}</Text>
              </View>
            </View>
          )}

          {/* Owner Application Banner */}
          {profile?.role === 'user' && (
            <View style={styles.bannerContainer}>
              <Text style={styles.bannerTitle}>Become a Dorm Owner</Text>
              <Text style={styles.bannerText}>Apply for owner verification to list and manage your own dormitories on Room Scout.</Text>
              <Pressable style={styles.bannerButton} onPress={handleApplyForOwner}>
                <Text style={styles.bannerButtonText}>Apply for Dorm Owner</Text>
              </Pressable>
            </View>
          )}

          {profile?.role === 'pending_owner' && (
            <View style={[styles.bannerContainer, styles.pendingBanner]}>
              <Text style={[styles.bannerTitle, styles.pendingBannerTitle]}>Verification Pending</Text>
              <Text style={[styles.bannerText, styles.pendingBannerText]}>
                Your application for Dorm Owner verification is currently being reviewed by an administrator.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Dorm Listings Section (Only visible for owners/admins) */}
      {(profile?.role === 'owner' || profile?.role === 'admin') ? (
        <View style={styles.sectionsContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Dorm Listings</Text>
            <Pressable style={styles.addDormButton} onPress={() => router.push('/add-dorm' as any)}>
              <Text style={styles.addDormButtonText}>+ Add Dorm</Text>
            </Pressable>
          </View>

          {dorms.length > 0 ? (
            <View style={styles.dormListContent}>
              {dorms.map((item: any) => (
                <View key={item.dorm_id} style={styles.dormItem}>
                  <Text style={styles.dormName}>{item.name}</Text>
                  <Text style={styles.dormPrice}>₱{item.price}/month</Text>
                  <Text style={styles.dormStatus}>
                    {item.available ? 'Available' : 'Not Available'}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noDormsText}>You haven't listed any dorms yet. Add your first dorm!</Text>
          )}
        </View>
      ) : (
        <View style={styles.noAccessContainer}>
          <Text style={styles.noAccessText}>
            Apply for Dorm Owner status above to start listing and managing dormitories on Room Scout.
          </Text>
        </View>
      )}

      <View style={styles.signOutContainer}>
        {/* Notifications Button */}
        <View style={{ marginBottom: 12 }}>
          <Pressable
            style={styles.notificationsButton}
            onPress={() => router.push('/notifications' as any)}
          >
            <Text style={styles.notificationsButtonText}>Notifications</Text>
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Owner Dashboard Button */}
        {(profile?.role === 'owner' || profile?.role === 'admin') && (
          <View style={{ marginBottom: 12 }}>
            <Pressable
              style={styles.ownerButton}
              onPress={() => router.push('/owner-panel' as any)}
            >
              <Text style={styles.ownerButtonText}>Owner Dashboard</Text>
            </Pressable>
          </View>
        )}

        {profile?.role === 'admin' && (
          <View style={{ marginBottom: 12 }}>
            <Pressable
              style={styles.adminButton}
              onPress={() => router.push('/admin' as any)}
            >
              <Text style={styles.adminButtonText}>Admin Dashboard</Text>
            </Pressable>
          </View>
        )}
        <Pressable style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: AppColors.text,
    letterSpacing: -0.5,
  },
  editButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  editButtonText: {
    color: AppColors.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppColors.background,
  },
  notSignedIn: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
    color: AppColors.textSecondary,
  },
  editForm: {
    padding: 20,
    backgroundColor: AppColors.surface,
    marginHorizontal: 16,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
    color: AppColors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    backgroundColor: AppColors.input,
    borderRadius: BorderRadius.md,
    padding: 12,
    fontSize: 16,
    color: AppColors.text,
    marginBottom: 8,
  },
  saveButton: {
    backgroundColor: AppColors.accent,
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveButtonText: {
    color: AppColors.white,
    fontWeight: '700',
    fontSize: 16,
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelButtonText: {
    color: AppColors.textMuted,
    fontWeight: '600',
    fontSize: 16,
  },
  profileContent: {
    padding: 20,
    backgroundColor: AppColors.surface,
    marginHorizontal: 16,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
    alignItems: 'center',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: AppColors.border,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: AppColors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: AppColors.border,
  },
  avatarInitials: {
    fontSize: 36,
    fontWeight: '700',
    color: AppColors.accent,
  },
  name: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
    color: AppColors.text,
  },
  username: {
    fontSize: 15,
    color: AppColors.accent,
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: AppColors.textSecondary,
    marginBottom: 20,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 20,
  },
  statBox: {
    alignItems: 'center',
    padding: 14,
    backgroundColor: AppColors.surfaceElevated,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
    minWidth: 120,
  },
  statLabel: {
    fontSize: 12,
    color: AppColors.textMuted,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: AppColors.text,
  },
  sectionsContainer: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: AppColors.text,
  },
  addDormButton: {
    backgroundColor: AppColors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
  },
  addDormButtonText: {
    color: AppColors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  dormItem: {
    backgroundColor: AppColors.surface,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  dormName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
    color: AppColors.text,
  },
  dormPrice: {
    fontSize: 15,
    color: AppColors.accent,
    fontWeight: '600',
    marginBottom: 4,
  },
  dormStatus: {
    fontSize: 13,
    color: AppColors.textSecondary,
  },
  dormListContent: {
    paddingBottom: 20,
  },
  noDormsText: {
    textAlign: 'center',
    padding: 40,
    color: AppColors.textMuted,
    fontStyle: 'italic',
  },
  signOutContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  scrollContent: {
    flexGrow: 1,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: AppColors.surfaceElevated,
    marginTop: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: AppColors.textSecondary,
  },
  adminBadge: {
    backgroundColor: AppColors.errorBg,
    borderColor: AppColors.error,
  },
  adminBadgeText: {
    color: AppColors.error,
  },
  ownerBadge: {
    backgroundColor: AppColors.successBg,
    borderColor: AppColors.success,
  },
  ownerBadgeText: {
    color: AppColors.success,
  },
  pendingBadge: {
    backgroundColor: AppColors.warningBg,
    borderColor: AppColors.warning,
  },
  pendingBadgeText: {
    color: AppColors.warning,
  },
  bannerContainer: {
    width: '100%',
    padding: 16,
    borderRadius: BorderRadius.md,
    backgroundColor: AppColors.surfaceElevated,
    borderColor: AppColors.border,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 16,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: AppColors.text,
    marginBottom: 4,
  },
  bannerText: {
    fontSize: 14,
    color: AppColors.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  bannerButton: {
    backgroundColor: AppColors.accent,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.sm,
    alignSelf: 'flex-start',
  },
  bannerButtonText: {
    color: AppColors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  pendingBanner: {
    backgroundColor: AppColors.warningBg,
    borderColor: AppColors.warning,
  },
  pendingBannerTitle: {
    color: AppColors.warning,
  },
  pendingBannerText: {
    color: AppColors.textSecondary,
  },
  noAccessContainer: {
    padding: 24,
    marginHorizontal: 16,
    backgroundColor: AppColors.surface,
    borderRadius: BorderRadius.md,
    borderColor: AppColors.borderSubtle,
    borderWidth: 1,
    alignItems: 'center',
  },
  noAccessText: {
    textAlign: 'center',
    color: AppColors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  adminButton: {
    backgroundColor: AppColors.accentMuted,
    padding: 14,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminButtonText: {
    color: AppColors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  notificationsButton: {
    backgroundColor: AppColors.surfaceElevated,
    padding: 14,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  notificationsButtonText: {
    color: AppColors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  unreadBadge: {
    backgroundColor: AppColors.error,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unreadBadgeText: {
    color: AppColors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  ownerButton: {
    backgroundColor: AppColors.accent,
    padding: 14,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownerButtonText: {
    color: AppColors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  signOutButton: {
    backgroundColor: AppColors.errorBg,
    borderWidth: 1,
    borderColor: AppColors.error,
    padding: 14,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  signOutButtonText: {
    color: AppColors.error,
    fontSize: 16,
    fontWeight: '700',
  },
});