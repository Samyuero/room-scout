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
    return load(target + (/\.tsx?$/.test(target) ? '' : '.ts'), mocks, cache);
  };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: requireLocal, Math, Number, Object, String, Set, Map, Array, Boolean, console });
  cache.set(file, module.exports);
  return module.exports;
}

const { DEFAULT_DORM_FILTERS } = load('src/types/dorm.ts');
const { normalizeDorm, rankDorms, matchesDormQuery, filterAndRankDorms } = load('src/lib/dorm-discovery.ts');
const makeDorm = (id, overrides = {}) => normalizeDorm({ dorm_id: id, name: 'Test', address: 'Opao', available: true, max_tenants: 4, occupied_tenants: 0, latitude: 10.326, longitude: 123.956, amenities: ['Wi-Fi'], utilities: ['Electricity'], price: 4000, ...overrides });

test('short queries use word prefixes, never substrings inside utilities or unrelated words', () => {
  const testDorm = makeDorm('test');
  const lebron = makeDorm('lebron', { name: 'Lebron', address: '21 Payang' });
  assert.equal(matchesDormQuery(testDorm, 'Le'), false);
  assert.equal(matchesDormQuery(lebron, 'Le'), true);
  assert.deepEqual(Array.from(filterAndRankDorms([testDorm, lebron], { ...DEFAULT_DORM_FILTERS, query: 'Le' }, null), (dorm) => dorm.dorm_id), ['lebron']);
  assert.equal(matchesDormQuery(testDorm, 'Ele'), true);
  assert.equal(matchesDormQuery(testDorm, 'wifi'), true);
  assert.equal(matchesDormQuery(testDorm, 'wi-fi op'), true);
  assert.equal(matchesDormQuery(testDorm, 'Opao impossible'), false);
  assert.equal(matchesDormQuery(testDorm, '!!!'), false);
  assert.equal(matchesDormQuery(testDorm, '  '), true);
});

function uiContext(dorms, overrides = {}) {
  const filters = { ...DEFAULT_DORM_FILTERS };
  const preferences = { amenities: ['Wi-Fi'] };
  const allRankedDorms = rankDorms(dorms, filters, null, preferences);
  return { dorms, filters, preferences, allRankedDorms, rankedDorms: allRankedDorms, hasSearched: false, hasPreferences: true, compareIds: [], searchLocation: null, searchOrigin: null, loading: false, refreshing: false, error: null, refresh: async () => {}, resetFilters: () => {}, toggleCompare: () => 'added', setFilters: () => {}, setHasSearched: () => {}, setSearchOrigin: () => {}, requestLocation: async () => null, ...overrides };
}

function renderMocks(discovery, overrides = {}) {
  const jsx = (type, props) => ({ type, props: props || {} });
  const react = { useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}], useMemo: (factory) => factory(), useEffect: () => {}, useCallback: (fn) => fn };
  return {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', SectionList: 'SectionList', ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', Modal: 'Modal', TextInput: 'TextInput', Keyboard: { dismiss: () => {} }, Alert: { alert: () => {} }, StyleSheet: { create: (styles) => styles } },
    'expo-router': { useRouter: () => ({ push: () => {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-image': { Image: 'Image' },
    '@/constants/theme': { AppColors: {}, BorderRadius: {} },
    '@react-native-async-storage/async-storage': { default: { getItem: async () => null, setItem: async () => {} } },
    '@/components/filter-sheet': { FilterSheet: 'FilterSheet' },
    '@/components/discovery-search': { DiscoverySearchBar: 'SearchBar', DiscoverySearchSheet: 'SearchSheet' },
    '@/components/dorm-result-card': { DormResultCard: 'DormResultCard' },
    '@/components/error-notice': { ErrorNotice: 'ErrorNotice' },
    '@/components/error-toast': { showWarning: () => {}, ErrorToast: 'ErrorToast' },
    '../../assets/placeholder.jpg': 'placeholder-image',
    '@/lib/gemini-assistant': { getAssistantQuotaWarning: () => null, rankAlternativesWithGemini: async () => [] },
    '@/hooks/useAuth': { useAuth: () => ({ user: null }) },
    '@/context/discovery-context': { useDiscovery: () => discovery },
    '@/lib/supabase': { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'own-account' } } }) } } },
    ...overrides,
  };
}

