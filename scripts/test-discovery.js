const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requireLocal = (name) => load(name.startsWith('@/') ? `src/${name.slice(2)}.ts` : path.resolve(path.dirname(file), `${name}.ts`));
  vm.runInNewContext(code, { module, exports: module.exports, require: requireLocal, Set, Map, Math, Number, String, Boolean, Object, Array });
  modules.set(file, module.exports);
  return module.exports;
}
const { DEFAULT_DORM_FILTERS } = load('src/types/dorm.ts');
const { normalizeDorm, matchesDormFilters, filterAndRankDorms, recommendDorms } = load('src/lib/dorm-discovery.ts');
const { aggregatePriceAreas, distanceBand, getVisiblePriceSummary, historicalDemand } = load('src/lib/map-analytics.ts');
const anchor = { latitude: 10.32644, longitude: 123.95476 };
const makeDorm = (id, overrides = {}) => normalizeDorm({ dorm_id: id, owner_id: 'owner', name: 'Opao Dorm', address: 'Opao, Mandaue', price: 4000, ...anchor, available: true, max_tenants: 4, occupied_tenants: 1, amenities: ['Wi-Fi'], utilities: ['Water'], gender_policy: 'co-ed', room_type: 'Private room', ...overrides });
const filters = (overrides = {}) => ({ ...DEFAULT_DORM_FILTERS, ...overrides });

test('a fully reserved dorm keeps its Reserved label rather than becoming Unavailable',()=>{
  const reserved=makeDorm('reserved',{available:false,availability_status:'reserved',max_tenants:1,occupied_tenants:1});
  assert.equal(reserved.available,false);assert.equal(reserved.availability_status,'reserved');assert.equal(reserved.available_slots,0);
});

