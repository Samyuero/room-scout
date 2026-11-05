/** CartoDB dark tiles — reliable, no API key, matches app theme */
export const MAP_TILE_URL = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

/** Pilot-zone center: Barangay Opao/Opaw, Mandaue City. */
export const OPAO_COORDINATES = {
  latitude: 10.3236,
  longitude: 123.9348,
  latitudeDelta: 0.015,
  longitudeDelta: 0.015,
} as const;

/** Kept for older imports; all new map behavior should describe this as Opao. */
export const UCLM_COORDINATES = OPAO_COORDINATES;

export function isPhilippinesCoordinates(coords: { latitude: number; longitude: number } | null | undefined): boolean {
  if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return false;
  // Philippines bounding box filter (filters out Android Emulator default coordinates in Mountain View, California)
  return coords.latitude >= 4.5 && coords.latitude <= 21.5 && coords.longitude >= 116.0 && coords.longitude <= 127.0;
}
