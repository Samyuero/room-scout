import { supabase } from '../services/supabase';

/**
 * Upload an image to Supabase storage
 * @param filePath - The path where the image will be stored
 * @param uri - The local URI of the image
 * @returns The public URL of the uploaded image
 */
export const uploadImage = async (filePath: string, uri: string): Promise<string> => {
  try {
    // Fetch the image data
    const response = await fetch(uri);
    const blob = await response.blob();

    // Upload to Supabase storage
    const { data, error } = await supabase.storage
      .from('uploaded_images')
      .upload(filePath, blob, {
        contentType: 'image/*',
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploaded_images')
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

/**
 * Delete an image from Supabase storage
 * @param filePath - The path of the image to delete
 */
export const deleteImage = async (filePath: string): Promise<void> => {
  try {
    const { error } = await supabase.storage
      .from('uploaded_images')
      .remove([filePath]);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
};