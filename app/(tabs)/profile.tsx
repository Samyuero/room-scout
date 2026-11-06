import { ErrorToast, showError } from '@/components/error-toast';
import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, TextInput, Alert, Pressable, ScrollView, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { AppColors, BorderRadius } from '@/constants/theme';
import { getSafeImageExtension, uploadImage } from '@/utils/imageUpload';
import { LeafletMapView } from '@/components/leaflet-map-view';
import { UCLM_COORDINATES } from '@/constants/map';
import { useDiscovery } from '@/context/discovery-context';
import { useNotifications } from '@/context/notification-context';

export default function Profile() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshPreferences } = useDiscovery();
  const [profile, setProfile] = useState<any>(null);
  const [dormCount, setDormCount] = useState(0);
  const [listingsOpen, setListingsOpen] = useState(false);
  const [dorms, setDorms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editedProfile, setEditedProfile] = useState<any>({});
  const { unreadCount, requestUnreadCount, tenantUnreadCount } = useNotifications();
  const [showRequestsIcon, setShowRequestsIcon] = useState(true);
  useEffect(() => {
    if (requestUnreadCount > 0) { setShowRequestsIcon(true); return; }
    const timer = setInterval(() => setShowRequestsIcon((current) => !current), 5000);
    return () => clearInterval(timer);
  }, [requestUnreadCount]);
  const [avatarUri, setAvatarUri] = useState('');
  const [saving, setSaving] = useState(false);
  const loadedProfileId = useRef<string | null>(null);

  useFocusEffect(useCallback(() => {
    if (!user?.id) return;
    const reload = async () => {
      const { data, count, error } = await supabase.from('dorms').select('*', { count: 'exact' }).eq('owner_id', user.id).order('created_at', { ascending: false });
      if (!error) { setDorms(data || []); setDormCount(count || 0); }
    };
    void reload();
    const channel = supabase.channel('profile-dorm-list-' + user.id + '-' + Date.now()).on('postgres_changes', { event: '*', schema: 'public', table: 'dorms', filter: 'owner_id=eq.' + user.id }, () => void reload()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user]));

  // Dedicated preferences modal state
  const [prefModalVisible, setPrefModalVisible] = useState(false);
  const [prefForm, setPrefForm] = useState<{
    budget_min: string;
    budget_max: string;
    preferred_location: string;
    radius_km: string;
    parking: string;
    pet_friendly: boolean;
    latitude: number;
    longitude: number;
  }>({
    budget_min: '',
    budget_max: '',
    preferred_location: '',
    radius_km: '5',
    parking: '',
    pet_friendly: false,
    latitude: Number(UCLM_COORDINATES.latitude),
    longitude: Number(UCLM_COORDINATES.longitude),
  });
  const [extraPreferences, setExtraPreferences] = useState<{ amenities: string[]; utilities: string[]; house_rules: string[]; gender_policy: string; curfew: string; room_type: string; lgu_certified: boolean; furnished: boolean }>({ amenities: [], utilities: [], house_rules: [], gender_policy: '', curfew: '', room_type: '', lgu_certified: false, furnished: false });
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [savingPref, setSavingPref] = useState(false);

  useFocusEffect(useCallback(() => {
    const loadProfile = async () => {
      if (!user) return;

      if (loadedProfileId.current !== user.id) setLoading(true);
      try {
        // Determine which role table the user belongs to
        const [renterRes, ownerRes, adminRes] = await Promise.all([
          supabase.from('renters').select('*').eq('renter_id', user.id).maybeSingle(),
          supabase.from('owners').select('*').eq('owner_id', user.id).maybeSingle(),
          supabase.from('admins').select('*').eq('admin_id', user.id).maybeSingle()
        ]);
        if (renterRes.error || ownerRes.error || adminRes.error) throw renterRes.error || ownerRes.error || adminRes.error;

        let userRole = 'renter';
        let profileData = renterRes.data;
        if (adminRes.data) {
          userRole = 'admin';
          profileData = adminRes.data;
        } else if (ownerRes.data) {
          userRole = 'owner';
          profileData = ownerRes.data;
        }

        // If owner, check verification status
        let verificationStatus = null;
        if (userRole === 'owner') {
          const { data: verData } = await supabase
            .from('owner_verifications')
            .select('status')
            .eq('user_id', user.id)
            .maybeSingle();
          verificationStatus = verData?.status || null;
        }

        // Get user's dorms (only for owners)
        const { data: dormsData, count: totalDorms, error: dormsError } = await supabase
          .from('dorms')
          .select('*', { count: 'exact' })
          .eq('owner_id', user.id);

        if (dormsError) throw dormsError;

        const mergedProfile = profileData ? {
          ...profileData,
          email: user.email,
          role: userRole,
          verification_status: verificationStatus,
        } : {
          renter_id: user.id, // Fallback ID property
          email: user.email,
          full_name: user.user_metadata?.full_name || '',
          username: user.user_metadata?.username || '',
          avatar_url: user.user_metadata?.avatar_url || '',
          role: userRole,
          verification_status: verificationStatus,
        };

        mergedProfile.behavior_preferences = renterRes.data?.behavior_preferences || {};
        mergedProfile.avatar_url = mergedProfile.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
        setProfile(mergedProfile);
        setDorms(dormsData || []);
        setDormCount(totalDorms || 0);
        setEditedProfile(mergedProfile);
        loadedProfileId.current = user.id;

      } catch (error) {
        console.error('Error loading profile:', error);
        showError('Profile could not load', error instanceof Error ? error.message : 'Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]));

  const handleSaveProfile = async () => {
    if (!user) return;

    const username = String(editedProfile.username || '').trim();
    const fullName = String(editedProfile.full_name || '').trim();

    if (username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      showError('Invalid username', 'Use 3–30 letters, numbers, or underscores.');
      return;
    }
    if (!fullName || fullName.length > 80) {
      showError('Invalid name', 'Enter a name between 1 and 80 characters.');
      return;
    }

    const phone = String(editedProfile.phone_number || '').trim();
    if (phone && !/^\+?[0-9][0-9 ()-]{6,19}$/.test(phone)) { showError('Invalid phone number', 'Enter a valid contact number.'); return; }
    setSaving(true);
    try {
      const avatarUrl = avatarUri
        ? await uploadImage(`${user.id}/avatar/${Date.now()}.${getSafeImageExtension(avatarUri)}`, avatarUri)
        : editedProfile.avatar_url;
      // Update Supabase auth user metadata
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          full_name: fullName,
          username,
          avatar_url: avatarUrl,
        }
      });
      if (metadataError) throw metadataError;

      // Determine the right table to update based on role
      const table = profile?.role === 'admin' ? 'admins' : profile?.role === 'owner' ? 'owners' : 'renters';
      const idColumn = profile?.role === 'admin' ? 'admin_id' : profile?.role === 'owner' ? 'owner_id' : 'renter_id';
      const updates: Record<string, unknown> = {
        full_name: fullName,
        username,
        avatar_url: avatarUrl,
        phone_number: phone || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(table)
        .update(updates)
        .eq(idColumn, user.id);

      if (error) throw error;

      setEditMode(false);
      const saved = { ...editedProfile, ...updates };
      setProfile(saved);
      setEditedProfile(saved);
      setAvatarUri('');
      Alert.alert('Profile saved', 'Your profile details were updated.');
    } catch (error) {
      console.error('Error saving profile:', error);
      showError('Could not save profile', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Preference Modal Handlers
  const handleOpenPrefModal = () => {
    const prefs = profile?.behavior_preferences || {};
    setExtraPreferences({ amenities: prefs.amenities || [], utilities: prefs.utilities || [], house_rules: prefs.house_rules || [], gender_policy: prefs.gender_policy || '', curfew: prefs.curfew || '', room_type: prefs.room_type || '', lgu_certified: Boolean(prefs.lgu_certified), furnished: Boolean(prefs.furnished) });
    setPrefForm({
      budget_min: prefs.budget_min ? String(prefs.budget_min) : '',
      budget_max: prefs.budget_max ? String(prefs.budget_max) : '',
      preferred_location: prefs.preferred_location || '',
      radius_km: String(prefs.radius_km || 5),
      parking: prefs.parking || '',
      pet_friendly: Boolean(prefs.pet_friendly),
      latitude: Number(prefs.latitude) || UCLM_COORDINATES.latitude,
      longitude: Number(prefs.longitude) || UCLM_COORDINATES.longitude,
    });
    setShowMapPicker(false);
    setPrefModalVisible(true);
  };

  const handlePickMapLocation = async (coords: { latitude: number; longitude: number }) => {
    setPrefForm((prev) => ({
      ...prev,
      latitude: coords.latitude,
      longitude: coords.longitude,
    }));

    // Coordinates are the source of truth; reverse geocoding is not required to save a pin.
    setPrefForm((prev) => ({ ...prev, preferred_location: 'Pinned area (' + coords.latitude.toFixed(4) + ', ' + coords.longitude.toFixed(4) + ')' }));
  };

  const handleSavePreferencesOnly = async () => {
    if (!user) return;
    const bMin = prefForm.budget_min.trim() ? Number(prefForm.budget_min) : null;
    const bMax = prefForm.budget_max.trim() ? Number(prefForm.budget_max) : null;

    if ((bMin !== null && !Number.isFinite(bMin)) || (bMax !== null && !Number.isFinite(bMax))) {
      showError('Invalid budget', 'Enter a valid amount in pesos.');
      return;
    }

    if (bMin !== null && bMin < 0) {
      showError('Invalid budget', 'Minimum budget cannot be negative.');
      return;
    }
    if (bMax !== null && bMax < 0) {
      showError('Invalid budget', 'Maximum budget cannot be negative.');
      return;
    }
    if (bMin !== null && bMax !== null && bMin > bMax) {
      showError('Invalid budget', 'Maximum budget must be greater than or equal to minimum budget.');
      return;
    }

    const radius = Number(prefForm.radius_km);
    if (!Number.isFinite(radius) || radius <= 0 || radius > 20000) { showError('Invalid radius', 'Enter a positive distance in kilometers.'); return; }
    setSavingPref(true);
    try {
      const newPreferences = {
        ...extraPreferences,
        budget_min: bMin,
        budget_max: bMax,
        preferred_location: prefForm.preferred_location.trim().slice(0, 120),
        latitude: prefForm.latitude,
        longitude: prefForm.longitude,
        radius_km: radius,
        pet_friendly: Boolean(prefForm.pet_friendly),
        parking: prefForm.parking,
      };

      const { error } = await supabase
        .from('renters')
        .upsert({
          renter_id: user.id,
          behavior_preferences: newPreferences,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'renter_id' })
        .select('renter_id')
        .single();

      if (error) throw error;

      const updatedProfile = {
        ...profile,
        behavior_preferences: newPreferences,
      };
      setProfile(updatedProfile);
      setEditedProfile(updatedProfile);
      await refreshPreferences();
      setPrefModalVisible(false);
      Alert.alert('Preferences Saved', 'Your dorm preferences have been successfully updated.');
    } catch (err: any) {
      console.error('Error saving preferences:', err);
      showError('Could not save preferences', err.message || 'Please try again.');
    } finally {
      setSavingPref(false);
    }
  };

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.75 });
    if (!result.canceled) setAvatarUri(result.assets[0].uri);
  };

  const handleApplyForOwner = async () => {
    if (!user) return;

    // Route to the owner verification screen
    router.push('/(auth)/owner-verification' as any);
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
          <TextInput placeholderTextColor={AppColors.placeholder}
            style={styles.input}
            value={editedProfile.full_name || ''}
            onChangeText={(text) => setEditedProfile((prev: any) => ({ ...prev, full_name: text }))}
            placeholder="Enter your full name"
          />

          <Text style={styles.formLabel}>Username</Text>
          <TextInput placeholderTextColor={AppColors.placeholder}
            style={styles.input}
            value={editedProfile.username || ''}
            onChangeText={(text) => setEditedProfile((prev: any) => ({ ...prev, username: text }))}
            placeholder="Choose a username"
          />

          <Text style={styles.formLabel}>Phone number</Text>
          <TextInput placeholderTextColor={AppColors.placeholder} style={styles.input} keyboardType="phone-pad" maxLength={21} value={editedProfile.phone_number || ''} onChangeText={(phone_number) => setEditedProfile((current: any) => ({ ...current, phone_number }))} placeholder="Contact number" />
          <Text style={styles.formLabel}>Profile photo</Text>
          <Pressable onPress={pickAvatar} style={styles.photoPicker}>
            <Image source={avatarUri ? { uri: avatarUri } : editedProfile.avatar_url ? { uri: editedProfile.avatar_url } : require('../../assets/placeholder.jpg')} style={styles.photoPickerImage} />
            <Text style={styles.photoPickerText}>{avatarUri || editedProfile.avatar_url ? 'Change photo' : 'Choose from gallery'}</Text>
          </Pressable>

          <Pressable disabled={saving} style={styles.saveButton} onPress={handleSaveProfile}>
            <Text style={styles.saveButtonText}>{saving ? 'Uploading…' : 'Save Profile'}</Text>
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>{profile?.role === 'owner' && profile?.verification_status === 'approved' && <Ionicons name="checkmark-circle" size={17} color={AppColors.accent} />}<Text style={styles.username}>@{profile?.username || 'username'}</Text></View>
          <Text style={styles.email}>{profile?.email || 'No email'}</Text>

          {/* Role Badge */}
          <View style={[
            styles.badge,
            profile?.role === 'admin' && styles.adminBadge,
            profile?.role === 'owner' && styles.ownerBadge,
          ]}>
            <Text style={[
              styles.badgeText,
              profile?.role === 'admin' && styles.adminBadgeText,
              profile?.role === 'owner' && styles.ownerBadgeText,
            ]}>
              {profile?.role === 'admin' && 'Administrator'}
              {profile?.role === 'owner' && (profile?.verification_status === 'approved' ? 'Dorm Owner' : profile?.verification_status === 'pending' ? 'Pending Verification' : 'Dorm Owner')}
              {profile?.role === 'renter' && 'Renter'}
            </Text>
          </View>

          {profile && (
            <View style={styles.preferenceSummary}>
              <View style={styles.preferenceSummaryHeader}>
                <Text style={styles.preferenceSummaryTitle}>My dorm preferences</Text>
                <Pressable style={styles.editPrefButton} onPress={handleOpenPrefModal}>
                  <Ionicons name="pencil" size={13} color={AppColors.accent} />
                  <Text style={styles.editPrefButtonText}>Edit</Text>
                </Pressable>
              </View>
              <Text style={styles.preferenceSummaryText}>
                {profile?.behavior_preferences?.budget_min || profile?.behavior_preferences?.budget_max
                  ? `₱${Number(profile?.behavior_preferences?.budget_min || 0).toLocaleString('en-PH')} – ₱${Number(profile?.behavior_preferences?.budget_max || 0).toLocaleString('en-PH')}`
                  : 'Any budget'}
                {' · '}{profile?.behavior_preferences?.preferred_location || 'Any location'}
                {' · '}{profile?.behavior_preferences?.radius_km || 5} km
                {profile?.behavior_preferences?.parking ? ` · ${profile.behavior_preferences.parking} parking` : ''}
                {profile?.behavior_preferences?.pet_friendly ? ' · Pet-friendly' : ''}
              </Text>
            </View>
          )}

          {/* Owner Verification Banner (only for owners) */}
          {profile?.role === 'owner' && (
            <>
              {profile?.verification_status === 'pending' ? (
                <View style={[styles.bannerContainer, styles.pendingBanner]}>
                  <Text style={[styles.bannerTitle, styles.pendingBannerTitle]}>Verification Pending</Text>
                  <Text style={[styles.bannerText, styles.pendingBannerText]}>
                    Your application for Dorm Owner verification is currently being reviewed by an administrator.
                  </Text>
                </View>
              ) : profile?.verification_status !== 'approved' ? (
                <View style={styles.bannerContainer}>
                  <Text style={styles.bannerTitle}>Dorm Owner Verification Required</Text>
                  <Text style={styles.bannerText}>Submit your government ID or business permit to get verified and start adding listings.</Text>
                  <Pressable style={styles.bannerButton} onPress={handleApplyForOwner}>
                    <Text style={styles.bannerButtonText}>Request Dorm Owner</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </View>
      )}

      {/* Dorm Listings Section (Only visible for owners/admins) */}
      {(profile?.role === 'owner' || profile?.role === 'admin') && (
        <View style={styles.sectionsContainer}>
          <View style={styles.sectionHeader}>
            <Pressable onPress={() => setListingsOpen((value) => !value)} accessibilityLabel="Toggle my dorm listings" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}><Text style={[styles.sectionTitle, { flexShrink: 1 }]}>My Dorm Listings ({dormCount})</Text><Ionicons name={listingsOpen ? "chevron-up" : "chevron-down"} size={17} color={AppColors.textSecondary} /></Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityLabel={showRequestsIcon ? 'Rental requests' : 'Current tenants'} onPress={() => router.push({ pathname: '/owner-panel', params: { tab: showRequestsIcon ? 'requests' : 'tenants' } } as never)} style={{ padding: 8 }}>
              <Ionicons name={showRequestsIcon ? 'mail-outline' : 'people-outline'} size={23} color={AppColors.accent} />
              {(showRequestsIcon ? requestUnreadCount > 0 : tenantUnreadCount > 0) && <View style={styles.newActivityDot} />}
            </Pressable>
            <Pressable style={styles.addDormButton} onPress={() => router.push('/add-dorm' as any)}>
              <Text style={styles.addDormButtonText}>+ Add Dorm</Text>
            </Pressable>
            </View>
          </View>

          {listingsOpen && (dorms.length > 0 ? (
            <View style={styles.dormListContent}>
              {dorms.map((item: any) => (
                <Pressable key={item.dorm_id} onPress={() => router.push(`/(tabs)/${item.dorm_id}` as never)} style={styles.dormItem}>
                  <Text style={styles.dormName}>{item.name}</Text>
                  <Text style={styles.dormPrice}>₱{item.price}/month</Text>
                  <Text style={styles.dormStatus}>
                    {item.available ? 'Available' : 'Not Available'}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.noDormsText}>You haven&apos;t listed any dorms yet. Add your first dorm!</Text>
          ))}
        </View>
      )}

      <View style={styles.signOutContainer}>
        <View style={styles.accountActions}>
          <Pressable accessibilityRole="button" style={styles.accountAction} onPress={() => router.push('/booking-history' as never)}>
            <Ionicons name="calendar-outline" size={22} color={AppColors.accent} />
            <Text style={styles.accountActionText}>Bookings & history</Text>
            <Ionicons name="chevron-forward" size={18} color={AppColors.textSecondary} />
          </Pressable>
          {(profile?.role === 'owner' || profile?.role === 'admin') && <Pressable accessibilityRole="button" style={styles.accountAction} onPress={() => router.push('/tenant-history' as never)}>
            <Ionicons name="people-outline" size={22} color={AppColors.accent} />
            <Text style={styles.accountActionText}>Past tenants</Text>
            <Ionicons name="chevron-forward" size={18} color={AppColors.textSecondary} />
          </Pressable>}
          <Pressable accessibilityRole="button" style={styles.accountAction} onPress={() => router.push('/support' as never)}>
            <Ionicons name="help-buoy-outline" size={22} color={AppColors.accent} />
            <Text style={styles.accountActionText}>Report an issue & my tickets</Text>
            <Ionicons name="chevron-forward" size={18} color={AppColors.textSecondary} />
          </Pressable>
        </View>
        <View style={styles.profileLinks}>
          <Pressable style={styles.profileLink} onPress={() => router.push('/chat')}><MaterialCommunityIcons name="robot-happy-outline" size={29} color={AppColors.accent} /><Text style={styles.profileLinkText}>Dorm Assistant</Text></Pressable>
          {/* Hidden for now; keep the Settings route and shortcut ready to restore.
          <Pressable style={styles.profileLink} onPress={() => router.push('/(tabs)/settings')}><Ionicons name="settings-outline" size={26} color={AppColors.accent} /><Text style={styles.profileLinkText}>Settings</Text></Pressable>
          */}
          <Pressable style={styles.profileLink} onPress={() => router.push('/(tabs)/about-us')}><Ionicons name="information-circle-outline" size={26} color={AppColors.accent} /><Text style={styles.profileLinkText}>About SNAP</Text></Pressable>
        </View>
        {/* Notifications Button */}
        <View style={{ marginBottom: 12 }}>
          <Pressable
            style={styles.notificationsButton}
            onPress={() => router.push('/notifications' as any)}
          >
            <Text style={styles.notificationsButtonText}>Notifications</Text>
            {unreadCount > 0 && (
              <View style={[styles.newActivityDot, { position: 'relative', top: 0, right: 0 }]} />
            )}
          </Pressable>
        </View>

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
        <Pressable style={styles.notificationsButton} onPress={handleSignOut}>
          <Text style={styles.notificationsButtonText}>Sign Out</Text>
        </Pressable>
      </View>

      {/* Dedicated Dorm Preferences Modal */}
      <Modal
        visible={prefModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPrefModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Dorm Preferences</Text>
              <Pressable style={styles.modalCloseButton} onPress={() => setPrefModalVisible(false)}>
                <Ionicons name="close" size={22} color={AppColors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.modalBody}>
              <Text style={styles.preferencesHint}>
                Preferences are used to customize and rank public dorm listings for you.
              </Text>

              {/* Budget Inputs */}
              <View style={styles.preferenceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>Minimum Budget (₱)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={prefForm.budget_min}
                    onChangeText={(val) => setPrefForm((prev) => ({ ...prev, budget_min: val.replace(/\D/g, '') }))}
                    placeholder="₱0"
                    placeholderTextColor={AppColors.placeholder}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>Maximum Budget (₱)</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={prefForm.budget_max}
                    onChangeText={(val) => setPrefForm((prev) => ({ ...prev, budget_max: val.replace(/\D/g, '') }))}
                    placeholder="₱10,000"
                    placeholderTextColor={AppColors.placeholder}
                  />
                </View>
              </View>

              {/* Location Input & Map Picker Toggle */}
              <Text style={styles.formLabel}>Preferred Location</Text>
              <TextInput
                style={styles.input}
                maxLength={120}
                value={prefForm.preferred_location}
                onChangeText={(val) => setPrefForm((prev) => ({ ...prev, preferred_location: val }))}
                placeholder="e.g. Barangay, school, or workplace"
                placeholderTextColor={AppColors.placeholder}
              />

              <Pressable
                style={styles.mapPickerToggleButton}
                onPress={() => setShowMapPicker((prev) => !prev)}
              >
                <Ionicons name="map-outline" size={18} color={AppColors.accent} />
                <Text style={styles.mapPickerToggleText}>
                  {showMapPicker ? 'Hide map' : 'Choose area on map'}
                </Text>
              </Pressable>

              {showMapPicker && (
                <View style={styles.mapContainer}>
                  <Text style={styles.mapHintText}>
                    Tap anywhere on the map or drag the pin to select your preferred area:
                  </Text>
                  <View style={styles.mapWrapper}>
                    <LeafletMapView
                      dorms={[]}
                      center={{ latitude: prefForm.latitude, longitude: prefForm.longitude }}
                      radiusKm={Number(prefForm.radius_km) || 5}
                      userLocation={null}
                      showAnalytics={false}
                      pickerLocation={{ latitude: prefForm.latitude, longitude: prefForm.longitude }}
                      onPickLocation={handlePickMapLocation}
                    />
                  </View>
                  <Text style={styles.mapCoordsText}>
                    Selected Coordinates: {prefForm.latitude.toFixed(4)}, {prefForm.longitude.toFixed(4)}
                  </Text>
                </View>
              )}

              {/* Radius Input */}
              <Text style={styles.formLabel}>Search Radius (km)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={prefForm.radius_km}
                onChangeText={(val) => setPrefForm((prev) => ({ ...prev, radius_km: val.replace(/[^0-9.]/g, '').slice(0, 8) }))}
                placeholder="5"
                placeholderTextColor={AppColors.placeholder}
              />

              {/* Parking Preference */}
              <Text style={styles.formLabel}>Parking Requirement</Text>
              <View style={styles.preferenceChips}>
                {['None', 'Motorcycle', 'Car', 'Bicycle'].map((parking) => (
                  <Pressable
                    key={parking}
                    onPress={() =>
                      setPrefForm((prev) => ({ ...prev, parking: parking === 'None' ? '' : parking }))
                    }
                    style={[
                      styles.preferenceChip,
                      prefForm.parking === (parking === 'None' ? '' : parking) && styles.preferenceChipActive,
                    ]}
                  >
                    <Text style={styles.preferenceChipText}>{parking}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Pet-Friendly Chip */}
              <Pressable
                onPress={() => setPrefForm((prev) => ({ ...prev, pet_friendly: !prev.pet_friendly }))}
                style={[styles.preferenceChip, prefForm.pet_friendly && styles.preferenceChipActive, { marginTop: 8 }]}
              >
                <Text style={styles.preferenceChipText}>
                  {prefForm.pet_friendly ? '✓ Pet-friendly required' : '+ Pet-friendly required'}
                </Text>
              </Pressable>

<Text style={styles.formLabel}>Amenities</Text><View style={styles.preferenceChips}>{["Wi-Fi","Air Conditioning","Laundry","Kitchen","Study Area","Furnished","Security"].map((choice) => <Pressable key={choice} onPress={() => setExtraPreferences((current) => ({ ...current, amenities: current.amenities.includes(choice) ? current.amenities.filter((item) => item !== choice) : [...current.amenities, choice] }))} style={[styles.preferenceChip, extraPreferences.amenities.includes(choice) && styles.preferenceChipActive]}><Text style={styles.preferenceChipText}>{choice}</Text></Pressable>)}</View>
<Text style={styles.formLabel}>Utilities</Text><View style={styles.preferenceChips}>{["Water","Electricity","Internet","Generator"].map((choice) => <Pressable key={choice} onPress={() => setExtraPreferences((current) => ({ ...current, utilities: current.utilities.includes(choice) ? current.utilities.filter((item) => item !== choice) : [...current.utilities, choice] }))} style={[styles.preferenceChip, extraPreferences.utilities.includes(choice) && styles.preferenceChipActive]}><Text style={styles.preferenceChipText}>{choice}</Text></Pressable>)}</View>
<Text style={styles.formLabel}>House rules</Text><View style={styles.preferenceChips}>{["No smoking","No parties","Quiet hours","Visitors allowed","Keep common areas clean"].map((choice) => <Pressable key={choice} onPress={() => setExtraPreferences((current) => ({ ...current, house_rules: current.house_rules.includes(choice) ? current.house_rules.filter((item) => item !== choice) : [...current.house_rules, choice] }))} style={[styles.preferenceChip, extraPreferences.house_rules.includes(choice) && styles.preferenceChipActive]}><Text style={styles.preferenceChipText}>{choice}</Text></Pressable>)}</View>
<Text style={styles.formLabel}>Gender policy</Text><View style={styles.preferenceChips}>{["male","female","co-ed"].map((choice) => <Pressable key={choice} onPress={() => setExtraPreferences((current) => ({ ...current, gender_policy: current.gender_policy === choice ? '' : choice }))} style={[styles.preferenceChip, extraPreferences.gender_policy === choice && styles.preferenceChipActive]}><Text style={styles.preferenceChipText}>{choice}</Text></Pressable>)}</View>
<Text style={styles.formLabel}>Room type</Text><View style={styles.preferenceChips}>{["Bed space","Shared room","Private room","Studio","Apartment"].map((choice) => <Pressable key={choice} onPress={() => setExtraPreferences((current) => ({ ...current, room_type: current.room_type === choice ? '' : choice }))} style={[styles.preferenceChip, extraPreferences.room_type === choice && styles.preferenceChipActive]}><Text style={styles.preferenceChipText}>{choice}</Text></Pressable>)}</View>
<Text style={styles.formLabel}>Curfew</Text><View style={styles.preferenceChips}>{["No curfew","With curfew"].map((choice) => <Pressable key={choice} onPress={() => setExtraPreferences((current) => ({ ...current, curfew: current.curfew === choice ? '' : choice }))} style={[styles.preferenceChip, extraPreferences.curfew === choice && styles.preferenceChipActive]}><Text style={styles.preferenceChipText}>{choice}</Text></Pressable>)}</View>
<View style={styles.preferenceChips}>{(['lgu_certified', 'furnished'] as const).map((key) => <Pressable key={key} onPress={() => setExtraPreferences((current) => ({ ...current, [key]: !current[key] }))} style={[styles.preferenceChip, extraPreferences[key] && styles.preferenceChipActive]}><Text style={styles.preferenceChipText}>{key === 'lgu_certified' ? 'LGU certified' : 'Furnished'}</Text></Pressable>)}</View>
              {/* Save & Cancel Buttons */}
              <Pressable disabled={savingPref} style={styles.saveButton} onPress={handleSavePreferencesOnly}>
                {savingPref ? (
                  <ActivityIndicator color={AppColors.white} />
                ) : (
                  <Text style={styles.saveButtonText}>Save Preferences</Text>
                )}
              </Pressable>
              <Pressable style={styles.cancelButton} onPress={() => setPrefModalVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
        <ErrorToast />
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  accountActions: { marginBottom: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: AppColors.borderSubtle },
  accountAction: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: AppColors.borderSubtle },
  accountActionText: { flex: 1, flexShrink: 1, color: AppColors.text, fontSize: 15, fontWeight: '500' },
  newActivityDot: { position: 'absolute', top: 3, right: 3, width: 7, height: 7, borderRadius: 4, backgroundColor: AppColors.error },
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
  preferencesForm: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: AppColors.borderSubtle },
  preferencesTitle: { color: AppColors.text, fontSize: 17, fontWeight: '800' },
  preferencesHint: { color: AppColors.textMuted, fontSize: 11, marginTop: 3 },
  preferenceRow: { flexDirection: 'row', gap: 10 },
  preferenceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  preferenceChip: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 8, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: AppColors.border, backgroundColor: AppColors.surfaceElevated },
  preferenceChipActive: { borderColor: AppColors.accent, backgroundColor: AppColors.accentMuted },
  preferenceChipText: { color: AppColors.text, fontSize: 11, fontWeight: '700' },
  preferenceSummary: { width: '100%', padding: 12, marginTop: 4, borderRadius: BorderRadius.md, backgroundColor: AppColors.surfaceElevated },
  preferenceSummaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editPrefButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.full, backgroundColor: AppColors.surface, borderWidth: 1, borderColor: AppColors.border },
  editPrefButtonText: { color: AppColors.accent, fontSize: 12, fontWeight: '600' },
  preferenceSummaryTitle: { color: AppColors.text, fontSize: 13, fontWeight: '800' },
  preferenceSummaryText: { color: AppColors.textSecondary, fontSize: 11, marginTop: 4 },
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
    flexWrap: 'wrap',
    gap: 12,
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
  profileLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 14 },
  profileLink: { flexBasis: 82, flexGrow: 1, maxWidth: 120, minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  profileLinkText: { color: AppColors.text, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  photoPicker: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginTop: 6, marginBottom: 12, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: AppColors.border, backgroundColor: AppColors.surfaceElevated },
  photoPickerImage: { width: 58, height: 58, borderRadius: 29 },
  photoPickerText: { color: AppColors.accent, fontSize: 13, fontWeight: '700' },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: AppColors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: '90%',
    padding: 20,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.borderSubtle,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: AppColors.text,
  },
  modalCloseButton: {
    padding: 4,
  },
  modalBody: {
    marginTop: 12,
  },
  mapPickerToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: AppColors.surfaceElevated,
    borderWidth: 1,
    borderColor: AppColors.border,
    marginBottom: 12,
    marginTop: 4,
  },
  mapPickerToggleText: {
    color: AppColors.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  mapContainer: {
    marginBottom: 16,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: AppColors.border,
    padding: 10,
    backgroundColor: AppColors.surfaceElevated,
  },
  mapHintText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    marginBottom: 8,
  },
  mapWrapper: {
    height: 200,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  mapCoordsText: {
    color: AppColors.textMuted,
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
});
