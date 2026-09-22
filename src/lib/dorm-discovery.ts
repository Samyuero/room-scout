import {
  DEFAULT_DORM_FILTERS,
  type Dorm,
  type DormAvailability,
  type DormFilters,
  type UserCoordinates,
} from '@/types/dorm';

const EARTH_RADIUS_KM = 6371;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function getDistanceKm(from: UserCoordinates, to: UserCoordinates) {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const startLatitude = toRadians(from.latitude);
  const endLatitude = toRadians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getAvailability(row: Record<string, any>): DormAvailability {
  const maxTenants = Math.max(1, Number(row.max_tenants) || 1);
  const activeRentals = Array.isArray(row.rentals)
    ? row.rentals.filter((r: any) => r && (r.status === 'active' || !r.status)).length
    : 0;
  const occupied = Math.max(0, Number(row.occupied_tenants) || activeRentals);
  const slots = maxTenants - occupied;

  if (row.available === false || slots <= 0) {
    return 'unavailable';
  }
  if (
    row.availability_status === 'available' ||
    row.availability_status === 'reserved' ||
    row.availability_status === 'unavailable'
  ) {
    return row.availability_status;
  }
  return 'available';
}

export function normalizeDorm(row: Record<string, any>): Dorm {
  const reviews = Array.isArray(row.dorm_reviews) ? row.dorm_reviews : [];
  const ratings = reviews
    .map((review: { rating?: unknown }) => Number(review?.rating))
    .filter((rating: number) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
  const ratingCount = Number(row.rating_count) || ratings.length;
  const ratingAverage =
    Number(row.rating_average) ||
    (ratings.length > 0
      ? ratings.reduce((total: number, rating: number) => total + rating, 0) / ratings.length
      : 0);

  const maxTenants = Math.max(1, Number(row.max_tenants) || 1);
  const activeRentals = Array.isArray(row.rentals)
    ? row.rentals.filter((r: any) => r && (r.status === 'active' || !r.status)).length
    : 0;
  const occupiedTenants = Math.max(0, Number(row.occupied_tenants) || activeRentals);
  const availableSlots = Math.max(0, maxTenants - occupiedTenants);
  const isAvailable = row.available !== false && availableSlots > 0;

  return {
    ...row,
    dorm_id: String(row.dorm_id),
    owner_id: String(row.owner_id ?? ''),
    name: String(row.name ?? 'Unnamed property'),
    address: String(row.address ?? 'Address unavailable'),
    price: Number(row.price) || 0,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    images: Array.isArray(row.images) ? row.images.filter((item: unknown) => typeof item === 'string') : [],
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    utilities: Array.isArray(row.utilities) ? row.utilities : [],
    house_rules: Array.isArray(row.house_rules) ? row.house_rules : [],
    max_tenants: maxTenants,
    occupied_tenants: occupiedTenants,
    available_slots: availableSlots,
    available: isAvailable,
    availability_status: isAvailable ? getAvailability(row) : 'unavailable',
    rating_average: Math.round(ratingAverage * 10) / 10,
    rating_count: ratingCount,
    distance_km: null,
    ranking_score: 0,
  };
}

function includesEvery(source: string[], selected: string[]) {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalized = source.map(clean);
  return selected.every((item) => normalized.some((value) => value.includes(clean(item))));
}

export function matchesDormFilters(dorm: Dorm, filters: DormFilters, location: UserCoordinates | null) {
  const query = filters.query.trim().toLowerCase();
  const searchable = [dorm.name, dorm.address, ...dorm.amenities, ...dorm.utilities]
    .join(' ')
    .toLowerCase();

  if (query && !searchable.includes(query)) return false;
  if (filters.minPrice !== null && dorm.price < filters.minPrice) return false;
  if (filters.maxPrice !== null && dorm.price > filters.maxPrice) return false;
  if (filters.genderPolicy && dorm.gender_policy?.toLowerCase() !== filters.genderPolicy.toLowerCase()) return false;
  if (filters.lguCertified && !dorm.lgu_certified) return false;
  if (filters.petFriendly && !dorm.pet_friendly) return false;
  if (filters.parkingRequired && !dorm.parking_info) return false;
  if (filters.roomTypes.length > 0 && !filters.roomTypes.some((value) => dorm.room_type?.toLowerCase() === value.toLowerCase())) return false;
  if (filters.curfewPolicy === 'with-curfew' && !dorm.curfew) return false;
  if (filters.curfewPolicy === 'no-curfew' && dorm.curfew) return false;
  if (filters.onlyAvailable && dorm.availability_status !== 'available') return false;
  if (!includesEvery(dorm.amenities, filters.amenities)) return false;
  if (!includesEvery(dorm.utilities, filters.utilities)) return false;
  if (
    filters.parking.length > 0 &&
    !filters.parking.some((value) => dorm.parking_info?.toLowerCase().includes(value.toLowerCase()))
  ) return false;

  if (location && Number.isFinite(dorm.latitude) && Number.isFinite(dorm.longitude)) {
    if (getDistanceKm(location, dorm) > filters.radiusKm) return false;
  }
  return true;
}

function getPreferenceScore(dorm: Dorm, filters: DormFilters) {
  const checks = [
    !filters.lguCertified || Boolean(dorm.lgu_certified),
    !filters.petFriendly || Boolean(dorm.pet_friendly),
    !filters.genderPolicy || dorm.gender_policy?.toLowerCase() === filters.genderPolicy.toLowerCase(),
    filters.parking.length === 0 ||
      filters.parking.some((item) => dorm.parking_info?.toLowerCase().includes(item.toLowerCase())),
  ];
  const requested = [filters.lguCertified, filters.petFriendly, Boolean(filters.genderPolicy), filters.parking.length > 0]
    .filter(Boolean).length;
  if (requested === 0) return 0.5;
  const matched = checks.filter((value, index) => value && [filters.lguCertified, filters.petFriendly, Boolean(filters.genderPolicy), filters.parking.length > 0][index]).length;
  return matched / requested;
}

export function rankDorms(
  dorms: Dorm[],
  filters: DormFilters = DEFAULT_DORM_FILTERS,
  location: UserCoordinates | null = null,
) {
  return dorms
    .map((dorm) => {
      const hasCoordinates = Number.isFinite(dorm.latitude) && Number.isFinite(dorm.longitude);
      const distanceKm = location && hasCoordinates ? getDistanceKm(location, dorm) : null;
      const ratingQuality = (dorm.rating_average / 5) * 45;
      const ratingConfidence = Math.min(Math.log1p(dorm.rating_count) / Math.log1p(20), 1) * 15;
      const distanceScore = distanceKm === null
        ? 12.5
        : Math.max(0, 1 - distanceKm / Math.max(filters.radiusKm, 1)) * 25;
      const score =
        ratingQuality +
        ratingConfidence +
        distanceScore +
        getPreferenceScore(dorm, filters) * 10 +
    (dorm.available_slots > 0 ? 5 : 0) +
        (dorm.is_featured ? 2 : 0);

      return {
        ...dorm,
        distance_km: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
        ranking_score: Math.round(Math.min(100, score)),
      };
    })
    .sort((left, right) =>
      right.ranking_score - left.ranking_score ||
      right.rating_average - left.rating_average ||
      left.price - right.price,
    );
}

export function filterAndRankDorms(dorms: Dorm[], filters: DormFilters, location: UserCoordinates | null) {
  return rankDorms(dorms.filter((dorm) => matchesDormFilters(dorm, filters, location)), filters, location);
}

export function formatPeso(value: number) {
  return `₱${Math.round(value).toLocaleString('en-PH')}`;
}

export function getPriceBand(price: number, average: number) {
  if (average > 0 && price <= average * 0.85) return 'cheaper' as const;
  if (average > 0 && price >= average * 1.15) return 'expensive' as const;
  return 'average' as const;
}

export interface DemandPredictionResult {
  level: 'high' | 'moderate' | 'low';
  label: string;
  badge: string;
  occupancyRate: number;
  availableSlots: number;
  color: string;
}

export function getDemandPrediction(dorm: Dorm): DemandPredictionResult {
  const maxTenants = Math.max(1, dorm.max_tenants || 1);
  const occupied = Math.min(maxTenants, Math.max(0, dorm.occupied_tenants || 0));
  const availableSlots = Math.max(0, dorm.available_slots ?? (maxTenants - occupied));
  const occupancyRate = Math.round((occupied / maxTenants) * 100);

  // High demand: >=75% occupied OR 2 or fewer slots left OR high ranking score
  if (!dorm.available || availableSlots === 0 || occupancyRate >= 75 || availableSlots <= 2) {
    return {
      level: 'high',
      label: 'Likely to become fully occupied soon',
      badge: '🔥 High Demand',
      occupancyRate,
      availableSlots,
      color: '#EF4444',
    };
  }

  // Moderate demand: >=40% occupied OR rating >= 4.0
  if (occupancyRate >= 40 || (dorm.rating_average || 0) >= 4.0) {
    return {
      level: 'moderate',
      label: 'Moderate occupancy velocity',
      badge: '⚡ Moderate Demand',
      occupancyRate,
      availableSlots,
      color: '#FBBF24',
    };
  }

  return {
    level: 'low',
    label: 'Normal availability',
    badge: '🟢 Steady Availability',
    occupancyRate,
    availableSlots,
    color: '#34D399',
  };
}

