const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}, cache = new Map()) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const requireLocal = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    const target = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : path.resolve(path.dirname(file), name);
    const extension = target.endsWith('.tsx') || target.endsWith('.ts') ? '' : '.ts';
    return load(target + extension, mocks, cache);
  };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: requireLocal, Map, Set, Math, Number, String, Object, Array,
    // Effects are skipped in component tests; location's timeout must not keep the test process alive.
    setTimeout: () => 0, clearTimeout: () => {}, console });
  cache.set(file, module.exports);
  return module.exports;
}

const { DEFAULT_DORM_FILTERS } = load('src/types/dorm.ts');
const analytics = load('src/lib/map-analytics.ts');

test('map exploration clears stale query/radius/availability/feature constraints', () => {
  const next = analytics.mapExplorationFilters(2.5);
  assert.equal(next.query, '');
  assert.equal(next.radiusKm, 2.5);
  assert.equal(next.radiusEnabled, false);
  assert.equal(next.onlyAvailable, false);
  for (const field of ['minPrice', 'maxPrice']) assert.equal(next[field], null);
  for (const field of ['genderPolicy', 'curfewPolicy']) assert.equal(next[field], '');
  for (const field of ['lguCertified', 'petFriendly', 'parkingRequired']) assert.equal(next[field], false);
  for (const field of ['amenities', 'utilities', 'parking', 'roomTypes']) assert.equal(next[field].length, 0);
});

test('map exploration returns fresh arrays and rejects invalid radius values', () => {
  const first = analytics.mapExplorationFilters(2);
  first.amenities.push('Do not leak this filter');
  first.parking.push('Car');
  const second = analytics.mapExplorationFilters(2);
  assert.equal(second.amenities.length, 0);
  assert.equal(second.parking.length, 0);
  assert.equal(DEFAULT_DORM_FILTERS.amenities.length, 0);
  for (const invalid of [0, -1, NaN, Infinity, 20001]) {
    assert.equal(analytics.mapExplorationFilters(invalid).radiusKm, 2);
  }
});

test('average demand handles no forecasts without inventing a category', () => {
  for (const input of [undefined, [], [undefined]]) {
    const average = analytics.averageDemand(input);
    assert.equal(average.count, 0);
    assert.equal(average.score, null);
    assert.equal(average.level, null);
    assert.match(average.label, /no forecasts/i);
  }
});

test('average demand uses all forecasts and stable low/moderate/high thresholds', () => {
  const scenarios = [
    [['low'], 1, 'low'],
    [['moderate'], 2, 'moderate'],
    [['high'], 3, 'high'],
    [['low', 'moderate'], 1.5, 'moderate'],
    [['moderate', 'high'], 2.5, 'high'],
    [['low', 'moderate', 'high'], 2, 'moderate'],
  ];
  for (const [levels, score, level] of scenarios) {
    const input = levels.map((value) => ({ level: value }));
    const result = analytics.averageDemand(input);
    assert.equal(result.count, levels.length);
    assert.equal(result.score, score);
    assert.equal(result.level, level);
    assert.equal(result.color, analytics.MAP_COLORS[level]);
    assert.match(result.label.toLowerCase(), new RegExp(`^${level}`));
    assert.equal(JSON.stringify(analytics.averageDemand(input)), JSON.stringify(result));
  }
});

