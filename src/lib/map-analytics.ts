import { getDistanceKm, getPriceBand } from './dorm-discovery';
import { DEFAULT_DORM_FILTERS, type Dorm, type DormFilters, type UserCoordinates } from '../types/dorm';

export interface MapBounds { south: number; west: number; north: number; east: number }
export interface PriceArea { id: string; bounds: MapBounds; center: UserCoordinates; radiusMeters: number; count: number; average: number; band: 'cheaper' | 'average' | 'expensive' }
export interface DemandArea { id: string; center: UserCoordinates; radiusMeters: number; count: number; score: number; level: 'low' | 'moderate' | 'high'; label: string }
type DemandForecast = { level: 'low' | 'moderate' | 'high' };
export interface DemandHistory {
  dorm_id: string;
  inquiries_30d: number;
  prior_inquiries_30d: number;
  bookings_30d: number;
  prior_bookings_30d: number;
  observed_days: number;
}
export interface DemandPortfolio extends Omit<DemandHistory, 'dorm_id'> {
  listing_count: number;
  inquiries_all_time: number;
  bookings_all_time: number;
  monthly_history: { month: string; inquiries: number; bookings: number }[];
}
export interface DemandContext { generated_at: string; horizon_days: number; listings: DemandHistory[]; portfolio: DemandPortfolio }
export const MAP_COLORS = {
  near: '#34D399', edge: '#3B82F6', far: '#F87171',
  cheaper: '#34D399', average: '#FBBF24', expensive: '#F87171',
  high: '#F87171', moderate: '#FBBF24', low: '#34D399', insufficient: '#94A3B8',
} as const;

export function demandLabel(level: 'low' | 'moderate' | 'high') {
  return level === 'high' ? 'High' : level === 'moderate' ? 'Moderate' : 'Low';
}

/** A categorical index, not a booking probability: Low=1, Moderate=2, High=3. */
export function averageDemand(forecasts: (DemandForecast | undefined)[] = []): { count: number; score: number | null; level: DemandForecast['level'] | null; label: string; color: string } {
  const values = forecasts.filter((item): item is { level: 'low' | 'moderate' | 'high' } => !!item && ['low','moderate','high'].includes(item.level));
  if (!values.length) return { count: 0, score: null, level: null, label: 'No forecasts', color: MAP_COLORS.insufficient };
  const score = values.reduce((sum,item) => sum + (item.level === 'high' ? 3 : item.level === 'moderate' ? 2 : 1),0) / values.length;
  const level: DemandForecast['level'] = score < 1.5 ? 'low' : score < 2.5 ? 'moderate' : 'high';
  return { count: values.length, score, level, label: demandLabel(level), color: MAP_COLORS[level] };
}

/** The card describes the chosen radius, or the visible map when no origin is selected. */
export function getAreaDemandSummary(dorms: Dorm[], forecasts: Record<string, DemandForecast>, anchor: UserCoordinates | null, radiusKm: number, bounds: MapBounds | null) {
  const areaDorms = dorms.filter((dorm) => anchor
    ? getDistanceKm(anchor, dorm) <= radiusKm
    : !bounds || isInsideBounds(dorm, bounds));
  return averageDemand(areaDorms.map((dorm) => forecasts[dorm.dorm_id]));
}

/** Reuse Price's geographic grid, then average forecasts inside each actual circular radius. */
export function aggregateDemandAreas(dorms: Dorm[], forecasts: Record<string, DemandForecast>): DemandArea[] {
  const cellDegrees = 0.005;
  const cells = new Map<string, { row: number; column: number }>();
  dorms.forEach((dorm) => {
    const forecast = forecasts[dorm.dorm_id];
    if (!forecast || !Number.isFinite(dorm.latitude) || !Number.isFinite(dorm.longitude)) return;
    const row = Math.floor(dorm.latitude / cellDegrees);
    const column = Math.floor(dorm.longitude / cellDegrees);
    const id = `${row}:${column}`;
    cells.set(id, { row, column });
  });
  return [...cells.entries()].flatMap(([id, cell]) => {
    const center = { latitude: (cell.row + 0.5) * cellDegrees, longitude: (cell.column + 0.5) * cellDegrees };
    // 400m covers each ~550m cell's corners; adjacent circles can overlap naturally.
    const radiusMeters = 400;
    const average = averageDemand(dorms.filter((dorm) => getDistanceKm(center, dorm) <= radiusMeters / 1000).map((dorm) => forecasts[dorm.dorm_id]));
    if (average.score === null || average.level === null) return [];
    return [{ id, count: average.count, score: average.score, level: average.level, label: average.label,
      center, radiusMeters }];
  });
}

/** Explicit Locate/Reset starts an exploration, not a stale strict search. Radius colors never hide pins. */
export function mapExplorationFilters(radiusKm: number): DormFilters {
  return { ...DEFAULT_DORM_FILTERS, amenities: [], utilities: [], parking: [], roomTypes: [], onlyAvailable: false, radiusEnabled: false, radiusKm: Number.isFinite(radiusKm) && radiusKm >= 0.1 && radiusKm <= 20000 ? radiusKm : 2 };
}

