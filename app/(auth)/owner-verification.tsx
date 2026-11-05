import { AppColors } from '@/constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { showError } from '@/components/error-toast';
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Image, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/hooks/useAuth';
import { getSafeImageExtension, uploadPrivateImage } from '../../src/utils/imageUpload';

export default function OwnerVerification() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [imageUri, setImageUri] = useState('');
  const [loading, setLoading] = useState(false);

  const pickDocumentImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showError('Permission Denied', 'Gallery access is required to select your verification photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImageUri(result.assets[0].uri);
      }
    } catch (err: any) {
      console.error('Error picking document photo:', err);
      showError('Error', 'Failed to pick photo from gallery.');
    }
  };

  const handleSubmit = async () => {
    if (!imageUri) {
      showError('Photo Required', 'Please select a photo of your government ID or business permit from your gallery.');
      return;
    }

    setLoading(true);
    try {
      if (!user) throw new Error('Not authenticated');

      // Upload image to Supabase Storage
      const fileExt = getSafeImageExtension(imageUri);
      const fileName = `${user.id}/verifications/${Date.now()}.${fileExt}`;
      const protectedPath = await uploadPrivateImage(fileName, imageUri);

      const { error } = await supabase.from('owner_verifications').insert({
        user_id: user.id,
        document_url: protectedPath,
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
      showError('Error', err.message || 'Failed to submit verification.');
    } finally {
      setLoading(false);
    }
  };

  const skipForNow = () => {
    router.replace('/(tabs)/home' as any);
  };

  return (
    <ScrollView style={{ backgroundColor: AppColors.background }} contentContainerStyle={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
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
            <Ionicons name="image-outline" size={28} color={AppColors.accent} /><Text style={styles.pickPhotoText}>Choose verification photo</Text>
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
    backgroundColor: AppColors.background,
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
    color: AppColors.text,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    color: AppColors.textSecondary,
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
    color: AppColors.text,
  },
  pickPhotoButton: {
    backgroundColor: AppColors.surfaceElevated,
    borderWidth: 2,
    borderColor: AppColors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickPhotoText: {
    fontSize: 16,
    fontWeight: '600',
    color: AppColors.accent,
  },
  imagePreviewContainer: {
    alignItems: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
    padding: 8,
    backgroundColor: AppColors.surface,
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
    backgroundColor: AppColors.borderSubtle,
    borderRadius: 6,
  },
  changePhotoText: {
    color: AppColors.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  submitButton: {
    backgroundColor: AppColors.accent,
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  submitButtonDisabled: {
    backgroundColor: AppColors.textMuted,
  },
  submitButtonText: {
    color: AppColors.white,
    fontSize: 17,
    fontWeight: 'bold',
  },
  skipButton: {
    padding: 14,
    alignItems: 'center',
  },
  skipButtonText: {
    color: AppColors.accent,
    fontSize: 16,
    fontWeight: '600',
  },
});
