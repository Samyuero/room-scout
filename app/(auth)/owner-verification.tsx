import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Image, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { uploadImage } from '../../src/utils/imageUpload';

export default function OwnerVerification() {
  const router = useRouter();
  const { user } = useAuth();
  const [imageUri, setImageUri] = useState('');
  const [loading, setLoading] = useState(false);

  const pickDocumentImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Gallery access is required to select your verification photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImageUri(result.assets[0].uri);
      }
    } catch (err: any) {
      console.error('Error picking document photo:', err);
      Alert.alert('Error', 'Failed to pick photo from gallery.');
    }
  };

  const handleSubmit = async () => {
    if (!imageUri) {
      Alert.alert('Photo Required', 'Please select a photo of your government ID or business permit from your gallery.');
      return;
    }

    setLoading(true);
    try {
      if (!user) throw new Error('Not authenticated');

      // Upload image to Supabase Storage
      const fileExt = imageUri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${user.id}/verifications/${Date.now()}.${fileExt}`;
      const publicUrl = await uploadImage(fileName, imageUri);

      const { error } = await supabase.from('owner_verifications').insert({
        user_id: user.id,
        document_url: publicUrl,
        status: 'pending',
      });

      if (error) throw error;

      Alert.alert(
        'Verification Submitted',
        'Your verification request has been sent to the admin. You can continue using the app while we review it.',
        [{ text: 'OK', onPress: () => router.replace('/(tabs)/home' as any) }]
      );
    } catch (err: any) {
      console.error(err);
      Alert.alert('Error', err.message || 'Failed to submit verification.');
    } finally {
      setLoading(false);
    }
  };

  const skipForNow = () => {
    router.replace('/(tabs)/home' as any);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Dorm Owner Verification</Text>
      <Text style={styles.subtitle}>
        To list your dormitories, we need to verify your identity. Please select a clear photo of your valid government ID or business permit from your gallery.
      </Text>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Verification Document Photo</Text>
        
        {imageUri ? (
          <View style={styles.imagePreviewContainer}>
            <Image source={{ uri: imageUri }} style={styles.imagePreview} />
            <Pressable style={styles.changePhotoButton} onPress={pickDocumentImage} disabled={loading}>
              <Text style={styles.changePhotoText}>Change Photo</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.pickPhotoButton} onPress={pickDocumentImage} disabled={loading}>
            <Text style={styles.pickPhotoText}>📷 Choose Photo from Gallery</Text>
          </Pressable>
        )}
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.submitButton,
          pressed && { opacity: 0.8 },
          (loading || !imageUri) && styles.submitButtonDisabled,
        ]}
        onPress={handleSubmit}
        disabled={loading || !imageUri}
      >
        {loading ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.submitButtonText}>Uploading document...</Text>
          </View>
        ) : (
          <Text style={styles.submitButtonText}>Submit for Verification</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.skipButton}
        onPress={skipForNow}
        disabled={loading}
      >
        <Text style={styles.skipButtonText}>Skip for now</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#333',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    color: '#666',
    marginBottom: 28,
    lineHeight: 22,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#333',
  },
  pickPhotoButton: {
    backgroundColor: '#f1f5f9',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickPhotoText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
  },
  imagePreviewContainer: {
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 8,
    backgroundColor: '#f8fafc',
  },
  imagePreview: {
    width: '100%',
    height: 220,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  changePhotoButton: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
  },
  changePhotoText: {
    color: '#334155',
    fontWeight: '600',
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  submitButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: 'bold',
  },
  skipButton: {
    padding: 14,
    alignItems: 'center',
  },
  skipButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