function descendants(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  const children = Array.isArray(node.props?.children) ? node.props.children.flat(Infinity) : [node.props?.children];
  return [...(predicate(node) ? [node] : []), ...children.flatMap((child) => descendants(child, predicate))];
}

test('before searching only the two highest displayed Match Scores are recommended', () => {
  const dorms = [makeDorm('low', { rating_average: 1, rating_count: 1 }), makeDorm('high', { rating_average: 4.8, rating_count: 30 }), makeDorm('mid', { rating_average: 3.8, rating_count: 20 }), makeDorm('closed', { available: false, rating_average: 5, rating_count: 100 })];
  const discovery = uiContext(dorms);
  const { default: Search } = load('app/(tabs)/search.tsx', renderMocks(discovery));
  const list = descendants(Search(), (node) => node.type === 'SectionList')[0];
  assert.equal(list.props.sections.length, 1);
  const recommendations = list.props.sections[0];
  assert.equal(recommendations.title, 'Recommended for you');
  assert.deepEqual(Array.from(recommendations.data, (dorm) => dorm.dorm_id), ['high', 'mid']);
  assert.ok(recommendations.data[0].ranking_score >= recommendations.data[1].ranking_score);
  assert.equal(list.props.keyboardShouldPersistTaps, 'handled');
});

test('empty recommendation sections are absent before and after searching', () => {
  for (const hasSearched of [false, true]) {
    const discovery = uiContext([], { hasSearched });
    const { default: Search } = load('app/(tabs)/search.tsx', renderMocks(discovery));
    const list = descendants(Search(), (node) => node.type === 'SectionList')[0];
    assert.equal(list.props.sections.some((section) => section.title === 'Recommended for you'), false);
    if (hasSearched) assert.equal(list.props.sections[0].title, 'Matches (0)');
  }
  const discovery = uiContext([makeDorm('one'), makeDorm('two')], { hasSearched: true });
  const { default: Search } = load('app/(tabs)/search.tsx', renderMocks(discovery));
  const sections = descendants(Search(), (node) => node.type === 'SectionList')[0].props.sections;
  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, 'Matches (2)');
});

test('search sheet uses the same prefix matching as submitted Matches', () => {
  const discovery = uiContext([makeDorm('test'), makeDorm('lebron', { name: 'Lebron' })], { filters: { ...DEFAULT_DORM_FILTERS, query: 'Le' } });
  const mocks = renderMocks(discovery);
  delete mocks['@/components/discovery-search'];
  const { DiscoverySearchSheet } = load('src/components/discovery-search.tsx', mocks);
  const tree = DiscoverySearchSheet({ visible: true, onClose: () => {} });
  const suggestions = descendants(tree, (node) => node.props.accessibilityLabel?.startsWith('View '));
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].props.accessibilityLabel, 'View Lebron');
});

test('tapping a search suggestion closes the sheet and opens that exact dorm ID', () => {
  const dorm = makeDorm('exact-dorm-id', { images: ['https://example.com/public-photo.jpg'] });
  const discovery = uiContext([dorm]);
  const calls = [];
  const mocks = renderMocks(discovery, { 'expo-router': { useRouter: () => ({ push: (route) => calls.push(['push', route]) }) } });
  delete mocks['@/components/discovery-search'];
  const { DiscoverySearchSheet } = load('src/components/discovery-search.tsx', mocks);
  const tree = DiscoverySearchSheet({ visible: true, onClose: () => calls.push(['close']) });
  const button = descendants(tree, (node) => node.props.accessibilityLabel === 'View Test')[0];
  assert.ok(button);
  button.props.onPress();
  assert.equal(calls[0][0], 'close');
  assert.equal(calls[1][0], 'push');
  assert.equal(calls[1][1].pathname, '/(tabs)/[dormId]');
  assert.equal(calls[1][1].params.dormId, 'exact-dorm-id');
});
