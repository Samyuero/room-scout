const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const start = { latitude: 10.328, longitude: 123.956 };
const end = { latitude: 10.323, longitude: 123.935 };
const fixture = { code: 'Ok', routes: [{ distance: 2500, duration: 420, geometry: { coordinates: [[123.956, 10.328], [123.95, 10.327], [123.935, 10.323]] } }], waypoints: [{ distance: 10 }, { distance: 20 }] };
function load(fetch) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync('src/lib/directions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name === './dorm-discovery' ? { getDistanceKm: (a,b) => Math.abs(a.latitude-b.latitude)*111 } : { fetch }, AbortController, Date, setTimeout, clearTimeout, Map, Error, Number, Math });
  return module.exports;
}
test('road route sends only chosen coordinates in OSRM order and returns Leaflet points', async () => {
  let requested;
  const service = load(async (url) => { requested = url; return { ok: true, json: async () => fixture }; });
  const route = await service.getRoadRoute({ ...start, userId: 'never-send-user' }, { ...end, email: 'never-send-email' });
  assert.match(requested, /driving\/123\.956,10\.328;123\.935,10\.323/);
  assert.doesNotMatch(requested, /never-send|userId|email/);
  assert.match(requested, /geometries=geojson/);
  assert.deepEqual(Array.from(route.coordinates[0]), [10.328, 123.956]);
  assert.equal(route.distanceMeters, 2500); assert.equal(route.durationSeconds, 420);
});
test('repeat requests reuse memory cache and different requests are throttled', async () => {
  let calls = 0;
  const service = load(async () => { calls++; return { ok: true, json: async () => fixture }; });
  const first = await service.getRoadRoute(start, end);
  assert.equal(await service.getRoadRoute(start, end), first);
  assert.equal(calls, 1);
  await assert.rejects(service.getRoadRoute(start, { ...end, latitude: 10.33 }), /wait a moment/);
});
test('invalid coordinates and cancelled requests never send a network request', async () => {
  let calls = 0; const service = load(async () => { calls++; });
  await assert.rejects(service.getRoadRoute({ ...start, latitude: NaN }, end), /valid/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.getRoadRoute(start, end, controller.signal), /cancelled/);
  assert.equal(calls, 0);
});
test('no route and malformed geometry are rejected rather than drawing a straight line', async () => {
  for (const data of [{ code: 'NoRoute' }, { ...fixture, routes: [{ ...fixture.routes[0], geometry: { coordinates: [[null, 10], [123, 11]] } }] }]) {
    const service = load(async () => ({ ok: true, json: async () => data }));
    await assert.rejects(service.getRoadRoute(start, end), /No usable road route/);
  }
});
test('service rate limits and offline failures remain recoverable', async () => {
  await assert.rejects(load(async () => ({ ok: false, status: 429 })).getRoadRoute(start, end), /busy/);
  await assert.rejects(load(async () => { throw new Error('Offline'); }).getRoadRoute(start, end), /Offline/);
});
test('Google fallback contains the selected origin AND exact destination', () => {
  const url = load(async () => {}).googleDirectionsUrl(start, end);
  assert.match(url, /origin=10\.328%2C123\.956/);
  assert.match(url, /destination=10\.323%2C123\.935/);
});
test('map preserves school origin on dorm focus and routes only after consent', () => {
  const source = readFileSync('app/(tabs)/map.tsx', 'utf8');
  const deepLink = source.slice(source.indexOf('if (!params.dormId)'), source.indexOf('function chooseSchool'));
  assert.doesNotMatch(deepLink, /setSearchOrigin\(/);
  assert.match(source, /Alert\.alert\('Show road directions\?'/);
  assert.match(source, /text: 'Show route', onPress: \(\) => void loadDirections/);
  assert.match(source, /Choose a school or tap Locate me/);
  assert.doesNotMatch(source, /openstreetmap\.org\/directions/);
  assert.match(source, /roadRoute=\{roadRoute\}/);
  const leaflet = readFileSync('src/components/leaflet-map-view.tsx', 'utf8');
  assert.match(leaflet, /L\.polyline\(points/);
  assert.match(leaflet, /routeLayer\.clearLayers\(\)/);
});
test('live rerouting ignores GPS drift, poor accuracy and rapid requests', () => {
  const { shouldRefreshLiveRoute } = load(async () => {});
  const previous = { latitude: 10.32, longitude: 123.95 };
  assert.equal(shouldRefreshLiveRoute(previous, { ...previous, latitude: 10.3205, accuracy_m: 10 }, 0, 16000), true);
  assert.equal(shouldRefreshLiveRoute(previous, { ...previous, latitude: 10.32001, accuracy_m: 10 }, 0, 16000), false);
  assert.equal(shouldRefreshLiveRoute(previous, { ...previous, latitude: 10.3205, accuracy_m: 150 }, 0, 16000), false);
  assert.equal(shouldRefreshLiveRoute(previous, { ...previous, latitude: 10.3205, accuracy_m: 10 }, 0, 5000), false);
});
