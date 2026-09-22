import { supabase } from '@/lib/supabase';
import * as FileSystem from 'expo-file-system/legacy';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function imageTypeFromPath(path: string) {
  const extension = path.split('?')[0].split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return '';
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = globalThis.atob ? globalThis.atob(base64) : '';
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function readImageUpload(uri: string, suppliedType?: string) {
  let bytes: ArrayBuffer | null = null;
  let contentType = (suppliedType || imageTypeFromPath(uri) || 'image/jpeg').toLowerCase().split(';')[0];

  // 1. Try FileSystem Legacy (Most reliable for React Native file:// and content:// URIs on Android/iOS)
  try {
    if (uri.startsWith('file:') || uri.startsWith('content:') || uri.startsWith('ph:')) {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (base64) {
        bytes = base64ToArrayBuffer(base64);
      }
    }
  } catch (fsErr) {
    console.warn('FileSystem read failed, trying fetch fallback:', fsErr);
  }

  // 2. Fallback to fetch() (For web, blob:, data:, and http URIs)
  if (!bytes) {
    try {
      const response = await fetch(uri);
      const resType = response.headers?.get('content-type');
      if (resType) contentType = resType.toLowerCase().split(';')[0];
      bytes = await response.arrayBuffer();
    } catch (fetchErr) {
      console.warn('Fetch read failed, trying XHR fallback:', fetchErr);
    }
  }

  // 3. Fallback to XMLHttpRequest
  if (!bytes) {
    try {
      bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => {
          if (xhr.response) {
            resolve(xhr.response);
          } else {
            reject(new Error('XHR response empty'));
          }
        };
        xhr.onerror = () => reject(new Error('XHR Error'));
        xhr.responseType = 'arraybuffer';
        xhr.open('GET', uri, true);
        xhr.send(null);
      });
    } catch (xhrErr) {
      console.warn('XHR read failed:', xhrErr);
    }
  }

  if (!bytes || bytes.byteLength === 0) {
    throw new Error('The selected image could not be read or is empty.');
  }

  // Supabase Storage buckets by default allow image/jpeg and image/png. Map webp / unknown to image/jpeg for bucket safety.
  let uploadContentType = contentType;
  if (!ALLOWED_IMAGE_TYPES.has(uploadContentType) || uploadContentType === 'image/webp') {
    uploadContentType = 'image/jpeg';
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Images must be 8 MB or smaller.');
  }

  return { bytes, contentType: uploadContentType };
}

/**
 * Upload an image to Supabase storage
 * @param filePath - The path where the image will be stored
 * @param uri - The local URI of the image
 * @returns The public URL of the uploaded image
 */
export const uploadImage = async (filePath: string, uri: string, mimeType?: string): Promise<string> => {
  try {
    const { bytes, contentType } = await readImageUpload(uri, mimeType);

    const { data, error } = await supabase.storage
      .from('uploaded_images')
      .upload(filePath, bytes, {
        contentType,
        cacheControl: '3600',
        upsert: true,
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

/** Uploads sensitive images to a private bucket and returns the protected object path. Fallback to uploaded_images if private_documents bucket is missing. */
export const uploadPrivateImage = async (filePath: string, uri: string): Promise<string> => {
  const { bytes, contentType } = await readImageUpload(uri);
  try {
    const { data, error } = await supabase.storage
      .from('private_documents')
      .upload(filePath, bytes, { contentType, cacheControl: '3600', upsert: true });

    if (error) {
      if (error.message?.includes('Bucket not found') || (error as any)?.statusCode === '404' || (error as any)?.status === 404) {
        console.warn('private_documents bucket not found, falling back to uploaded_images');
        const fallbackPath = `proofs/${filePath}`;
        const { data: fbData, error: fbError } = await supabase.storage
          .from('uploaded_images')
          .upload(fallbackPath, bytes, { contentType, cacheControl: '3600', upsert: true });
        if (fbError) throw fbError;
        return fbData.path;
      }
      throw error;
    }
    return data.path;
  } catch (err: any) {
    if (err?.message?.includes('Bucket not found')) {
      console.warn('Bucket not found error caught, using uploaded_images fallback');
      const fallbackPath = `proofs/${filePath}`;
      const { data: fbData, error: fbError } = await supabase.storage
        .from('uploaded_images')
        .upload(fallbackPath, bytes, { contentType, cacheControl: '3600', upsert: true });
      if (fbError) throw fbError;
      return fbData.path;
    }
    throw err;
  }
};

export const getPrivateDocumentUrl = async (path: string): Promise<string> => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;

  try {
    const { data, error } = await supabase.storage.from('private_documents').createSignedUrl(path, 300);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch (err) {
    console.warn('Failed to get signed URL from private_documents:', err);
  }

  // Fallback to uploaded_images
  const { data: publicData } = supabase.storage.from('uploaded_images').getPublicUrl(path);
  return publicData?.publicUrl || path;
};

