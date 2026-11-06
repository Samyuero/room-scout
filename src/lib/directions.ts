import { fetch } from 'expo/fetch';
import type { UserCoordinates } from '../types/dorm';

export interface RoadRoute {
  coordinates: [number, number][]; // Leaflet order: latitude, longitude.
  distanceMeters: number;
  durationSeconds: number;
  start: UserCoordinates;
  end: UserCoordinates;
  snappedDistanceMeters: number;
}

const cache = new Map<string, { expires: number; route: RoadRoute }>();
let lastRequest = 0;
function valid(point: UserCoordinates) {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

/** Explicit, consented requests only. No account data or disk-persisted GPS history. */
export async function getRoadRoute(start: UserCoordinates, end: UserCoordinates, signal?: AbortSignal): Promise<RoadRoute> {
  if (!valid(start) || !valid(end)) throw new Error('Choose a valid start and dorm location.');
  const key = [start.longitude, start.latitude, end.longitude, end.latitude].map((value) => value.toFixed(6)).join(',');
  if (signal?.aborted) throw new Error('Route cancelled.');
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.route;
  if (Date.now() - lastRequest < 1100) throw new Error('Please wait a moment before requesting another route.');
  lastRequest = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12000);
  try {
    const coords = `${start.longitude},${start.latitude};${end.longitude},${end.latitude}`;
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson&steps=false&alternatives=false&radiuses=500;500`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      if (response.status === 400) throw new Error('A mapped road could not be found near one of these pins. Check the dorm pin or choose another start.');
      throw new Error(response.status === 429 ? 'Directions are busy. Please retry shortly.' : 'Directions could not load. Check your connection and retry.');
    }
    const data = await response.json();
    const result = data.routes?.[0];
    const points = result?.geometry?.coordinates;
    if (data.code !== 'Ok' || !Array.isArray(points) || points.length < 2 || points.length > 30000 || !points.every((p: unknown) => Array.isArray(p) && p.length >= 2 && valid({ latitude: p[1], longitude: p[0] })) || !Number.isFinite(result.distance) || !Number.isFinite(result.duration) || result.distance < 0 || result.duration < 0) throw new Error('No usable road route was found between these locations. Try another starting location.');
    const route: RoadRoute = { coordinates: points.map((p: number[]) => [p[1], p[0]]), distanceMeters: result.distance, durationSeconds: result.duration, start: { latitude: start.latitude, longitude: start.longitude }, end: { latitude: end.latitude, longitude: end.longitude }, snappedDistanceMeters: Math.max(...(data.waypoints || []).map((p: { distance?: number }) => Number(p.distance) || 0), 0) };
    if (signal?.aborted) throw new Error('Route cancelled.');
    if (cache.size >= 20) cache.clear();
    cache.set(key, { expires: Date.now() + 10 * 60 * 1000, route });
    return route;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? 'Route cancelled.' : 'Directions timed out. Please retry.');
    throw error instanceof Error ? error : new Error('Directions are unavailable. Please retry.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function googleDirectionsUrl(start: UserCoordinates, end: UserCoordinates) {
  if (!valid(start) || !valid(end)) throw new Error('Choose valid route locations.');
  return `https://www.google.com/maps/dir/?api=1&origin=${start.latitude}%2C${start.longitude}&destination=${end.latitude}%2C${end.longitude}&travelmode=driving`;
}
