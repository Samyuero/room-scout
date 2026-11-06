import { showError } from '@/components/error-toast';
import { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Button, Switch, ActivityIndicator, StyleSheet, ScrollView, Alert, Pressable, Image } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { ErrorNotice } from '@/components/error-notice';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useDiscovery } from '@/context/discovery-context';
import { LeafletMapView } from '@/components/leaflet-map-view';
import { isPhilippinesCoordinates, UCLM_COORDINATES } from '@/constants/map';
import { AppColors, BorderRadius } from '@/constants/theme';
import { getSafeImageExtension, uploadImage, uploadPrivateImage } from '@/utils/imageUpload';
import type { UserCoordinates } from '@/types/dorm';
import { getErrorMessage } from '@/lib/logger';


export default function AddDormScreen() {
  const router = useRouter();
  const { dormId } = useLocalSearchParams<{ dormId?: string }>();
  const isEditing = Boolean(dormId);
  const [savedDormId, setSavedDormId] = useState<string | null>(null);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [existingProof, setExistingProof] = useState('');
  const [occupiedTenants, setOccupiedTenants] = useState(0);
  const [requestLgu, setRequestLgu] = useState(false);
  const [lguProof, setLguProof] = useState('');
  const [lguCertified, setLguCertified] = useState(false);
  const [lguStatus, setLguStatus] = useState('');
  const { refresh } = useDiscovery();
  const { user } = useAuth();
  const { rankedDorms } = useDiscovery();
  
  const [userRole, setUserRole] = useState<string | null>(null);

  const [checkingRole, setCheckingRole] = useState(true);
  const [selectedImages, setSelectedImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [ownershipProofUri, setOwnershipProofUri] = useState('');
  const [uploadingImages, setUploadingImages] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    address: '',
    price: '',
    latitude: UCLM_COORDINATES.latitude.toString(),
    longitude: UCLM_COORDINATES.longitude.toString(),
    utilities: [] as string[],
    amenities: [] as string[],
    house_rules: [] as string[],
    gender_policy: 'co-ed',
    curfew: '',
    reservation_fee: '',
    parking_info: '',
    room_type: 'Private room',
    furnished: false,
    max_tenants: '1',
    contact_phone: '',
    contact_email: '',
    owner_display_name: '',
    pet_friendly: false,
    ownership_proof_url: '',
    available: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapCenter, setMapCenter] = useState<UserCoordinates>({
    latitude: UCLM_COORDINATES.latitude,
    longitude: UCLM_COORDINATES.longitude,
  });

  useEffect(() => {
    if (!dormId || !user?.id || checkingRole) return;
    void (async () => {
      let query = supabase.from('dorms').select('*').eq('dorm_id', dormId);
      if (userRole !== 'admin') query = query.eq('owner_id', user.id);
      const { data, error: loadError } = await query.single();
      if (loadError || !data) { setError('Your listing could not be loaded.'); return; }
      setExistingImages(data.images || []);
      setExistingProof(data.ownership_proof_url || '');
      setOccupiedTenants(Number(data.occupied_tenants || 0));
      setLguCertified(Boolean(data.lgu_certified));
      setMapCenter({ latitude: data.latitude, longitude: data.longitude });
      setForm((current) => ({ ...current, ...data, price: String(data.price), latitude: String(data.latitude), longitude: String(data.longitude), reservation_fee: String(data.reservation_fee || 0), max_tenants: String(data.max_tenants || 1), contact_phone: data.contact_phone || (userRole === 'admin' ? '' : current.contact_phone) || '', contact_email: data.contact_email || '' }));
      const { data: certification } = await supabase.from('lgu_certification_requests').select('status').eq('dorm_id', dormId).maybeSingle();
      setLguStatus(certification?.status || '');
    })();
  }, [dormId, user?.id, userRole, checkingRole]);

  useEffect(() => {
    if (isEditing) return;
    const getUserLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        let location = await Location.getLastKnownPositionAsync({});
        if (!location) {
          location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
          });
        }
        if (location?.coords && isPhilippinesCoordinates(location.coords)) {
          const coords = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setMapCenter(coords);
          setForm(prev => ({
            ...prev,
            latitude: coords.latitude.toString(),
            longitude: coords.longitude.toString(),
          }));
        } else {
          // Android Emulator default location (Mountain View, CA) detected -> force Opao, Mandaue City
          setMapCenter(UCLM_COORDINATES);
          setForm(prev => ({
            ...prev,
            latitude: UCLM_COORDINATES.latitude.toString(),
            longitude: UCLM_COORDINATES.longitude.toString(),
          }));
        }
      } catch (err) {
        console.warn('Location fix unavailable in add-dorm, defaulting to Opao, Mandaue:', err);
      }
    };
    getUserLocation();
  }, [isEditing]);

  useEffect(() => {
    const checkUserRole = async () => {
      if (!user) {
        setCheckingRole(false);
        return;
      }
      try {
        const { data: administrator, error: adminError } = await supabase.from('admins').select('admin_id').eq('admin_id', user.id).maybeSingle();
        if (adminError) throw adminError;
        if (administrator) { setUserRole('admin'); return; }
        const { data: ownerData } = await supabase
          .from('owners')
          .select('owner_id, full_name, username, phone_number')
          .eq('owner_id', user.id)
          .maybeSingle();

        if (ownerData) {
          const { data: verification } = await supabase
            .from('owner_verifications')
            .select('verification_id')
            .eq('user_id', user.id)
            .eq('status', 'approved')
            .limit(1)
            .maybeSingle();
          setUserRole(verification ? 'owner' : 'unverified-owner');
          setForm(prev => ({
            ...prev,
            owner_display_name: ownerData.full_name || ownerData.username || user.email || 'Verified Owner',
            contact_email: user.email || '',
            contact_phone: prev.contact_phone || ownerData.phone_number || '',
          }));
        } else {
          const { data: adminData } = await supabase
            .from('admins')
            .select('admin_id, full_name, username, phone_number')
            .eq('admin_id', user.id)
            .maybeSingle();
          setUserRole(adminData ? 'admin' : 'user');
          if (adminData) {
            setForm(prev => ({
              ...prev,
              owner_display_name: adminData.full_name || adminData.username || user.email || 'Administrator',
              contact_email: user.email || '',
              contact_phone: prev.contact_phone || adminData.phone_number || '',
            }));
          }
        }
      } catch (err) {
        console.error('Error fetching role in add-dorm:', err);
      } finally {
        setCheckingRole(false);
      }
    };

    checkUserRole();
  }, [user]);

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleToggle = (field: keyof typeof form) => {
    setForm(prev => ({ ...prev, [field]: !prev[field] as any }));
  };

  const toggleChoice = (field: 'utilities' | 'amenities' | 'house_rules', value: string) => {
    setForm((current) => {
      const isSelected = current[field].includes(value);
      return {
        ...current,
        [field]: isSelected
          ? current[field].filter((item) => item !== value)
          : [...current[field], value],
        ...(field === 'amenities' && value === 'Furnished'
          ? { furnished: !isSelected }
          : {}),
      };
    });
  };

  const pickImages = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showError('Permission Denied', 'We need access to your gallery to upload photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        allowsEditing: false,
        quality: 0.7,
      });

      if (!result.canceled && result.assets.length > 0) {
        const unsupported = result.assets.find((asset) => {
          const type = asset.mimeType?.toLowerCase();
          return type && !['image/jpeg', 'image/png', 'image/webp'].includes(type);
        });
        if (unsupported) {
          Alert.alert('Unsupported image', 'Use JPEG, PNG, or WebP photos only.');
          return;
        }
        const oversized = result.assets.find((asset) => (asset.fileSize || 0) > 8 * 1024 * 1024);
        if (oversized) {
          Alert.alert('Image too large', 'Each photo must be 8 MB or smaller.');
          return;
        }
        setSelectedImages((current) => {
          const merged = [...current, ...result.assets];
          const unique = merged.filter((asset, index) => merged.findIndex((item) => item.uri === asset.uri) === index);
          return unique.slice(0, 10);
        });
      }
    } catch (err) {
      console.error('Error picking images:', err);
      showError('Error', 'Failed to pick images');
    }
  };

  const pickOwnershipProof = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showError('Permission Denied', 'Gallery access is required to select ownership proof.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled) setOwnershipProofUri(result.assets[0].uri);
    } catch (err) {
      console.error('Error selecting ownership proof:', err);
      showError('Selection failed', 'The ownership proof image could not be selected.');
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUploadingImages(true);
    try {
      // Validate role
      if (userRole !== 'owner' && userRole !== 'admin') {
        throw new Error('Access Denied. Only verified Dorm Owners can list dormitories.');
      }

      // Precise field validations
      if (!form.name.trim()) throw new Error('Please enter a dormitory name.');
      if (!form.description.trim()) throw new Error('Please enter a description for the dormitory.');
      if (!form.address.trim()) throw new Error('Please enter an address.');
      if (!form.price.trim()) throw new Error('Please enter the monthly price.');
      if (form.contact_phone.trim() && !/^\+?[0-9][0-9 ()-]{6,19}$/.test(form.contact_phone.trim())) throw new Error('Enter a valid phone number using 7 to 20 digits.');
      if (!form.contact_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())) throw new Error('Enter a valid owner contact email.');
      if (!ownershipProofUri && !existingProof) throw new Error('Please upload proof of ownership.');
      if (selectedImages.length + existingImages.length === 0) throw new Error('Please select at least 1 photo of the dormitory from your gallery.');

      if (requestLgu && !lguProof) throw new Error('Upload LGU certification proof before requesting certification.');
      if (Number(form.max_tenants) < occupiedTenants) throw new Error('Capacity cannot be lower than the current number of tenants.');
      if (existingImages.length + selectedImages.length > 10) throw new Error('Keep up to 10 listing photos.');
      // Parse numeric fields
      const price = parseFloat(form.price);
      const latitude = parseFloat(form.latitude);
      const longitude = parseFloat(form.longitude);
      if (isNaN(price) || price <= 0) throw new Error('Monthly price must be a valid positive number.');
      if (isNaN(latitude) || isNaN(longitude)) throw new Error('Latitude and longitude must be valid map coordinates.');

      // Upload images to Supabase Storage
      if (!user?.id) {
        throw new Error('You must be signed in to add a dorm');
      }

      const uploadedUrls: string[] = [...existingImages];
      const uploadTimestamp = Date.now();
      for (const [index, image] of selectedImages.entries()) {
        const ext = getSafeImageExtension(image.fileName || image.uri, image.mimeType || undefined);
        const fileName = `${user.id}/listings/${uploadTimestamp}-${index}.${ext}`;
        try {
          const publicUrl = await uploadImage(fileName, image.uri, image.mimeType || undefined);
          uploadedUrls.push(publicUrl);
        } catch (uploadErr) {
          console.error('Failed to upload listing image:', { index, error: uploadErr });
          throw new Error(`Photo ${index + 1} could not upload. ${getErrorMessage(uploadErr)}`);
        }
      }

      const proofExt = getSafeImageExtension(ownershipProofUri);
      let ownershipProofUrl = existingProof;
      try {
        if (ownershipProofUri) ownershipProofUrl = await uploadPrivateImage(`${user.id}/ownership/${Date.now()}.${proofExt}`, ownershipProofUri);
      } catch (proofErr) {
        console.warn('Ownership proof upload failed:', proofErr);
        throw new Error(`Ownership proof could not upload securely. ${getErrorMessage(proofErr)}`);
      }

      const fullPayload: Record<string, any> = {
        name: form.name.trim(),
        description: form.description.trim(),
        address: form.address.trim(),
        price,
        latitude,
        longitude,
        utilities: form.utilities,
        amenities: form.amenities,
        house_rules: form.house_rules,
        gender_policy: form.gender_policy,
        curfew: form.curfew,
        reservation_fee: Number(form.reservation_fee) || 0,
        parking_info: form.parking_info.trim().slice(0, 120),
        room_type: form.room_type,
        furnished: form.furnished,
        max_tenants: Math.max(1, Math.min(500, Number(form.max_tenants) || 1)),
        occupied_tenants: 0,
        contact_phone: form.contact_phone.trim() || null,
        contact_email: (form.contact_email || user.email || '').trim(),
        owner_display_name: (form.owner_display_name || 'Verified Owner').trim(),
        pet_friendly: form.pet_friendly,
        ownership_proof_url: ownershipProofUrl || null,
        approval_status: 'approved',
        available: form.available,
        images: uploadedUrls,
        owner_id: user.id,
      };

      const listingId = dormId || savedDormId;
      if (listingId) {
        delete fullPayload.occupied_tenants;
        delete fullPayload.owner_id;
        delete fullPayload.approval_status;
      }
      let updateQuery = listingId ? supabase.from('dorms').update(fullPayload).eq('dorm_id', listingId) : null;
      if (updateQuery && userRole !== 'admin') updateQuery = updateQuery.eq('owner_id', user.id);
      const result = updateQuery
        ? await updateQuery.select('dorm_id').single()
        : await supabase.from('dorms').insert(fullPayload).select('dorm_id').single();
      if (result.error) throw result.error;
      setSavedDormId(result.data.dorm_id);
      if (requestLgu) {
        const proofPath = await uploadPrivateImage(user.id + '/lgu-certification/' + Date.now() + '.' + getSafeImageExtension(lguProof), lguProof);
        const { error: certificationError } = await supabase.rpc('submit_lgu_certification', { p_dorm_id: result.data.dorm_id, p_proof_path: proofPath });
        if (certificationError) throw new Error('Your listing was saved, but LGU proof could not be submitted. ' + certificationError.message);
      }
      await refresh();
      Alert.alert(isEditing ? 'Listing saved' : 'Listing published', requestLgu ? 'Your listing is visible now. The LGU badge will appear only after an administrator approves your proof.' : isEditing ? 'Your changes are saved.' : 'Your dormitory is now visible in RoomScout.');
      // Navigate back to home
      router.push('/(tabs)/home' as any);

    } catch (err: any) {
      const msg = err?.message || err?.error_description || getErrorMessage(err);
      showError('Listing could not be saved', msg);
    } finally {
      setLoading(false);
      setUploadingImages(false);
    }
  }, [form, ownershipProofUri, router, selectedImages, userRole, user, existingImages, existingProof, requestLgu, lguProof, occupiedTenants, isEditing, dormId, savedDormId, refresh]);


  if (checkingRole) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={AppColors.accent} />
        <Text style={{ marginTop: 10, color: AppColors.textSecondary }}>Checking permissions...</Text>
      </View>
    );
  }

  if (userRole !== 'owner' && userRole !== 'admin') {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.deniedTitle}>Access Denied</Text>
        <Text style={styles.deniedText}>
          You must be a verified Dorm Owner to add dormitories. Please submit an application in your Profile tab.
        </Text>
        <Button
          title="Go to Profile"
          onPress={() => router.push('/(tabs)/profile' as any)}
          color="#007aff"
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ErrorNotice message={error} />
      <ScrollView contentContainerStyle={styles.formContainer}>
        <ThemedText type="subtitle" themeColor="text" style={styles.sectionTitle}>
          {isEditing ? 'Edit Dormitory' : 'Add New Dormitory'}
        </ThemedText>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Name:</ThemedText>
          <TextInput placeholderTextColor={AppColors.placeholder}
            style={styles.input}
            placeholder="Enter dormitory name"
            value={form.name}
            onChangeText={(text) => handleChange('name', text)}
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Description:</ThemedText>
          <TextInput placeholderTextColor={AppColors.placeholder}
            style={[styles.input, { minHeight: 80 }]}
            placeholder="Enter description"
            value={form.description}
            onChangeText={(text) => handleChange('description', text)}
            multiline
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Address:</ThemedText>
          <TextInput placeholderTextColor={AppColors.placeholder}
            style={styles.input}
            placeholder="Enter address"
            value={form.address}
            onChangeText={(text) => handleChange('address', text)}
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Price per month:</ThemedText>
          <TextInput placeholderTextColor={AppColors.placeholder}
            style={styles.input}
            placeholder="Enter price"
            value={form.price}
            onChangeText={(text) => handleChange('price', text.replace(/[^0-9.]/g, ''))}
            keyboardType="numeric"
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Location on Map:</ThemedText>
          <Text style={styles.coordsText}>
            Selected Coords: {parseFloat(form.latitude).toFixed(5)}, {parseFloat(form.longitude).toFixed(5)}
          </Text>
          <View style={styles.mapWrapper}>
            <LeafletMapView
              dorms={rankedDorms}
              center={mapCenter}
              radiusKm={1}
              userLocation={null}
              showAnalytics={false}
              pickerLocation={{
                latitude: parseFloat(form.latitude) || UCLM_COORDINATES.latitude,
                longitude: parseFloat(form.longitude) || UCLM_COORDINATES.longitude,
              }}
              onPickLocation={({ latitude, longitude }) => {
                setMapCenter({ latitude, longitude });
                handleChange('latitude', latitude.toString());
                handleChange('longitude', longitude.toString());
              }}
            />
          </View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Utilities</ThemedText>
          <View style={styles.choiceWrap}>{['Water', 'Electricity', 'Internet', 'Generator'].map((item) => <Pressable key={item} onPress={() => toggleChoice('utilities', item)} style={[styles.choice, form.utilities.includes(item) && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}</View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Amenities</ThemedText>
          <View style={styles.choiceWrap}>{['Wi-Fi', 'Air Conditioning', 'Laundry', 'Kitchen', 'Study Area', 'Furnished', 'Security'].map((item) => <Pressable key={item} onPress={() => toggleChoice('amenities', item)} style={[styles.choice, form.amenities.includes(item) && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}</View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Room type</ThemedText>
          <View style={styles.choiceWrap}>{['Bed space', 'Shared room', 'Private room', 'Studio', 'Apartment'].map((item) => <Pressable key={item} onPress={() => handleChange('room_type', item)} style={[styles.choice, form.room_type === item && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}</View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">House rules</ThemedText>
          <View style={styles.choiceWrap}>{['No smoking', 'No parties', 'Quiet hours', 'Visitors allowed', 'Keep common areas clean'].map((item) => <Pressable key={item} onPress={() => toggleChoice('house_rules', item)} style={[styles.choice, form.house_rules.includes(item) && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}</View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Gender Policy:</ThemedText>
          <Picker
            style={styles.picker}
            selectedValue={form.gender_policy}
            onValueChange={(itemValue: string) => handleChange('gender_policy', itemValue)}
          >
            <Picker.Item label="Co-ed" value="co-ed" />
            <Picker.Item label="Male Only" value="male" />
            <Picker.Item label="Female Only" value="female" />
          </Picker>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Curfew / Operating Hours:</ThemedText>
          <Picker
            style={styles.picker}
            selectedValue={form.curfew}
            onValueChange={(itemValue: string) => handleChange('curfew', itemValue)}
          >
            <Picker.Item label="No Curfew / 24 Hours" value="No Curfew / 24 Hours" />
            <Picker.Item label="8:00 PM" value="8:00 PM" />
            <Picker.Item label="8:30 PM" value="8:30 PM" />
            <Picker.Item label="9:00 PM" value="9:00 PM" />
            <Picker.Item label="9:30 PM" value="9:30 PM" />
            <Picker.Item label="10:00 PM" value="10:00 PM" />
            <Picker.Item label="10:30 PM" value="10:30 PM" />
            <Picker.Item label="11:00 PM" value="11:00 PM" />
            <Picker.Item label="11:30 PM" value="11:30 PM" />
            <Picker.Item label="12:00 AM (Midnight)" value="12:00 AM (Midnight)" />
          </Picker>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Reservation fee:</ThemedText>
          <TextInput placeholderTextColor={AppColors.placeholder}
            style={styles.input}
            placeholder="Amount in PHP"
            value={form.reservation_fee}
            onChangeText={(text) => handleChange('reservation_fee', text.replace(/[^0-9.]/g, ''))}
            keyboardType="numeric"
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Parking:</ThemedText>
          <View style={styles.choiceWrap}>{['None', 'Motorcycle', 'Car', 'Bicycle'].map((item) => <Pressable key={item} onPress={() => handleChange('parking_info', item === 'None' ? '' : item)} style={[styles.choice, form.parking_info === (item === 'None' ? '' : item) && styles.choiceActive]}><Text style={styles.choiceText}>{item}</Text></Pressable>)}</View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Maximum tenants:</ThemedText>
          <TextInput placeholderTextColor={AppColors.placeholder} style={styles.input} keyboardType="number-pad" value={form.max_tenants} onChangeText={(text) => handleChange('max_tenants', text.replace(/\D/g, '').slice(0, 3))} />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Contact phone:</ThemedText>
          <TextInput placeholderTextColor={AppColors.placeholder} style={styles.input} keyboardType="phone-pad" maxLength={21} placeholder="e.g. 0917 123 4567" value={form.contact_phone} onChangeText={(text) => handleChange('contact_phone', text)} />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Pet friendly:</ThemedText>
          <View style={{ alignItems: 'flex-start', marginTop: 6 }}>
            <Switch value={form.pet_friendly} onValueChange={() => handleToggle('pet_friendly')} />
          </View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">{isEditing ? 'Proof of ownership' : 'Proof of ownership (required):'}</ThemedText>
          <Pressable style={styles.imageButton} onPress={pickOwnershipProof}><Text style={styles.imageButtonText}>{ownershipProofUri ? 'Change selected proof' : 'Choose proof image'}</Text></Pressable>
          {ownershipProofUri ? <Image source={{ uri: ownershipProofUri }} style={styles.proofPreview} /> : null}
          <Text style={styles.mapHint}>{isEditing ? 'Your existing ownership proof is retained unless you replace it.' : 'Ownership proof is stored privately. Your listing publishes immediately; LGU certification is reviewed separately.'}</Text>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Available:</ThemedText>
          <View style={{ alignItems: 'flex-start', marginTop: 6 }}>
            <Switch
              value={form.available}
              onValueChange={() => handleToggle('available')}
            />
          </View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Photos:</ThemedText>
          <Pressable style={styles.imageButton} onPress={pickImages}>
            <Text style={styles.imageButtonText}>Select up to 10 photos from gallery</Text>
          </Pressable>

          {existingImages.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false}>{existingImages.map((uri) => <View key={uri} style={styles.previewItem}><Image source={{ uri }} style={styles.previewImage} /><Pressable style={styles.removeBadge} onPress={() => setExistingImages((images) => images.filter((image) => image !== uri))}><Text style={styles.removeText}>X</Text></Pressable></View>)}</ScrollView>}
          {selectedImages.length > 0 && (
            <ScrollView horizontal style={styles.previewContainer} showsHorizontalScrollIndicator={false}>
              {selectedImages.map((image, index) => (
                <View key={image.uri} style={styles.previewItem}>
                  <Image source={{ uri: image.uri }} style={styles.previewImage} />
                  <Pressable style={styles.removeBadge} onPress={() => removeImage(index)}>
                    <Text style={styles.removeText}>X</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">LGU certification</ThemedText>
          {lguCertified ? <Text style={{ color: AppColors.success }}>LGU certified</Text> : isEditing && userRole === 'admin' ? <Text style={styles.mapHint}>The owner submits certification proof. Review that proof in Admin → Listings.</Text> : <>
            <Text style={styles.mapHint}>{lguStatus === 'pending' ? 'Your certification proof is under review.' : lguStatus === 'rejected' ? 'The previous proof was declined. You can upload a corrected certificate.' : 'Submit a valid LGU certificate for administrator review.'}</Text>
            <Pressable onPress={() => setRequestLgu((value) => !value)} style={styles.choice}><Text style={styles.choiceText}>{requestLgu ? '✓ Request LGU certification' : 'Request LGU certification'}</Text></Pressable>
            {requestLgu && <Pressable style={styles.imageButton} onPress={async () => { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 }); if (!result.canceled) setLguProof(result.assets[0].uri); }}><Text style={styles.imageButtonText}>{lguProof ? 'Change certificate image' : 'Choose LGU certificate'}</Text></Pressable>}
            {requestLgu && lguProof ? <Image source={{ uri: lguProof }} style={styles.proofPreview} /> : null}
          </>}
        </ThemedView>
        <Button
          title={loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Publish Listing'}
          onPress={handleSubmit}
          disabled={loading || uploadingImages}
          color="#007aff"
        />
        {(loading || uploadingImages) && (
          <ActivityIndicator size="small" color="#007aff" style={{ marginTop: 10 }} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
    padding: 16,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  deniedTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: AppColors.error,
    marginBottom: 10,
    textAlign: 'center',
  },
  deniedText: {
    fontSize: 16,
    color: AppColors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
    lineHeight: 24,
  },
  formContainer: {
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    backgroundColor: AppColors.input,
    borderRadius: BorderRadius.sm,
    padding: 12,
    marginTop: 4,
    color: AppColors.text,
    fontSize: 16,
  },
  mapHint: {
    fontSize: 12,
    color: AppColors.textMuted,
    marginTop: 2,
  },
  coordsText: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.accent,
    marginTop: 4,
    marginBottom: 8,
  },
  mapWrapper: {
    height: 220,
    width: '100%',
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  map: {
    flex: 1,
  },
  picker: {
    borderWidth: 1,
    borderColor: AppColors.inputBorder,
    backgroundColor: AppColors.input,
    borderRadius: BorderRadius.sm,
    marginTop: 4,
    height: 50,
    width: '100%',
    color: AppColors.text,
  },
  error: {
    backgroundColor: AppColors.errorBg,
    borderColor: AppColors.error,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: 12,
    marginBottom: 16,
  },
  imageButton: {
    backgroundColor: AppColors.surfaceElevated,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderStyle: 'dashed',
    borderRadius: BorderRadius.sm,
    padding: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  imageButtonText: {
    color: AppColors.accent,
    fontWeight: '600',
  },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  choice: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: BorderRadius.full, backgroundColor: AppColors.surfaceElevated, borderWidth: 1, borderColor: AppColors.border },
  choiceActive: { backgroundColor: AppColors.accentMuted, borderColor: AppColors.accent },
  choiceText: { color: AppColors.text, fontSize: 12, fontWeight: '600' },
  proofPreview: { width: '100%', height: 150, borderRadius: BorderRadius.md, marginTop: 10 },
  previewContainer: {
    marginTop: 10,
    flexDirection: 'row',
  },
  previewItem: {
    marginRight: 10,
    position: 'relative',
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
  },
  removeBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: AppColors.error,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: AppColors.white,
  },
  removeText: {
    color: AppColors.white,
    fontSize: 11,
    fontWeight: '700',
  },
});
