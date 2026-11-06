import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch } from 'expo/fetch';
import { isPhilippinesCoordinates, UCLM_COORDINATES } from '@/constants/map';
import type { SearchOrigin, UserCoordinates } from '@/types/dorm';

const CACHE_PREFIX = 'room_scout_photon_v1_';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const pending = new Map<string, Promise<SearchOrigin[]>>();

/** Explicit public place lookup only; never called per keystroke or with profile/transaction data. */
export async function searchPlaces(input: string, schoolOnly = false): Promise<SearchOrigin[]> {
  const query = input.trim().slice(0, 120);
  if (!query || /\S+@\S+/.test(query)) return [];
  const key = `${CACHE_PREFIX}${schoolOnly ? 'school_' : 'place_'}${query.toLowerCase()}`;

  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached) as { timestamp: number; value: SearchOrigin[] };
      if (Array.isArray(parsed.value) && Date.now() - parsed.timestamp < CACHE_TTL_MS) return parsed.value;
    }
  } catch { /* Cache problems do not block public place search. */ }
  if (pending.has(key)) return pending.get(key)!;

  const lookup = (async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const params = new URLSearchParams({ q: query, limit: '12', lang: 'en',
      lat: String(UCLM_COORDINATES.latitude), lon: String(UCLM_COORDINATES.longitude), bbox: '116,4.5,127,21.5' });
    // Photon serves OSM data. The public server is for modest testing, without an availability SLA.
    // At scale, replace this one endpoint with a managed or self-hosted geocoder.
    const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'Place search is busy. Try again shortly.' : 'Place search is unavailable. Please retry.');
    const result = await response.json() as { features?: { geometry?: { coordinates?: number[] }; properties?: Record<string, string> }[] };
    const places = (result.features ?? []).flatMap((feature): SearchOrigin[] => {
      const coords = feature.geometry?.coordinates;
      const properties = feature.properties ?? {};
      if (!coords || !isPhilippinesCoordinates({ latitude: coords[1], longitude: coords[0] })) return [];
      const isSchool = ['school', 'university', 'college'].includes(properties.osm_value) || /\b(school|university|college|institute|campus|academy)\b/i.test(properties.name || '');
      if (schoolOnly && !isSchool) return [];
      const label = [properties.name, properties.city || properties.district].filter(Boolean).join(' · ');
      return label ? [{ latitude: coords[1], longitude: coords[0], label, kind: schoolOnly ? 'school' : 'place' }] : [];
    }).slice(0, 6);
    await AsyncStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), value: places })).catch(() => {});
    return places;
  } finally {
    clearTimeout(timeout);
  }
  })();
  pending.set(key, lookup);
  try { return await lookup; } finally { pending.delete(key); }
}

export async function geocodePlace(input: string): Promise<UserCoordinates | null> {
  return (await searchPlaces(input))[0] ?? null;
}
