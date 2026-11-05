import { supabase } from '@/lib/supabase';
import { File } from 'expo-file-system';
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

export function getSafeImageExtension(path: string, mimeType?: string) {
  const type = mimeType?.toLowerCase().split(';')[0];
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/jpeg') return 'jpg';
  const extension = path.split('?')[0].split('.').pop()?.toLowerCase();
  if (extension === 'png' || extension === 'webp') return extension;
  if (extension === 'jpg' || extension === 'jpeg') return 'jpg';
  return 'jpg';
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const outputLength = Math.max(0, Math.floor((clean.length * 3) / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0));
  const bytes = new Uint8Array(outputLength);
  let buffer = 0;
  let bits = 0;
  let output = 0;
  for (const character of clean) {
    if (character === '=') break;
    const value = alphabet.indexOf(character);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (output < bytes.length) bytes[output++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes.buffer;
}

async function readImageUpload(uri: string, suppliedType?: string) {
  let bytes: ArrayBuffer | null = null;
  let contentType = (suppliedType || imageTypeFromPath(uri) || 'image/jpeg').toLowerCase().split(';')[0];

  // 1. Expo File supports the temporary file:// assets returned by ImagePicker without network fetches.
  try {
    const file = new File(uri);
    const fileType = file.type?.toLowerCase().split(';')[0];
    if (fileType) contentType = fileType;
    bytes = await file.arrayBuffer();
  } catch {
    // Some Android providers return content:// URIs; the legacy reader handles those below.
  }

  // 2. Android content-provider fallback.
  try {
    if (!bytes && (uri.startsWith('file:') || uri.startsWith('content:') || uri.startsWith('ph:'))) {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (base64) {
        bytes = base64ToArrayBuffer(base64);
      }
    }
  } catch {
    // Continue to browser/network-compatible fallbacks.
  }

  // 3. Browser-compatible fallback for blob:, data:, and http(s): URIs.
  if (!bytes) {
    try {
      const response = await fetch(uri);
      const resType = response.headers?.get('content-type');
      if (resType) contentType = resType.toLowerCase().split(';')[0];
      if (!response.ok) throw new Error(`Image read returned HTTP ${response.status}.`);
      bytes = await response.arrayBuffer();
    } catch {
      // Continue to XMLHttpRequest fallback.
    }
  }

  // 4. Last-resort React Native URI reader.
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
    } catch {
      // The single user-facing error below includes the actionable recovery.
    }
  }

  if (!bytes || bytes.byteLength === 0) {
    throw new Error('The selected image could not be read or is empty.');
  }

  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error('Only JPEG, PNG, and WebP images can be uploaded.');
  }

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Images must be 8 MB or smaller.');
  }

  return { bytes, contentType };
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
        upsert: false,
      });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploaded_images')
      .getPublicUrl(data.path);

    return publicUrl;
  } catch (error) {
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

/** Uploads sensitive images to a private bucket and returns the protected object path. */
export const uploadPrivateImage = async (filePath: string, uri: string): Promise<string> => {
  const { bytes, contentType } = await readImageUpload(uri);
  const { data, error } = await supabase.storage
    .from('private_documents')
    .upload(filePath, bytes, { contentType, cacheControl: '3600', upsert: false });

  if (error) {
    if (error.message?.includes('Bucket not found') || (error as any)?.statusCode === '404' || (error as any)?.status === 404) {
      throw new Error('Secure document storage is not configured. Ask an administrator to apply the Supabase runtime update.');
    }
    throw error;
  }
  return data.path;
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

  return '';
};
