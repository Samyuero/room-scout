const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadProfileModule(profiles) {
  const calls = [];
  const client = {
    from(table) {
      calls.push(table);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => profiles[table] || { data: null, error: null } }) }), upsert: async () => ({ error: null }) };
    },
    auth: { getUser: async () => ({ data: { user: { id: 'fixture', user_metadata: {} } }, error: null }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/account-profile.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, URL, URLSearchParams,
    require: (name) => { assert.equal(name, '@/lib/supabase'); return { supabase: client }; },
  });
  return { ...module.exports, calls };
}
test('baseline renter record does not automatically complete Google registration', async () => {
  const api = loadProfileModule({ renters: { data: { full_name: 'Google name', username: 'legacy_name' }, error: null } });
  const profile = await api.getAccountRegistration('fixture');
  assert.equal(profile.completed, false);
  assert.equal(profile.role, null);
  assert.equal(profile.fullName, 'Google name');
});
test('saved owner and renter registrations use database completion, not local role hints', async () => {
  for (const role of ['owner', 'renter']) {
    const api = loadProfileModule({ renters: { data: { registration_role: role, registration_completed_at: 'saved' }, error: null }, ...(role === 'owner' ? { owners: { data: { username: 'owner' }, error: null } } : {}) });
    const profile = await api.getAccountRegistration('fixture');
    assert.equal(profile.completed, true);
    assert.equal(profile.role, role);
  }
});
test('existing administrator stays administrator', async () => {
  const profile = await loadProfileModule({ admins: { data: { username: 'admin' }, error: null } }).getAccountRegistration('fixture');
  assert.equal(profile.completed, true);
  assert.equal(profile.role, 'admin');
});
test('profile load failure is not treated as a valid registration', async () => {
  await assert.rejects(loadProfileModule({ renters: { data: null, error: new Error('offline') } }).getAccountRegistration('fixture'), /offline/);
});
test('OAuth completion never creates an owner based on a stale local role', async () => {
  const api = loadProfileModule({});
  await api.completeGoogleProfile();
  assert.deepEqual(api.calls, ['renters']);
});
test('registration uses the dark theme and atomic completion; Google users are not asked for passwords', () => {
  const screen = readFileSync('app/(auth)/setup-username.tsx', 'utf8');
  assert.match(screen, /colorScheme="dark"/);
  assert.match(screen, /p_full_name: fullName\.trim\(\), p_username: username\.trim\(\)\.toLowerCase\(\), p_role: role/);
  assert.match(screen, /rpc\('complete_account_registration'/);
  assert.doesNotMatch(screen, /secureTextEntry|backgroundColor: '#fff'/);
  assert.match(screen, /owner-verification/);
});
