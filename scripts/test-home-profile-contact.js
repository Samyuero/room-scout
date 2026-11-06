const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file) {
  return ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, removeComments: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}
function load(file, requireModule = () => { throw new Error('Unexpected dependency'); }) {
  const module = { exports: {} };
  vm.runInNewContext(compile(file), { module, exports: module.exports, require: requireModule });
  return module.exports;
}
const { canShowFeaturedDorm } = load('src/lib/featured-listings.ts');
const featured = { is_featured: true, available: true, availability_status: 'available', available_slots: 2, occupied_tenants: 1, max_tenants: 3, status: 'active' };

test('featured carousel shows only featured dorms with available capacity', () => {
  assert.equal(canShowFeaturedDorm(featured), true);
  for (const change of [
    { is_featured: false }, { available: false }, { availability_status: 'unavailable' },
    { availability_status: 'reserved' }, { available_slots: 0 }, { occupied_tenants: 3 },
    { occupied_tenants: 4 }, { status: 'inactive' },
  ]) assert.equal(canShowFeaturedDorm({ ...featured, ...change }), false);
});
test('temporary unavailability never changes the stored featured flag', () => {
  const dorm = { ...featured, available: false, availability_status: 'reserved', available_slots: 0, occupied_tenants: 3 };
  const before = JSON.stringify(dorm);
  assert.equal(canShowFeaturedDorm(dorm), false);
  assert.equal(JSON.stringify(dorm), before);
  Object.assign(dorm, { available: true, availability_status: 'available', available_slots: 1, occupied_tenants: 2 });
  assert.equal(canShowFeaturedDorm(dorm), true);
  assert.equal(dorm.is_featured, true);
});
function emailClient(platform, { gmailFails = false, mailtoFails = false } = {}) {
  const calls = [];
  const module = load('src/lib/team-email.ts', (name) => {
    if (name === 'react-native') return { Platform: { OS: platform }, Linking: { openURL: async (url) => { calls.push({ type: 'mailto', url }); if (mailtoFails) throw new Error('No email handler'); } } };
    if (name === 'expo-intent-launcher') return { startActivityAsync: async (action, options) => { calls.push({ type: 'gmail', action, ...options }); if (gmailFails) throw new Error('Gmail absent'); } };
    throw new Error('Unexpected dependency: ' + name);
  });
  return { ...module, calls };
}
test('Android opens a Gmail compose intent addressed to SNAP without sending', async () => {
  const client = emailClient('android');
  await client.composeSnapEmail();
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].action, 'android.intent.action.SENDTO');
  assert.equal(client.calls[0].packageName, 'com.google.android.gm');
  assert.equal(client.calls[0].className, 'com.google.android.gm.ComposeActivityGmail');
  assert.equal(client.calls[0].data, 'mailto:samuelcapuras.haha@gmail.com');
});
test('Gmail absence falls back to any configured email app', async () => {
  const client = emailClient('android', { gmailFails: true });
  await client.composeSnapEmail();
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].type, 'mailto');
  assert.equal(client.calls[1].url, 'mailto:samuelcapuras.haha@gmail.com');
});
test('web and other platforms use mailto directly, never an Android intent', async () => {
  for (const platform of ['web', 'ios']) {
    const client = emailClient(platform);
    await client.composeSnapEmail();
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].type, 'mailto');
  }
});
test('no installed email app produces an actionable error with the recipient', async () => {
  const client = emailClient('android', { gmailFails: true, mailtoFails: true });
  await assert.rejects(() => client.composeSnapEmail(), /No email app could be opened.*samuelcapuras\.haha@gmail\.com/);
});
test('Settings and website shortcuts are hidden while source and route remain recoverable', () => {
  const profileSource = readFileSync('app/(tabs)/profile.tsx', 'utf8');
  const aboutSource = readFileSync('app/(tabs)/about-us.tsx', 'utf8');
  assert.match(profileSource, /settings-outline/);
  assert.doesNotMatch(compile('app/(tabs)/profile.tsx'), /settings-outline/);
  assert.equal(existsSync('app/(tabs)/settings.tsx'), true);
  assert.match(aboutSource, /Visit Website/);
  assert.doesNotMatch(compile('app/(tabs)/about-us.tsx'), /Visit Website|snap@uclm\.edu/);
  assert.match(compile('app/(tabs)/home.tsx'), /filter\(featured_listings_1\.canShowFeaturedDorm\)/);
});