function providerForLocation(locationApi) {
  const source = readFileSync('src/context/discovery-context.tsx', 'utf8');
  const stateNames = [...source.matchAll(/\[(\w+),\s*\w+\]\s*=\s*useState/g)].map((match) => match[1]);
  let stateIndex = 0;
  const updates = new Map();
  const stale = { latitude: 10.4, longitude: 123.8, accuracy_m: 50 };
  const jsx = (type, props) => ({ type, props });
  const mocks = {
    react: {
      createContext: () => ({ Provider: 'Provider' }),
      useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: () => {}, useRef: (value) => ({ current: value }),
      useState: (initial) => {
        const name = stateNames[stateIndex++];
        return [name === 'location' ? stale : initial, (value) => updates.set(name, value)];
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'android' } },
    '@react-native-async-storage/async-storage': { default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
    'expo-location': { Accuracy: { High: 4 }, requestForegroundPermissionsAsync: async () => ({ status: 'granted' }), hasServicesEnabledAsync: async () => true,
      enableNetworkProviderAsync: async () => {}, getCurrentPositionAsync: async () => null, getLastKnownPositionAsync: async () => null, ...locationApi },
    '@/lib/supabase': { isSupabaseConfigured: false, supabaseConfigurationMessage: null, supabase: {} },
    '@/lib/logger': { getErrorMessage: (error) => error?.message || 'Could not get your location.', logEvent: () => {} },
  };
  const { DiscoveryProvider } = load('src/context/discovery-context.tsx', mocks);
  return { value: DiscoveryProvider({ children: null }).props.value, updates };
}

test('Locate returns null and clears stale device position when permission is denied', async () => {
  const { value, updates } = providerForLocation({ requestForegroundPermissionsAsync: async () => ({ status: 'denied' }) });
  assert.equal(await value.requestLocation(), null);
  assert.equal(updates.get('location'), null);
  assert.equal(updates.get('locationLoading'), false);
});

test('Locate returns null and clears stale device position when services are off', async () => {
  const { value, updates } = providerForLocation({ hasServicesEnabledAsync: async () => false, enableNetworkProviderAsync: async () => { throw new Error('User declined'); } });
  assert.equal(await value.requestLocation(), null);
  assert.equal(updates.get('location'), null);
});

test('Locate returns null and clears stale device position after provider failure', async () => {
  const { value, updates } = providerForLocation({ getCurrentPositionAsync: async () => { throw new Error('GPS unavailable'); } });
  assert.equal(await value.requestLocation(), null);
  assert.equal(updates.get('location'), null);
});

test('successful Locate returns actual device coordinates, never default Opao coordinates', async () => {
  const coords = { latitude: 10.33111, longitude: 123.94777, accuracy: 15 };
  const { value, updates } = providerForLocation({ getCurrentPositionAsync: async () => ({ coords }) });
  const result = await value.requestLocation();
  assert.equal(result.latitude, coords.latitude);
  assert.equal(result.longitude, coords.longitude);
  assert.equal(updates.get('location').latitude, coords.latitude);
});

test('map exposes clear/reset/show-all controls, keeps the same pin dataset across analytics', () => {
  const map = readFileSync('app/(tabs)/map.tsx', 'utf8');
  const leaflet = readFileSync('src/components/leaflet-map-view.tsx', 'utf8');
  const context = readFileSync('src/context/discovery-context.tsx', 'utf8');
  assert.match(context, /requestLocation:\s*\(\)\s*=>\s*Promise<UserCoordinates\s*\|\s*null>/);
  assert.match(map, /Clear school|Clear selected school|Clear location/i);
  assert.match(map, /Reset map/i);
  assert.match(map, /Show all/i);
  assert.match(map, /default.*Opao|Opao.*default/i);
  assert.match(map, /averageDemand\(/);
  assert.match(map, /dorms=\{validDorms\}/);
  assert.doesNotMatch(map, /dorms=\{mode\s*===/);
  assert.doesNotMatch(`${map}\n${leaflet}\n${readFileSync('src/lib/map-analytics.ts', 'utf8')}`, /Steady demand|\['Steady'/);
  assert.match(readFileSync('src/components/school-picker.tsx', 'utf8'), /onClear/);
});

test('failed Locate resets stale filters and shows all pins around a labelled default, then clear/reset preserve browsing', async () => {
  const { normalizeDorm } = load('src/lib/dorm-discovery.ts');
  const { OPAO_COORDINATES } = load('src/constants/map.ts');
  const makeDorm = (id, extra) => normalizeDorm({ dorm_id: id, name: id, address: 'Opao', price: 4000, ...OPAO_COORDINATES, max_tenants: 3, available: true, ...extra });
  const nearby = makeDorm('nearby', {});
  const far = makeDorm('far-unavailable', { latitude: OPAO_COORDINATES.latitude + 0.1, available: false });
  let refreshCount = 0;
  const context = {
    allRankedDorms: [nearby, far],
    filters: { ...DEFAULT_DORM_FILTERS, query: 'impossible stale query', maxPrice: 1, radiusEnabled: true, radiusKm: 1 },
    location: { latitude: 10.7, longitude: 123.2 },
    searchOrigin: null, hasPreferences: false, loading: false, refreshing: false, locationLoading: false, locationMessage: null,
    setFilters: (filters) => { context.filters = filters; }, setSearchOrigin: (origin) => { context.searchOrigin = origin; },
    setHasSearched: (searched) => { context.hasSearched = searched; },
    requestLocation: async () => { context.location = null; return null; }, refresh: async () => { refreshCount += 1; },
  };
  let cursor = 0;
  const slots = [];
  const jsx = (type, props) => ({ type, props });
  const useState = (initial) => {
    const index = cursor++;
    if (index >= slots.length) slots.push(initial);
    return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  };
  const mocks = {
    react: { useState, useRef: (initial) => { const index = cursor++; if (index >= slots.length) slots.push({ current: initial }); return slots[index]; }, useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect: () => {} },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: { alert() {} }, Linking: { openURL: async () => {} }, Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: (value) => value }, Text: 'Text', TextInput: 'TextInput', View: 'View', useWindowDimensions: () => ({ width: 360, height: 800, fontScale: 1 }) },
    '@expo/vector-icons': { Ionicons: 'Icon' }, 'expo-router': { useRouter: () => ({ push() {} }), useLocalSearchParams: () => ({}) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 24 }) },
    '@/components/discovery-search': { DiscoverySearchBar: 'SearchBar', DiscoverySearchSheet: 'SearchSheet' },
    '@/components/error-toast': { showWarning() {} },
    '@/components/leaflet-map-view': { LeafletMapView: 'LeafletMapView' }, '@/components/school-picker': { SchoolPicker: 'SchoolPicker' },
    '@/constants/theme': { AppColors: {}, BorderRadius: {} }, '@/context/discovery-context': { useDiscovery: () => context }, '@/hooks/useAuth': { useAuth: () => ({ user: null }) },
    '@/lib/geocoding': { searchPlaces: async () => [] }, '@/lib/logger': { logEvent() {}, getErrorMessage: (error) => error?.message || 'Error' },
    '@/lib/gemini-assistant': { predictDormDemand: async () => [], getAssistantQuotaWarning: () => null }, '@/lib/supabase': { supabase: { rpc: async () => ({ data: null, error: new Error('Offline fixture') }) } },
  };
  const MapScreen = load('app/(tabs)/map.tsx', mocks).default;
  let tree;
  function render() { cursor = 0; tree = MapScreen(); return tree; }
  function walk(node, predicate) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const child of node) { const found = walk(child, predicate); if (found) return found; } return null; }
    if (predicate(node)) return node;
    return walk(node.props?.children, predicate);
  }
  function text(node) {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(text).join('');
    return node && typeof node === 'object' ? text(node.props?.children) : '';
  }
  const button = (label) => walk(tree, (node) => node.type === 'Pressable' && text(node) === label);
  const map = () => walk(tree, (node) => node.type === 'LeafletMapView').props;
  render();
  assert.equal(map().dorms.length, 0);
  button('Locate me').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  render();
  assert.equal(context.filters.query, ''); assert.equal(context.filters.onlyAvailable, false); assert.equal(context.filters.radiusEnabled, false);
  assert.equal(map().dorms.length, 2); assert.equal(map().userLocation, null); assert.equal(map().anchor.kind, 'default');
  assert.match(map().anchor.label, /Opao/i); assert.match(map().anchor.label, /default/i);
  assert.equal(analytics.distanceBand(far, map().anchor, map().radiusKm), 'far');
  assert.equal(map().fitAllDorms, true);
  button('Price').props.onPress(); render(); assert.equal(map().analyticsMode, 'price'); assert.equal(map().dorms.length, 2);
  button('Demand').props.onPress(); await new Promise((resolve) => setImmediate(resolve)); render(); assert.equal(map().analyticsMode, 'demand'); assert.equal(map().dorms.length, 2);
  button('Clear location').props.onPress(); render(); assert.equal(map().anchor, undefined); assert.equal(map().userLocation, null); assert.equal(map().dorms.length, 2);
  button('Reset map').props.onPress(); await new Promise((resolve) => setImmediate(resolve)); render(); assert.equal(refreshCount, 1); assert.equal(map().dorms.length, 2);
});

