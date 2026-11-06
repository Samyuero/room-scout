import type { Dorm, DormPreferences } from '@/types/dorm';
import { getDistanceKm } from '@/lib/dorm-discovery';

const normalize = (value?: string | null) => (value || '').trim().toLowerCase();
const includes = (items: string[] | undefined, value: string) => !!items?.some((item) => normalize(item) === normalize(value));

/** Blue is reserved for a real match to this signed-in user's saved profile. */
export function comparisonValueMatchesPreference(dorm: Dorm, preferences: DormPreferences | null, key: string, value: string): boolean {
  if (!preferences) return false;
  switch (key) {
    case 'amenities': return includes(preferences.amenities, value);
    case 'utilities': return includes(preferences.utilities, value);
    case 'rules': return includes(preferences.house_rules, value);
    case 'gender': return !!preferences.gender_policy && normalize(dorm.gender_policy) === normalize(preferences.gender_policy);
    case 'roomType': return !!preferences.room_type && normalize(dorm.room_type) === normalize(preferences.room_type);
    case 'lgu': return preferences.lgu_certified === true && dorm.lgu_certified === true;
    case 'pet': return preferences.pet_friendly === true && dorm.pet_friendly === true;
    case 'furnished': return preferences.furnished === true && dorm.furnished === true;
    case 'price': {
      const min = Number(preferences.budget_min) || 0;
      const max = Number(preferences.budget_max) || 0;
      return (min > 0 || max > 0) && (!min || dorm.price >= min) && (!max || dorm.price <= max);
    }
    case 'parking': {
      const requested = normalize(preferences.parking);
      const actual = normalize(dorm.parking_info);
      if (!requested || !actual || ['none', 'no parking', 'none listed'].includes(actual)) return false;
      return ['any', 'any parking', 'parking'].includes(requested) || actual.split(/[,/]/).some((vehicle) => normalize(vehicle) === requested);
    }
    case 'curfew': {
      const requested = normalize(preferences.curfew);
      if (!requested) return false;
      const actual = normalize(dorm.curfew);
      const noCurfew = !actual || ['none', 'no curfew', 'no curfew listed'].includes(actual);
      if (requested === 'no curfew') return noCurfew;
      if (['with curfew', 'with-curfew'].includes(requested)) return !noCurfew;
      return actual === requested;
    }
    case 'distance': {
      if (preferences.latitude == null || preferences.longitude == null || !Number.isFinite(Number(preferences.latitude)) || !Number.isFinite(Number(preferences.longitude))) return false;
      const radius = Number(preferences.radius_km);
      return Number.isFinite(radius) && radius > 0 && getDistanceKm({ latitude: Number(preferences.latitude), longitude: Number(preferences.longitude) }, dorm) <= radius;
    }
    default: return false;
  }
}