test('impossible queries and strict price/amenity/gender filters never leak alternatives into Matches', () => {
  const dorm = makeDorm('a');
  for (const selected of [{ query: 'impossible_xyz' }, { maxPrice: 3999 }, { minPrice: 4001 }, { amenities: ['Air Conditioning'] }, { utilities: ['Electricity'] }, { genderPolicy: 'female' }, { lguCertified: true }]) {
    assert.equal(filterAndRankDorms([dorm], filters(selected), anchor).length, 0);
  }
});
test('radius can explore outside pins but an explicit radius excludes them', () => {
  const far = makeDorm('far', { latitude: anchor.latitude + 0.05 });
  assert.equal(matchesDormFilters(far, filters({ radiusKm: 1, radiusEnabled: false }), anchor), true);
  assert.equal(matchesDormFilters(far, filters({ radiusKm: 1, radiusEnabled: true }), anchor), false);
  assert.equal(matchesDormFilters(makeDorm('bad', { latitude: NaN }), filters({ radiusEnabled: true }), anchor), false);
  assert.equal(distanceBand(anchor, anchor, 2), 'near');
  assert.equal(distanceBand({ latitude: anchor.latitude + 0.015, longitude: anchor.longitude }, anchor, 2), 'edge');
  assert.equal(distanceBand(far, anchor, 2), 'far');
});
test('no-curfew and no-parking labels do not count as real curfew or parking', () => {
  const dorm = makeDorm('a', { curfew: 'No curfew', parking_info: 'None' });
  assert.equal(matchesDormFilters(dorm, filters({ curfewPolicy: 'no-curfew' }), null), true);
  assert.equal(matchesDormFilters(dorm, filters({ parkingRequired: true }), null), false);
});
test('recommendations remain separate and rank closest budget/preferences first', () => {
  const selected = filters({ maxPrice: 3000, amenities: ['Wi-Fi'] });
  const near = makeDorm('near', { price: 3200 });
  const far = makeDorm('far', { price: 12000, amenities: [], rating_average: 5, rating_count: 1 });
  const results = recommendDorms([far, near], selected, anchor, { budget_max: 3500, amenities: ['Wi-Fi'] });
  assert.equal(results[0].dorm_id, 'near');
  assert.equal(filterAndRankDorms([far, near], selected, anchor).length, 0);
  assert.equal(recommendDorms([far, near], selected, anchor, null, new Set(['near'])).some((dorm) => dorm.dorm_id === 'near'), false);
});
test('without filters/preferences alternative ranking falls back to confidence-aware renter ratings', () => {
  const selected = filters({ onlyAvailable: false });
  const low = makeDorm('low', { rating_average: 2, rating_count: 20 });
  const high = makeDorm('high', { rating_average: 4.7, rating_count: 20 });
  assert.equal(recommendDorms([low, high], selected, null, null)[0].dorm_id, 'high');
});
test('price analytics aggregate geographic areas and visible average obeys viewport bounds', () => {
  const one = makeDorm('1', { latitude: 10.326, longitude: 123.956, price: 2000 });
  const two = makeDorm('2', { latitude: 10.327, longitude: 123.957, price: 4000 });
  const outside = makeDorm('3', { latitude: 10.34, longitude: 123.97, price: 12000 });
  const summary = getVisiblePriceSummary([one, two, outside], { south: 10.325, north: 10.33, west: 123.955, east: 123.96 });
  assert.equal(summary.count, 2); assert.equal(summary.average, 3000);
  const areas = aggregatePriceAreas([one, two, outside], summary.average);
  assert.equal(areas.length, 2);
  const shared = areas.find((area) => area.count === 2);
  assert.equal(shared.average, 3000); assert.equal(shared.band, 'average');
  assert.equal(areas.find((area) => area.count === 1).band, 'expensive');
  assert.equal(shared.radiusMeters,280); assert.ok(shared.center.latitude>10.325);
});
test('demand uses real historical activity and a fixed 30-day forecast, never invents activity', () => {
  const dorm = makeDorm('a');
  const empty = historicalDemand(dorm);
  assert.equal(empty.sufficientHistory, false); assert.equal(empty.estimatedInquiries, null);
  const history = { dorm_id: 'a', inquiries_30d: 20, prior_inquiries_30d: 10, bookings_30d: 4, prior_bookings_30d: 2, observed_days: 90 };
  const forecast = historicalDemand(dorm, history);
  assert.equal(historicalDemand(dorm,{...history,observed_days:14}).sufficientHistory,false);
  assert.equal(forecast.horizonDays, 30); assert.equal(forecast.level, 'high');
  assert.deepEqual(historicalDemand(dorm, history), forecast);
  assert.match(forecast.reason, /20 inquiries and 4 bookings/);
  assert.match(forecast.reason, /not a guarantee/);
  const pooled = historicalDemand(makeDorm('new',{max_tenants:1,occupied_tenants:0}), undefined, { listing_count:2,inquiries_all_time:200,bookings_all_time:30,inquiries_30d:40,prior_inquiries_30d:20,bookings_30d:8 });
  assert.equal(pooled.level,'high'); assert.notEqual(pooled.estimatedInquiries,null);
  assert.doesNotMatch(pooled.badge,/Limited history/); assert.match(pooled.reason,/across 2 published listings/);
});
test('map keeps one HTML document instead of reloading tiles for every state change', () => {
  const source = readFileSync('src/components/leaflet-map-view.tsx', 'utf8');
  assert.match(source, /source=\{MAP_SOURCE\}/);
  assert.match(source, /injectJavaScript/);
  assert.match(source, /type:'viewport'/);
  assert.doesNotMatch(source, /L\.rectangle/);
  assert.match(source, /radius:area.radiusMeters/);
  assert.match(source, /\.toBounds\(data.radiusKm\*2000\)/);
  assert.doesNotMatch(source, /L\.circle\([^\n]+\)\.getBounds\(\)/);
  assert.doesNotMatch(source, /google\.com|maps\.google/);
});
test('map browsing has no implicit school anchor, and demand calls happen only on activation',()=>{
  const source=readFileSync('app/(tabs)/map.tsx','utf8');
  assert.doesNotMatch(source,/UCLM_SCHOOL|Limited history/);
  assert.match(source,/label: 'Device location', kind: 'device' } : null/);
  assert.match(source,/predictDormDemand\(/); assert.match(source,/demandSnapshot.current/);
  assert.match(source,/get_public_demand_context/);
});
