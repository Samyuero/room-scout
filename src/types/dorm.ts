export type DormAvailability = 'available' | 'reserved' | 'unavailable';

export interface DormReviewSummary {
  rating: number;
}

/** Supabase-facing shape. Database fields intentionally stay snake_case. */
export interface Dorm {
  dorm_id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  address: string;
  price: number;
  latitude: number;
  longitude: number;
  images: string[];
  amenities: string[];
  utilities: string[];
  gender_policy?: string | null;
  curfew?: string | null;
  available: boolean;
  availability_status?: DormAvailability | null;
  approval_status?: 'pending' | 'approved' | 'rejected' | null;
  status?: 'active' | 'inactive' | null;
  lgu_certified?: boolean | null;
  pet_friendly?: boolean | null;
  parking_info?: string | null;
  reservation_fee?: number | null;
  house_rules?: string[] | null;
  room_type?: string | null;
  furnished?: boolean | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  owner_display_name?: string | null;
  max_tenants: number;
  occupied_tenants: number;
  available_slots: number;
  is_featured?: boolean | null;
  created_at?: string;
  updated_at?: string;
  dorm_reviews?: DormReviewSummary[];
  rating_average: number;
  rating_count: number;
  distance_km: number | null;
  ranking_score: number;
}

export interface UserCoordinates {
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
}

/** A chosen school/place is a search anchor, never a claim about the device's GPS position. */
export interface SearchOrigin extends UserCoordinates {
  label: string;
  kind: 'school' | 'place';
}

/** Private preferences belonging only to the signed-in renter. */
export interface DormPreferences {
  amenities?: string[];
  utilities?: string[];
  house_rules?: string[];
  gender_policy?: string;
  curfew?: string;
  room_type?: string;
  lgu_certified?: boolean;
  furnished?: boolean;
  budget_min?: number | null;
  budget_max?: number | null;
  preferred_location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius_km?: number | null;
  parking?: string | null;
  pet_friendly?: boolean | null;
}

export interface DormFilters {
  query: string;
  minPrice: number | null;
  maxPrice: number | null;
  genderPolicy: string;
  amenities: string[];
  utilities: string[];
  lguCertified: boolean;
  petFriendly: boolean;
  parking: string[];
  parkingRequired: boolean;
  roomTypes: string[];
  curfewPolicy: '' | 'with-curfew' | 'no-curfew';
  radiusKm: number;
  radiusEnabled?: boolean;
  onlyAvailable: boolean;
}

export const DEFAULT_DORM_FILTERS: DormFilters = {
  query: '',
  minPrice: null,
  maxPrice: null,
  genderPolicy: '',
  amenities: [],
  utilities: [],
  lguCertified: false,
  petFriendly: false,
  parking: [],
  parkingRequired: false,
  roomTypes: [],
  curfewPolicy: '',
  radiusKm: 5,
  radiusEnabled: false,
  onlyAvailable: true,
};