export function isInsideBounds(point: UserCoordinates, bounds: MapBounds) {
  const longitudeInside = bounds.west <= bounds.east
    ? point.longitude >= bounds.west && point.longitude <= bounds.east
    : point.longitude >= bounds.west || point.longitude <= bounds.east;
  return point.latitude >= bounds.south && point.latitude <= bounds.north && longitudeInside;
}

export function getVisiblePriceSummary(dorms: Dorm[], bounds: MapBounds | null) {
  const visible = dorms.filter((dorm) => Number.isFinite(dorm.price) && dorm.price > 0 && (!bounds || isInsideBounds(dorm, bounds)));
  return { count: visible.length, average: visible.length ? visible.reduce((sum, dorm) => sum + dorm.price, 0) / visible.length : 0 };
}

/** Group listings into fixed ~550m areas, displayed as circles (not per-property heat spots). */
export function aggregatePriceAreas(dorms: Dorm[], referenceAverage: number): PriceArea[] {
  const cellDegrees = 0.005;
  const cells = new Map<string, { row: number; column: number; count: number; total: number }>();
  dorms.forEach((dorm) => {
    if (!Number.isFinite(dorm.latitude) || !Number.isFinite(dorm.longitude) || dorm.price <= 0) return;
    const row = Math.floor(dorm.latitude / cellDegrees);
    const column = Math.floor(dorm.longitude / cellDegrees);
    const key = `${row}:${column}`;
    const cell = cells.get(key) ?? { row, column, count: 0, total: 0 };
    cell.count += 1;
    cell.total += dorm.price;
    cells.set(key, cell);
  });
  return [...cells.entries()].map(([id, cell]) => ({
    id, count: cell.count, average: cell.total / cell.count,
    band: getPriceBand(cell.total / cell.count, referenceAverage),
    bounds: { south: cell.row * cellDegrees, north: (cell.row + 1) * cellDegrees, west: cell.column * cellDegrees, east: (cell.column + 1) * cellDegrees },
    center: { latitude: (cell.row + 0.5) * cellDegrees, longitude: (cell.column + 0.5) * cellDegrees },
    radiusMeters: 280,
  }));
}

export function distanceBand(point: UserCoordinates, anchor: UserCoordinates, radiusKm: number) {
  const distance = getDistanceKm(anchor, point);
  if (distance > radiusKm) return 'far' as const;
  return distance <= radiusKm * 0.7 ? 'near' as const : 'edge' as const;
}

export function historicalDemand(dorm: Dorm, history?: DemandHistory, portfolio?: DemandPortfolio) {
  const count = (value: unknown) => Math.max(0, Number(value) || 0);
  const recent = count(history?.inquiries_30d);
  const prior = count(history?.prior_inquiries_30d);
  const bookings = count(history?.bookings_30d);
  const priorBookings = count(history?.prior_bookings_30d);
  const sufficientHistory = count(history?.observed_days) >= 30 && recent + prior + bookings + priorBookings >= 3;
  // Smoothed 30-day forecast: recent activity is weighted twice; trend is capped to limit outliers.
  // New listings borrow a pooled prior from ALL published listings, not invented local activity.
  const listingCount = Math.max(1, count(portfolio?.listing_count));
  const portfolioRecent = count(portfolio?.inquiries_30d) / listingCount;
  const portfolioPrior = count(portfolio?.prior_inquiries_30d) / listingCount;
  const ownWeight = sufficientHistory ? 0.85 : Math.min(0.5, count(history?.observed_days) / 60);
  const baseline = (recent * 2 + prior) / 3;
  const pooledBaseline = (portfolioRecent * 2 + portfolioPrior) / 3;
  const priorTrend = prior > 0 ? (recent + 2) / (prior + 2) : portfolioPrior > 0 ? (portfolioRecent + 2) / (portfolioPrior + 2) : 1;
  const trend = Math.max(0.75, Math.min(1.5, priorTrend));
  const hasActivity = recent + prior + count(portfolio?.inquiries_all_time) + count(portfolio?.bookings_all_time) > 0;
  const estimatedInquiries = hasActivity ? Math.round((baseline * ownWeight + pooledBaseline * (1-ownWeight)) * trend) : null;
  const expectedBookings = bookings * ownWeight + count(portfolio?.bookings_30d) / listingCount * (1-ownWeight);
  const pressure = ((estimatedInquiries ?? 0) * 0.6 + expectedBookings * 2) / Math.max(1, dorm.available_slots);
  const level = pressure >= 4 ? 'high' as const : pressure >= 1.5 ? 'moderate' as const : 'low' as const;
  return {
    level, sufficientHistory, horizonDays: 30, estimatedInquiries, source: 'history' as 'history' | 'gemini',
    color: MAP_COLORS[level],
    badge: demandLabel(level),
    reason: sufficientHistory
      ? `Next 30 days: about ${estimatedInquiries} inquiries, based on ${recent} inquiries and ${bookings} bookings in the last 30 days. Estimate, not a guarantee.`
      : hasActivity ? `Next 30 days: pooled estimate using activity across ${listingCount} published listings and this dorm's history. Estimate, not a guarantee.`
        : 'Early estimate: no recorded booking activity yet. This is not a measured demand level or a guarantee.',
  };
}
