const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function setup({ permission = 'granted', enabled = true, delayed = false } = {}) {
  const state = []; let cursor = 0, focus, appChange, onFix, resolveWatch;
  let watches = 0, removed = 0, listenerRemoved = 0;
  const timers = new Map(); let timerId = 0;
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync('src/hooks/use-live-map-location.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const react = { useCallback: (f) => f, useEffect: (f) => f(), useState: (initial) => { const index = cursor++; state[index] = initial; return [initial, (value) => { state[index] = value; }]; } };
  const location = {
    Accuracy: { High: 4 }, getForegroundPermissionsAsync: async () => ({ status: permission }), hasServicesEnabledAsync: async () => enabled,
    watchPositionAsync: async (options, callback) => {
      watches++; onFix = callback;
      assert.equal(options.distanceInterval, 5); assert.equal(options.timeInterval, 3000);
      const subscription = { remove: () => removed++ };
      if (delayed) return new Promise((resolve) => { resolveWatch = () => resolve(subscription); });
      return subscription;
    },
  };
  vm.runInNewContext(code, { module, exports: module.exports, Date, Number, Math, setTimeout: (f) => { timers.set(++timerId, f); return timerId; }, clearTimeout: (id) => timers.delete(id), require: (name) => {
    if (name === 'react') return react;
    if (name === 'expo-router') return { useFocusEffect: (f) => { focus = f; } };
    if (name === 'expo-location') return location;
    if (name === 'react-native') return { AppState: { currentState: 'active', addEventListener: (_, f) => { appChange = f; return { remove: () => listenerRemoved++ }; } } };
    throw new Error(name);
  } });
  module.exports.useLiveMapLocation(null);
  const cleanup = focus();
  return { state, cleanup, fix: (latitude = 10.328, accuracy = 10, timestamp = Date.now()) => onFix({ coords: { latitude, longitude: 123.956, accuracy }, timestamp }), background: () => appChange('background'), foreground: () => appChange('active'), finishWatch: () => resolveWatch(), expire: () => Array.from(timers.values()).forEach((f) => f()), counts: () => ({ watches, removed, listenerRemoved }) };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('foreground GPS follows movement and ignores stale or inaccurate fixes', async () => {
  const h = setup(); await settle();
  h.fix(); assert.equal(h.state[0].latitude, 10.328); assert.equal(h.state[1], true);
  h.fix(10.329); assert.equal(h.state[0].latitude, 10.329);
  h.fix(10.4, 200); assert.equal(h.state[0].latitude, 10.329); assert.equal(h.state[1], false);
  h.fix(10.5, 10, Date.now() - 60000); assert.equal(h.state[0].latitude, 10.329);
  h.fix(10.33); h.expire(); assert.equal(h.state[1], false);
  h.cleanup();
});
test('GPS subscription pauses in background, resumes in foreground and cleans up on blur', async () => {
  const h = setup(); await settle(); h.fix(); h.background();
  assert.equal(h.state[1], false); assert.equal(h.counts().removed, 1);
  h.fix(10.5); assert.equal(h.state[0].latitude, 10.328);
  h.foreground(); await settle(); assert.equal(h.counts().watches, 2);
  h.cleanup(); assert.equal(h.counts().removed, 2); assert.equal(h.counts().listenerRemoved, 1);
});
test('denied permission or disabled GPS does not start tracking or prompt automatically', async () => {
  for (const options of [{ permission: 'denied' }, { enabled: false }]) {
    const h = setup(options); await settle(); assert.equal(h.counts().watches, 0); assert.equal(h.state[1], false); assert.ok(h.state[2]); h.cleanup();
  }
});
test('a subscription arriving after Maps closes is immediately removed', async () => {
  const h = setup({ delayed: true }); await settle(); h.cleanup(); h.finishWatch(); await settle();
  assert.equal(h.counts().removed, 1);
});