test('demand area circles average forecasts inside their actual radius, not individual listing values', () => {
  const dorms = [
    { dorm_id: 'low', latitude: 10.327, longitude: 123.957 },
    { dorm_id: 'high', latitude: 10.328, longitude: 123.958 },
    { dorm_id: 'far', latitude: 10.37, longitude: 123.99 },
    { dorm_id: 'pending', latitude: 10.3275, longitude: 123.9575 },
  ];
  const areas = analytics.aggregateDemandAreas(dorms, { low: { level: 'low' }, high: { level: 'high' }, far: { level: 'high' } });
  const near = areas.find((area) => area.count === 2);
  assert.ok(near);
  assert.equal(near.score, 2);
  assert.equal(near.level, 'moderate');
  assert.equal(near.radiusMeters, 400);
  assert.equal(areas.length, 2);
  const source = readFileSync('src/components/leaflet-map-view.tsx', 'utf8');
  assert.match(source, /data\.mode==='demand'\)data\.demandAreas/);
  assert.match(source, /radius:area\.radiusMeters/);
  assert.doesNotMatch(source, /L\.rectangle/);
});

test('demand card averages only its selected radius or viewport, without hiding outside pins', () => {
  const dorms = [{ dorm_id: 'near', latitude: 10.32, longitude: 123.95 }, { dorm_id: 'far', latitude: 10.42, longitude: 123.95 }];
  const forecasts = { near: { level: 'low' }, far: { level: 'high' } };
  assert.equal(analytics.getAreaDemandSummary(dorms, forecasts, dorms[0], 2, null).score, 1);
  assert.equal(analytics.getAreaDemandSummary(dorms, forecasts, null, 2, { south: 10.4, north: 10.5, west: 123.9, east: 124 }).score, 3);
  assert.equal(dorms.length, 2);
  assert.equal(analytics.averageDemand(Object.values(forecasts)).score, 2);
  const source = readFileSync('app/(tabs)/map.tsx', 'utf8');
  assert.doesNotMatch(source, /Browse without a location/);
  assert.match(source, /anchor && <Pressable[^\n]+Clear location/);
  assert.match(source, /SNAP-assisted forecast/);
  assert.doesNotMatch(source, /Gemini-assisted|Gemini is/);
});
