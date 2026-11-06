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
import { Platform } from 'react-native';
import { isPhilippinesCoordinates } from '@/constants/map';
import { filterAndRankDorms, hasDormPreferences, normalizeDorm, rankDorms } from '@/lib/dorm-discovery';
import { getErrorMessage, logEvent } from '@/lib/logger';
import { isSupabaseConfigured, supabase, supabaseConfigurationMessage } from '@/lib/supabase';
import {
  DEFAULT_DORM_FILTERS,
  type Dorm,
  type DormFilters,
  type DormPreferences,
  type UserCoordinates,
  type SearchOrigin,
} from '@/types/dorm';


const DORMS_CACHE_KEY = 'room_scout_dorms_v1';
const COMPARE_CACHE_KEY = 'room_scout_compare_v1';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const COMPARE_LIMIT = 2;

type CompareResult = 'added' | 'removed' | 'limit';

interface DiscoveryValue {
  dorms: Dorm[];
  allRankedDorms: Dorm[];
  rankedDorms: Dorm[];
  nearbyDorms: Dorm[];
  filters: DormFilters;
  hasSearched: boolean;
  setHasSearched: (searched: boolean) => void;
  setFilters: (filters: DormFilters) => void;
  resetFilters: () => void;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  isUsingCachedData: boolean;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  location: UserCoordinates | null;
  searchOrigin: SearchOrigin | null;
  searchLocation: UserCoordinates | null;
  setSearchOrigin: (origin: SearchOrigin | null) => void;
  locationLoading: boolean;
  locationMessage: string | null;
  preferences: DormPreferences | null;
  hasPreferences: boolean;
  refreshPreferences: () => Promise<void>;
  requestLocation: () => Promise<UserCoordinates | null>;
  compareIds: string[];
  comparedDorms: Dorm[];
  toggleCompare: (dormId: string) => CompareResult;
  clearCompare: () => void;
}

const DiscoveryContext = createContext<DiscoveryValue | null>(null);

