const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const modules = new Map();
function load(file) {
  file = path.resolve(file);
  if (modules.has(file)) return modules.get(file);
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name) => load(name.startsWith('@/') ? `src/${name.slice(2)}.ts` : path.resolve(path.dirname(file), `${name}.ts`)) });
  modules.set(file, module.exports);
  return module.exports;
}
const { comparisonValueMatchesPreference: matches } = load('src/lib/comparison-preferences.ts');
const dorm = { price: 4000, gender_policy: 'female', room_type: 'Private room', curfew: 'No curfew', parking_info: 'Motorcycle, Car', lgu_certified: true, pet_friendly: false, furnished: true, latitude: 10.32644, longitude: 123.95476 };

test('no private preferences means no blue preference highlights', () => {
  for (const key of ['price', 'amenities', 'gender', 'lgu', 'parking', 'distance']) assert.equal(matches(dorm, null, key, 'Wi-Fi'), false);
  assert.equal(matches(dorm, {}, 'price', '₱4,000'), false);
});
test('individual amenities, utilities and house rules match exactly, ignoring case', () => {
  const preferences = { amenities: ['Wi-Fi'], utilities: ['Water'], house_rules: ['No smoking'] };
  assert.equal(matches(dorm, preferences, 'amenities', 'Wi-Fi'), true);
  assert.equal(matches(dorm, preferences, 'amenities', 'Air Conditioning'), false);
  assert.equal(matches(dorm, preferences, 'utilities', 'water'), true);
  assert.equal(matches(dorm, preferences, 'rules', 'No smoking'), true);
  assert.equal(matches(dorm, preferences, 'rules', 'No parties'), false);
});
test('price must satisfy both ends of a saved budget range', () => {
  assert.equal(matches(dorm, { budget_min: 3000, budget_max: 5000 }, 'price', ''), true);
  assert.equal(matches(dorm, { budget_max: 3999 }, 'price', ''), false);
  assert.equal(matches(dorm, { budget_min: 4001 }, 'price', ''), false);
});
test('policy, room, parking and feature matches are not inferred from unrelated fields', () => {
  assert.equal(matches(dorm, { gender_policy: 'female' }, 'gender', ''), true);
  assert.equal(matches(dorm, { gender_policy: 'co-ed' }, 'gender', ''), false);
  assert.equal(matches(dorm, { room_type: 'Private room' }, 'roomType', ''), true);
  assert.equal(matches(dorm, { parking: 'Car' }, 'parking', ''), true);
  assert.equal(matches(dorm, { parking: 'Bicycle' }, 'parking', ''), false);
  assert.equal(matches(dorm, { lgu_certified: true }, 'lgu', ''), true);
  assert.equal(matches(dorm, { pet_friendly: true }, 'pet', ''), false);
  assert.equal(matches(dorm, { furnished: true }, 'furnished', ''), true);
});
test('no-curfew does not accidentally match a with-curfew preference', () => {
  assert.equal(matches(dorm, { curfew: 'No curfew' }, 'curfew', ''), true);
  assert.equal(matches(dorm, { curfew: 'With curfew' }, 'curfew', ''), false);
  assert.equal(matches({ ...dorm, curfew: '9:30 PM' }, { curfew: '10:00 PM' }, 'curfew', ''), false);
});
test('distance highlights use the saved preferred-area coordinates and radius', () => {
  const preferences = { latitude: dorm.latitude, longitude: dorm.longitude, radius_km: 1 };
  assert.equal(matches(dorm, preferences, 'distance', ''), true);
  assert.equal(matches({ ...dorm, latitude: dorm.latitude + 0.1 }, preferences, 'distance', ''), false);
  assert.equal(matches(dorm, { radius_km: 1 }, 'distance', ''), false);
});
test('payment UI keeps the contract in-app and receipt replacement image-only', () => {
  const source = readFileSync('app/(tabs)/[dormId].tsx', 'utf8');
  assert.match(source, /BookingDocument path=\{requestDetails\.contract_url\}/);
  assert.doesNotMatch(source, /Linking\.openURL\(secureContractUrl\)|Change selected receipt|<Button title="Submit Payment Proof"/);
  assert.match(source, /accessibilityRole="radio"/);
  assert.match(source, /styles\.receiptPreview/);
  assert.match(source, /paymentActions: \{ justifyContent: 'flex-end'/);
});
test('comparison separates compact property headers from collapsible aligned details', () => {
  const source = readFileSync('app/(tabs)/compare.tsx', 'utf8');
  assert.match(source, /accessibilityState=\{\{ expanded: detailsVisible \}\}/);
  assert.match(source, /Higher overall score/);
  assert.match(source, /comparisonValueMatchesPreference\(dorm, ownPreferences/);
  assert.match(source, /user && hasPreferences \? preferences : null/);
});
