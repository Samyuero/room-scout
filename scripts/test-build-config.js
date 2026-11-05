const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const ts = require('typescript');
const { validateBuildEnvironment } = require('./validate-build-env');

const project = 'abcdefghijklmnopqrst';
const url = 'https://' + project + '.supabase.co';
const jwt = (payload) => [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url'), 'test_signature'].join('.');
const anon = jwt({ role: 'anon', ref: project, exp: 4102444800 });
const settings = (key = anon, endpoint = url) => ({ EXPO_PUBLIC_SUPABASE_URL: endpoint, EXPO_PUBLIC_SUPABASE_ANON_KEY: key });

test('missing, placeholder, localhost and insecure APK settings are rejected', () => {
  for (const input of [{}, settings('', url), settings(anon, 'https://placeholder.supabase.co'), settings(anon, 'http://localhost:54321'), settings(anon, 'https://localhost'), settings(anon, 'https://example.com')]) {
    assert.throws(() => validateBuildEnvironment(input));
  }
});
test('secret, wrong-project and expired keys are rejected', () => {
  for (const key of ['sb_secret_private', jwt({ role: 'service_role', ref: project }), jwt({ role: 'anon', ref: 'another-project' }), jwt({ role: 'anon', exp: 1 })]) {
    assert.throws(() => validateBuildEnvironment(settings(key)));
  }
});
test('publishable and matching legacy anon keys are accepted', () => {
  assert.equal(validateBuildEnvironment(settings()).url, url);
  assert.equal(validateBuildEnvironment({ EXPO_PUBLIC_SUPABASE_URL: url, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_public_key_12345' }).keyName, 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
});
test('cloud preflight does not silently load local .env', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-build-env.js', '--eas'], { encoding: 'utf8', env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', EXPO_PUBLIC_SUPABASE_ANON_KEY: '' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing Supabase settings/);
});
test('unconfigured runtime blocks database, storage and functions without network calls', async () => {
  let networkCalls = 0;
  let appStateListeners = 0;
  const output = ts.transpileModule(readFileSync('src/lib/supabase.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, __DEV__: false, URL, process: { env: {} },
    fetch: async () => { networkCalls++; throw new Error('Unexpected network call'); },
    require(name) {
      if (name === 'react-native') return { Platform: { OS: 'android' }, AppState: { addEventListener: () => { appStateListeners++; } } };
      if (name === 'react-native-url-polyfill/auto') return {};
      if (name === '@react-native-async-storage/async-storage') return { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
      if (name === 'expo-crypto') return { getRandomValues: (array) => require('node:crypto').randomFillSync(array) };
      return require(name);
    },
  });
  vm.runInContext(output, context);
  const runtime = module.exports;
  assert.equal(runtime.isSupabaseConfigured, false);
  for (const result of await Promise.all([
    runtime.supabase.from('dorms').select('dorm_id'),
    runtime.supabase.storage.from('uploaded_images').list(),
    runtime.supabase.functions.invoke('dorm-assistant', { body: {} }),
  ])) assert.ok(result.error);
  assert.equal(networkCalls, 0);
  assert.equal(appStateListeners, 0);
});

test('Google redirects exchange PKCE codes and still accept legacy token links', async () => {
  const calls = { code: 0, tokens: 0, profiles: 0 };
  const client = {
    auth: {
      exchangeCodeForSession: async () => { calls.code++; return { error: null }; },
      setSession: async () => { calls.tokens++; return { error: null }; },
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: { id: 'test-only', user_metadata: {} } }, error: null }),
    },
    from: () => ({ upsert: async () => { calls.profiles++; return { error: null }; } }),
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, URL, URLSearchParams,
    require(name) {
      if (name === '@/lib/supabase') return { supabase: client };
      if (name === '@react-native-async-storage/async-storage') return { getItem: async () => null, removeItem: async () => {} };
      throw new Error('Unexpected import: ' + name);
    },
  });
  vm.runInContext(ts.transpileModule(readFileSync('src/lib/account-profile.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context);
  await module.exports.completeOAuthRedirect('roomscout://google-auth?code=test-only-code');
  assert.equal(calls.code, 1);
  assert.equal(calls.profiles, 1);
  await module.exports.completeOAuthRedirect('roomscout://google-auth#access_token=test-only&refresh_token=test-only');
  assert.equal(calls.tokens, 1);
  assert.equal(calls.profiles, 2);
  await assert.rejects(() => module.exports.completeOAuthRedirect('roomscout://google-auth?error=access_denied'), /not completed/);
  await assert.rejects(() => module.exports.completeOAuthRedirect('roomscout://google-auth'), /without a session/);
});
