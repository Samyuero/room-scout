import { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Button, Switch, ActivityIndicator, StyleSheet, Platform, ScrollView, Alert, Pressable, Image } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { OsmMapView, Marker } from '@/components/OsmMapView';
import { UCLM_COORDINATES } from '@/constants/map';
import { AppColors, BorderRadius } from '@/constants/theme';
import { uploadImage } from '@/utils/imageUpload';

export default function AddDormScreen() {
  const router = useRouter();
  const { user } = useAuth();
  
  const [userRole, setUserRole] = useState<string | null>(null);
  const [checkingRole, setCheckingRole] = useState(true);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    address: '',
    price: '',
    latitude: UCLM_COORDINATES.latitude.toString(),
    longitude: UCLM_COORDINATES.longitude.toString(),
    utilities: '',
    amenities: '',
    gender_policy: 'co-ed',
    curfew: '',
    available: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapRegion, setMapRegion] = useState({
    ...UCLM_COORDINATES,
  });

  useEffect(() => {
    const getUserLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const coords = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.009,
          longitudeDelta: 0.009,
        };
        setMapRegion(coords);
        setForm(prev => ({
          ...prev,
          latitude: coords.latitude.toString(),
          longitude: coords.longitude.toString(),
        }));
      } catch (err) {
        console.error('Error getting location in add-dorm:', err);
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
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('profile_id', user.id)
          .single();
        
        if (error) throw error;
        setUserRole(data?.role || 'user');
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

  const pickImages = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'We need access to your gallery to upload photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.7,
      });

      if (!result.canceled) {
        const uris = result.assets.map(asset => asset.uri);
        setSelectedImages(prev => [...prev, ...uris]);
      }
    } catch (err) {
      console.error('Error picking images:', err);
      Alert.alert('Error', 'Failed to pick images');
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

      // Validate required fields
      if (!form.name || !form.description || !form.address || !form.price || !form.latitude || !form.longitude) {
        throw new Error('Please fill in all required fields');
      }

      // Parse numeric fields
      const price = parseFloat(form.price);
      const latitude = parseFloat(form.latitude);
      const longitude = parseFloat(form.longitude);
      if (isNaN(price) || isNaN(latitude) || isNaN(longitude)) {
        throw new Error('Price, latitude, and longitude must be numbers');
      }

      // Parse arrays
      const utilities = form.utilities.split(',').map(u => u.trim()).filter(u => u);
      const amenities = form.amenities.split(',').map(a => a.trim()).filter(a => a);

      // Upload images to Supabase Storage
      if (!user?.id) {
        throw new Error('You must be signed in to add a dorm');
      }

      const uploadedUrls: string[] = [];
      for (const uri of selectedImages) {
        const ext = uri.split('.').pop() || 'jpg';
        const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
        try {
          const publicUrl = await uploadImage(fileName, uri);
          uploadedUrls.push(publicUrl);
        } catch (uploadErr) {
          console.error('Failed to upload image:', uri, uploadErr);
          // We can choose to continue or fail. Let's warning and proceed with what worked, or fail.
          // Let's throw to be safe
          throw new Error('Failed to upload some images. Please check your storage settings.');
        }
      }

      const { error } = await supabase.from('dorms').insert({
        name: form.name,
        description: form.description,
        address: form.address,
        price,
        latitude,
        longitude,
        utilities,
        amenities,
        gender_policy: form.gender_policy,
        curfew: form.curfew,
        available: form.available,
        images: uploadedUrls,
        owner_id: user.id,
      });

      if (error) throw error;

      // Navigate back to the dorms list (home tab)
      router.push('/(tabs)/home' as any);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setUploadingImages(false);
    }
  }, [form, selectedImages, userRole, user]);

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
            onChangeText={(text) => handleChange('price', text)}
            keyboardType="numeric"
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Location on Map:</ThemedText>
          <Text style={styles.mapHint}>Tap on the map or drag the pin to set the dormitory location</Text>
          <Text style={styles.coordsText}>
            Selected Coords: {parseFloat(form.latitude).toFixed(5)}, {parseFloat(form.longitude).toFixed(5)}
          </Text>
          <View style={styles.mapWrapper}>
            <OsmMapView
              style={styles.map}
              region={mapRegion}
              onRegionChangeComplete={setMapRegion}
              onPress={(e) => {
                const { latitude, longitude } = e.nativeEvent.coordinate;
                handleChange('latitude', latitude.toString());
                handleChange('longitude', longitude.toString());
              }}
            >
              <Marker
                draggable
                coordinate={{
                  latitude: parseFloat(form.latitude) || UCLM_COORDINATES.latitude,
                  longitude: parseFloat(form.longitude) || UCLM_COORDINATES.longitude,
                }}
                pinColor={AppColors.accent}
                onDragEnd={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  handleChange('latitude', latitude.toString());
                  handleChange('longitude', longitude.toString());
                }}
              />
            </OsmMapView>
          </View>
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Utilities (comma-separated):</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="e.g., water, electricity, internet"
            value={form.utilities}
            onChangeText={(text) => handleChange('utilities', text)}
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Amenities (comma-separated):</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="e.g., wifi, air conditioning, gym"
            value={form.amenities}
            onChangeText={(text) => handleChange('amenities', text)}
          />
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
          <ThemedText type="smallBold" themeColor="text">Curfew (optional):</ThemedText>
          <TextInput
            style={styles.input}
            placeholder="e.g., 10:00 PM"
            value={form.curfew}
            onChangeText={(text) => handleChange('curfew', text)}
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Available:</ThemedText>
          <Switch
            value={form.available}
            onValueChange={() => handleToggle('available')}
          />
        </ThemedView>

        <ThemedView style={styles.inputContainer}>
          <ThemedText type="smallBold" themeColor="text">Photos:</ThemedText>
          <Pressable style={styles.imageButton} onPress={pickImages}>
            <Text style={styles.imageButtonText}>Select Photos from Gallery</Text>
          </Pressable>

          {selectedImages.length > 0 && (
            <ScrollView horizontal style={styles.previewContainer} showsHorizontalScrollIndicator={false}>
              {selectedImages.map((uri, index) => (
                <View key={index} style={styles.previewItem}>
                  <Image source={{ uri }} style={styles.previewImage} />
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
