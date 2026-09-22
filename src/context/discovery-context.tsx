import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { isPhilippinesCoordinates, UCLM_COORDINATES } from '@/constants/map';
import { filterAndRankDorms, normalizeDorm, rankDorms } from '@/lib/dorm-discovery';
import { getErrorMessage, logEvent } from '@/lib/logger';
import { isSupabaseConfigured, supabase, supabaseConfigurationMessage } from '@/lib/supabase';
import {
  DEFAULT_DORM_FILTERS,
  type Dorm,
  type DormFilters,
  type UserCoordinates,
} from '@/types/dorm';


const DORMS_CACHE_KEY = 'room_scout_dorms_v1';
const COMPARE_CACHE_KEY = 'room_scout_compare_v1';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const COMPARE_LIMIT = 3;

type CompareResult = 'added' | 'removed' | 'limit';

interface DiscoveryValue {
  dorms: Dorm[];
  rankedDorms: Dorm[];
  nearbyDorms: Dorm[];
  filters: DormFilters;
  setFilters: (filters: DormFilters) => void;
  resetFilters: () => void;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  isUsingCachedData: boolean;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  location: UserCoordinates | null;
  locationLoading: boolean;
  locationMessage: string | null;
  requestLocation: () => Promise<void>;
  compareIds: string[];
  comparedDorms: Dorm[];
  toggleCompare: (dormId: string) => CompareResult;
  clearCompare: () => void;
}

const DiscoveryContext = createContext<DiscoveryValue | null>(null);

export function DiscoveryProvider({ children }: PropsWithChildren) {
  const [dorms, setDorms] = useState<Dorm[]>([]);
  const [filters, setFilters] = useState<DormFilters>(DEFAULT_DORM_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(supabaseConfigurationMessage);
  const [isUsingCachedData, setIsUsingCachedData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [location, setLocation] = useState<UserCoordinates | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storeDorms = useCallback(async (nextDorms: Dorm[]) => {
    const now = Date.now();
    setDorms(nextDorms);
    setLastUpdated(new Date(now).toISOString());
    await AsyncStorage.setItem(DORMS_CACHE_KEY, JSON.stringify({ timestamp: now, value: nextDorms }));
  }, []);

  const fetchDorms = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      let response = await supabase.from('dorms').select('*, dorm_reviews(rating)').limit(200);
      if (response.error) response = await supabase.from('dorms').select('*').limit(200);
      if (response.error) throw response.error;

      const normalized = (response.data || []).map((row) => normalizeDorm(row));
      await storeDorms(normalized);
      setIsUsingCachedData(false);
      setError(null);
      logEvent('info', 'dorms_refreshed', { count: normalized.length });
    } catch (caught) {
      const message = getErrorMessage(caught, 'Could not refresh dorms.');
      setError(message);
      logEvent('error', 'dorms_refresh_failed', { message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [storeDorms]);

  useEffect(() => {
    let active = true;

    async function preload() {
      try {
        const [cachedDorms, cachedCompare] = await Promise.all([
          AsyncStorage.getItem(DORMS_CACHE_KEY),
          AsyncStorage.getItem(COMPARE_CACHE_KEY),
        ]);
        if (!active) return;

        if (cachedCompare) {
          const ids = JSON.parse(cachedCompare);
          if (Array.isArray(ids)) setCompareIds(ids.slice(0, COMPARE_LIMIT));
        }
        if (cachedDorms) {
          const parsed = JSON.parse(cachedDorms) as { timestamp: number; value: Dorm[] };
          if (Array.isArray(parsed.value) && Date.now() - parsed.timestamp < CACHE_MAX_AGE_MS) {
            setDorms(parsed.value);
            setLastUpdated(new Date(parsed.timestamp).toISOString());
            setIsUsingCachedData(true);
            setLoading(false);
          }
        }
      } catch (caught) {
        logEvent('warn', 'discovery_cache_read_failed', { message: getErrorMessage(caught) });
      }
      if (active) await fetchDorms(true);
    }

    preload();
    return () => {
      active = false;
    };
  }, [fetchDorms]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const scheduleRefresh = () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = setTimeout(() => fetchDorms(true), 350);
    };
    const channel = supabase
      .channel('room-scout-discovery')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dorms' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dorm_reviews' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [fetchDorms]);

  useEffect(() => {
    async function restoreGrantedLocation() {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') return;
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown && isPhilippinesCoordinates(lastKnown.coords)) {
        setLocation({ latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude });
      } else {
        setLocation({ latitude: UCLM_COORDINATES.latitude, longitude: UCLM_COORDINATES.longitude });
      }
    }
    restoreGrantedLocation().catch((caught) => {
      logEvent('warn', 'last_location_read_failed', { message: getErrorMessage(caught) });
    });
  }, []);

  const requestLocation = useCallback(async () => {
    setLocationLoading(true);
    setLocationMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationMessage('Location is off. Search by area and price is still available.');
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (current?.coords && isPhilippinesCoordinates(current.coords)) {
        setLocation({ latitude: current.coords.latitude, longitude: current.coords.longitude });
        setLocationMessage('Nearby ranking is using your current location.');
      } else {
        setLocation({ latitude: UCLM_COORDINATES.latitude, longitude: UCLM_COORDINATES.longitude });
        setLocationMessage('Location centered on Opao, Mandaue City.');
      }
      logEvent('info', 'nearby_ranking_enabled');
    } catch (caught) {
      const message = getErrorMessage(caught, 'Could not get your location.');
      setLocationMessage(message);
      logEvent('error', 'location_request_failed', { message });
    } finally {
      setLocationLoading(false);
    }
  }, []);


  const toggleCompare = useCallback((dormId: string): CompareResult => {
    let result: CompareResult = 'added';
    setCompareIds((current) => {
      let next: string[];
      if (current.includes(dormId)) {
        result = 'removed';
        next = current.filter((id) => id !== dormId);
      } else if (current.length >= COMPARE_LIMIT) {
        result = 'limit';
        return current;
      } else {
        next = [...current, dormId];
      }
      void AsyncStorage.setItem(COMPARE_CACHE_KEY, JSON.stringify(next));
      return next;
    });
    return result;
  }, []);

  const clearCompare = useCallback(() => {
    setCompareIds([]);
    void AsyncStorage.removeItem(COMPARE_CACHE_KEY);
  }, []);

  const rankedDorms = useMemo(
    () => filterAndRankDorms(dorms, filters, location),
    [dorms, filters, location],
  );
  const nearbyDorms = useMemo(
    () => rankDorms(dorms.filter((dorm) => dorm.availability_status === 'available'), filters, location),
    [dorms, filters, location],
  );
  const comparedDorms = useMemo(
    () => compareIds.map((id) => dorms.find((dorm) => dorm.dorm_id === id)).filter(Boolean) as Dorm[],
    [compareIds, dorms],
  );

  const value: DiscoveryValue = {
    dorms,
    rankedDorms,
    nearbyDorms,
    filters,
    setFilters,
    resetFilters: () => setFilters(DEFAULT_DORM_FILTERS),
    loading,
    refreshing,
    error,
    isUsingCachedData,
    lastUpdated,
    refresh: () => fetchDorms(true),
    location,
    locationLoading,
    locationMessage,
    requestLocation,
    compareIds,
    comparedDorms,
    toggleCompare,
    clearCompare,
  };

  return <DiscoveryContext.Provider value={value}>{children}</DiscoveryContext.Provider>;
}

export function useDiscovery() {
  const value = use(DiscoveryContext);
  if (!value) throw new Error('useDiscovery must be used inside DiscoveryProvider');
  return value;
}