export function DiscoveryProvider({ children }: PropsWithChildren) {
  const [dorms, setDorms] = useState<Dorm[]>([]);
  const [filters, setFilters] = useState<DormFilters>(DEFAULT_DORM_FILTERS);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(supabaseConfigurationMessage);
  const [isUsingCachedData, setIsUsingCachedData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [location, setLocation] = useState<UserCoordinates | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<DormPreferences | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferenceReadVersion = useRef(0);
  const preferenceOwner = useRef<string | null>(null);

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
      let response = await supabase
        .from('dorms')
        .select('*, dorm_reviews(rating)')
        .eq('approval_status', 'approved')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(200);
      if (response.error) {
        response = await supabase
          .from('dorms')
          .select('*')
          .eq('approval_status', 'approved')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(200);
      }
      if (response.error) throw response.error;

      const normalized = (response.data || []).map((row) => normalizeDorm(row));
      await storeDorms(normalized);
      setIsUsingCachedData(false);
      setError(null);
      // Successful background refreshes are intentionally quiet in development.
    } catch (caught) {
      const message = getErrorMessage(caught, 'Could not refresh dorms.');
      setError(message);
      logEvent('error', 'dorms_refresh_failed', { message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [storeDorms]);

  const refreshPreferences = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const version = ++preferenceReadVersion.current;
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      setPreferences(null);
      return;
    }
    const { data, error: preferenceError } = await supabase
      .from('renters')
      .select('behavior_preferences')
      .eq('renter_id', userId)
      .maybeSingle();
    if (preferenceError) {
      logEvent('warn', 'preferences_read_failed', { message: getErrorMessage(preferenceError) });
      return;
    }
    if (version === preferenceReadVersion.current) setPreferences((data?.behavior_preferences as DormPreferences | null) || null);
  }, []);

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
    void refreshPreferences();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextId = session?.user.id || null;
      if (preferenceOwner.current !== nextId) {
        preferenceOwner.current = nextId; preferenceReadVersion.current += 1;
        setPreferences(null); setFilters(DEFAULT_DORM_FILTERS); setSearchOrigin(null); setCompareIds([]); setHasSearched(false);
        void AsyncStorage.removeItem(COMPARE_CACHE_KEY);
      }
      setTimeout(() => void refreshPreferences(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refreshPreferences]);

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
        setLocation({
          latitude: lastKnown.coords.latitude,
          longitude: lastKnown.coords.longitude,
          accuracy_m: lastKnown.coords.accuracy,
        });
        setLocationMessage('Showing your most recent device location while GPS refreshes.');
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
        setLocation(null);
        setLocationMessage('Location is off. Search by area and price is still available.');
        return null;
      }

      let servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled && Platform.OS === 'android') {
        try {
          await Location.enableNetworkProviderAsync();
          servicesEnabled = await Location.hasServicesEnabledAsync();
        } catch {
          // The user can decline Android's high-accuracy prompt; keep the screen usable.
        }
      }
      if (!servicesEnabled) {
        setLocation(null);
        setLocationMessage('Turn on Location in Android settings, then tap Location again. The map remains centered on Opao.');
        return null;
      }

      const current = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
      ]);
      const fallback = current || await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
      if (fallback?.coords && isPhilippinesCoordinates(fallback.coords)) {
        const coordinates = {
          latitude: fallback.coords.latitude,
          longitude: fallback.coords.longitude,
          accuracy_m: fallback.coords.accuracy,
        };
        setLocation(coordinates);
        const accuracy = fallback.coords.accuracy ? ` (about ${Math.round(fallback.coords.accuracy)} m accuracy)` : '';
        setLocationMessage(`You are at ${fallback.coords.latitude.toFixed(5)}, ${fallback.coords.longitude.toFixed(5)}${accuracy}.`);
        logEvent('info', 'nearby_ranking_enabled');
        return coordinates;
      } else {
        setLocation(null);
        setLocationMessage('Current position is unavailable. The map is centered on Opao, Mandaue City—tap Location to retry.');
      }
      return null;
    } catch (caught) {
      setLocation(null);
      const message = getErrorMessage(caught, 'Could not get your location.');
      setLocationMessage(message);
      // A disabled GPS provider is a recoverable user state, not a red-screen application error.
      logEvent('warn', 'location_request_failed', { message });
      return null;
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

  const searchLocation = searchOrigin || location;
  const allRankedDorms = useMemo(
    () => rankDorms(dorms, filters, searchLocation, preferences),
    [dorms, filters, searchLocation, preferences],
  );
  const rankedDorms = useMemo(
    () => filters.radiusEnabled && !searchLocation ? [] : filterAndRankDorms(dorms, filters, searchLocation, preferences),
    [dorms, filters, searchLocation, preferences],
  );
  const nearbyDorms = useMemo(
    () => rankDorms(
      dorms.filter((dorm) => dorm.availability_status === 'available'),
      filters,
      location,
      preferences,
    ),
    [dorms, filters, location, preferences],
  );
  const comparedDorms = useMemo(
    () => compareIds.map((id) => allRankedDorms.find((dorm) => dorm.dorm_id === id)).filter(Boolean) as Dorm[],
    [allRankedDorms, compareIds],
  );

  const value: DiscoveryValue = {
    dorms,
    allRankedDorms,
    rankedDorms,
    nearbyDorms,
    filters,
    hasSearched,
    setHasSearched,
    setFilters,
    resetFilters: () => { setFilters(DEFAULT_DORM_FILTERS); setHasSearched(false); },
    loading,
    refreshing,
    error,
    isUsingCachedData,
    lastUpdated,
    refresh: () => fetchDorms(true),
    location,
    searchOrigin,
    searchLocation,
    setSearchOrigin,
    locationLoading,
    locationMessage,
    preferences,
    hasPreferences: hasDormPreferences(preferences),
    refreshPreferences,
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
