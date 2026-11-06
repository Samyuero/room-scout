import type { Dorm } from '@/types/dorm';

/** Visibility only: never clear the owner's/admin's stored featured flag. */
export function canShowFeaturedDorm(dorm: Dorm): boolean {
  return dorm.is_featured === true && dorm.available === true && dorm.availability_status === 'available'
    && dorm.available_slots > 0 && dorm.occupied_tenants < dorm.max_tenants && dorm.status !== 'inactive';
}
