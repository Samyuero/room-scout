import { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Button, Switch, ActivityIndicator, StyleSheet, ScrollView, Alert, Pressable, Image } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useDiscovery } from '@/context/discovery-context';
import { LeafletMapView } from '@/components/leaflet-map-view';
import { isPhilippinesCoordinates, UCLM_COORDINATES } from '@/constants/map';
import { AppColors, BorderRadius } from '@/constants/theme';
import { uploadImage, uploadPrivateImage } from '@/utils/imageUpload';
import type { UserCoordinates } from '@/types/dorm';
import { getErrorMessage } from '@/lib/logger';


export default function AddDormScreen() {
  const router = useRouter();
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
  }, []);

  useEffect(() => {
    const checkUserRole = async () => {
      if (!user) {
        setCheckingRole(false);
        return;
      }
      try {
        // Check owners table first, then admins
        const { data: ownerData } = await supabase
          .from('owners')
          .select('owner_id, full_name, username')
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
            contact_phone: prev.contact_phone || '09170000000',
          }));
        } else {
          const { data: adminData } = await supabase
            .from('admins')
            .select('admin_id, full_name, username')
            .eq('admin_id', user.id)
            .maybeSingle();
          setUserRole(adminData ? 'admin' : 'user');
          if (adminData) {
            setForm(prev => ({
              ...prev,
              owner_display_name: adminData.full_name || adminData.username || user.email || 'Administrator',
              contact_email: user.email || '',
              contact_phone: prev.contact_phone || '09170000000',
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
        Alert.alert('Permission Denied', 'We need access to your gallery to upload photos.');
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
      Alert.alert('Error', 'Failed to pick images');
    }
  };

  const pickOwnershipProof = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Gallery access is required to select ownership proof.');
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
      Alert.alert('Selection failed', 'The ownership proof image could not be selected.');
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
      if (!ownershipProofUri) throw new Error('Please upload proof of ownership.');
      if (selectedImages.length === 0) throw new Error('Please select at least 1 photo of the dormitory from your gallery.');

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

      const uploadedUrls: string[] = [];
      const uploadTimestamp = Date.now();
      for (const [index, image] of selectedImages.entries()) {
        const ext = image.fileName?.split('.').pop()?.toLowerCase() || image.uri.split('.').pop()?.toLowerCase() || 'jpg';
        const fileName = `${user.id}/listings/${uploadTimestamp}-${index}.${ext}`;
        try {
          const publicUrl = await uploadImage(fileName, image.uri, image.mimeType || undefined);
          uploadedUrls.push(publicUrl);
        } catch (uploadErr) {
          console.error('Failed to upload listing image:', { index, error: uploadErr });
          throw new Error(`Photo ${index + 1} could not upload. ${getErrorMessage(uploadErr)}`);
        }
      }

      const proofExt = ownershipProofUri.split('.').pop() || 'jpg';
      let ownershipProofUrl = '';
      try {
        ownershipProofUrl = await uploadPrivateImage(`${user.id}/ownership/${Date.now()}.${proofExt}`, ownershipProofUri);
      } catch (proofErr) {
        console.warn('Ownership proof upload warning:', proofErr);
        ownershipProofUrl = '';
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
        contact_phone: (form.contact_phone || '09170000000').trim(),
        contact_email: (form.contact_email || user.email || '').trim(),
        owner_display_name: (form.owner_display_name || 'Verified Owner').trim(),
        pet_friendly: form.pet_friendly,
        ownership_proof_url: ownershipProofUrl || null,
        approval_status: 'pending',
        available: form.available,
        images: uploadedUrls,
        owner_id: user.id,
      };

      let { error: insertError } = await supabase.from('dorms').insert(fullPayload);

      // Failsafe: If DB table does not have extended columns (e.g. approval_status) yet, fallback to core payload
      if (insertError && (insertError.message?.includes('approval_status') || insertError.message?.includes('schema cache') || insertError.message?.includes('column'))) {
        console.warn('Retrying dorm insertion with core columns fallback:', insertError.message);
        const corePayload = {
          name: form.name.trim(),
          description: form.description.trim(),
          address: form.address.trim(),
          price,
          latitude,
          longitude,
          utilities: form.utilities,
          amenities: form.amenities,
          available: form.available,
          images: uploadedUrls,
          owner_id: user.id,
        };
        const fallbackRes = await supabase.from('dorms').insert(corePayload);
        insertError = fallbackRes.error;
      }

      if (insertError) throw insertError;

      // Navigate back to home
      router.push('/(tabs)/home' as any);

    } catch (err: any) {
      const msg = err?.message || err?.error_description || getErrorMessage(err);
      setError(msg);
    } finally {
      setLoading(false);
      setUploadingImages(false);
    }
  }, [form, ownershipProofUri, router, selectedImages, userRole, user]);


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
      {error && (
        <View style={styles.error}>
          <ThemedText type="small" themeColor="text">Error: {error}</ThemedText>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.formContainer}>
        <ThemedText type="subtitle" themeColor="text" style={styles.sectionTitle}>
          Add New Dormitory
        </ThemedText>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Name:</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Enter dormitory name"
            value={form.name}
            onChangeText={(text) => handleChange('name', text)}
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Description:</ThemedText>
          <TextInput
            style={[styles.input, { minHeight: 80 }]}
            placeholder="Enter description"
            value={form.description}
            onChangeText={(text) => handleChange('description', text)}
            multiline
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Address:</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Enter address"
            value={form.address}
            onChangeText={(text) => handleChange('address', text)}
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Price per month:</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="Enter price"
            value={form.price}
            onChangeText={(text) => handleChange('price', text.replace(/[^0-9.]/g, ''))}
            keyboardType="numeric"
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Location on Map:</ThemedText>
          <Text style={styles.mapHint}>Tap the Leaflet map or drag the pin to set the dormitory location.</Text>
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
          <TextInput
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
          <TextInput style={styles.input} keyboardType="number-pad" value={form.max_tenants} onChangeText={(text) => handleChange('max_tenants', text.replace(/\D/g, '').slice(0, 3))} />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Contact phone (required):</ThemedText>
          <TextInput style={styles.input} keyboardType="phone-pad" maxLength={20} placeholder="e.g. 0917 123 4567" value={form.contact_phone} onChangeText={(text) => handleChange('contact_phone', text)} />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Pet friendly:</ThemedText>
          <View style={{ alignItems: 'flex-start', marginTop: 6 }}>
            <Switch value={form.pet_friendly} onValueChange={() => handleToggle('pet_friendly')} />
          </View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Proof of ownership (required every submission):</ThemedText>
          <Pressable style={styles.imageButton} onPress={pickOwnershipProof}><Text style={styles.imageButtonText}>{ownershipProofUri ? 'Change selected proof' : 'Choose proof image'}</Text></Pressable>
          {ownershipProofUri ? <Image source={{ uri: ownershipProofUri }} style={styles.proofPreview} /> : null}
          <Text style={styles.mapHint}>The listing stays pending until an admin reviews this proof.</Text>
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

        <Button
          title={loading ? 'Uploading & Listing...' : 'Submit Listing'}
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
