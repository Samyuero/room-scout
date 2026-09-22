import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch } from 'expo/fetch';
import { getErrorMessage, logEvent } from '@/lib/logger';
import type { UserCoordinates } from '@/types/dorm';

const CACHE_PREFIX = 'room_scout_geocode_';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function geocodePlace(input: string): Promise<UserCoordinates | null> {
  const query = input.trim().slice(0, 120);
  if (!query) return null;
  const key = `${CACHE_PREFIX}${query.toLowerCase()}`;

  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as { timestamp: number; value: UserCoordinates };
      if (Date.now() - parsed.timestamp < CACHE_TTL_MS) return parsed.value;
    }
  } catch (caught) {
    logEvent('warn', 'geocode_cache_read_failed', { message: getErrorMessage(caught) });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-PH,en',
        'User-Agent': 'RoomScout/1.0 (student dorm finder)',
      },
    });
    if (!response.ok) throw new Error(`Geocoding returned HTTP ${response.status}`);
    const results = await response.json() as { lat?: string; lon?: string }[];
    if (!results[0]?.lat || !results[0]?.lon) return null;

    const value = { latitude: Number(results[0].lat), longitude: Number(results[0].lon) };
    await AsyncStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), value }));
    return value;
  } finally {
    clearTimeout(timeout);
  }
}
