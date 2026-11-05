#!/usr/bin/env node
// Runs before cloud dependencies are installed: use Node built-ins only.
const fs = require('node:fs');
const { Buffer } = require('node:buffer');

function validateBuildEnvironment(env) {
  const url = (env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
  const keyName = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
    ? 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY' : 'EXPO_PUBLIC_SUPABASE_ANON_KEY';
  const key = (env[keyName] || '').trim();
  if (!url || !key) throw new Error('Missing Supabase settings. Set EXPO_PUBLIC_SUPABASE_URL and a publishable/anon key in the EAS environment selected by eas.json. Local .env files are not uploaded.');
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('EXPO_PUBLIC_SUPABASE_URL must be a valid HTTPS project URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)
    || /placeholder|your[_-]?project|example|localhost|127\.0\.0\.1|\.invalid$|\.test$/i.test(parsed.hostname)) {
    throw new Error('Use the real, public HTTPS Supabase project URL for an APK build, not a placeholder or localhost.');
  }
  if (key.startsWith('sb_publishable_') && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key)) return { url: parsed.origin, key, keyName };
  try {
    if (key.split('.').length !== 3) throw new Error();
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role !== 'anon' || (payload.exp && payload.exp * 1000 <= Date.now())) throw new Error();
    if (parsed.hostname.endsWith('.supabase.co') && payload.ref && payload.ref !== parsed.hostname.split('.')[0]) throw new Error();
  } catch { throw new Error('Use a valid Supabase publishable key or legacy anon key for this project. Never use a secret/service-role key in the app.'); }
  return { url: parsed.origin, key, keyName };
}

async function checkSurveyBackend(config) {
  const headers = { apikey: config.key, 'Content-Type': 'application/json' };
  const checks = [
    ['Auth service', '/auth/v1/health', {}],
    ['Public listings', '/rest/v1/dorms?select=dorm_id&limit=1', {}],
    ['Signup migration', '/rest/v1/rpc/is_username_available', { method: 'POST', body: JSON.stringify({ p_username: 'roomscout_preflight_check' }) }],
  ];
  let failed = false;
  for (const [label, path, options] of checks) {
    try {
      const response = await fetch(config.url + path, { ...options, headers, signal: AbortSignal.timeout(15000) });
      console.log(`${response.ok ? 'PASS' : 'FAIL'} ${label}: HTTP ${response.status}`);
      if (!response.ok) failed = true;
    } catch { console.error(`FAIL ${label}: cannot reach the configured server. Check internet/DNS and the project status.`); failed = true; }
  }
  try {
    const response = await fetch(config.url + '/auth/v1/settings', { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error();
    const settings = await response.json();
    const signupEnabled = settings.disable_signup !== true;
    const googleEnabled = settings.external?.google === true;
    console.log(`${signupEnabled ? 'PASS' : 'FAIL'} New-account signup ${signupEnabled ? 'enabled' : 'disabled'}`);
    console.log(`${googleEnabled ? 'PASS' : 'FAIL'} Google Auth provider ${googleEnabled ? 'enabled' : 'disabled'}`);
    if (!signupEnabled || !googleEnabled) failed = true;
  } catch { console.error('FAIL Auth provider settings could not be checked.'); failed = true; }
  if (failed) throw new Error('Backend preflight failed. Apply missing migrations and resolve service errors before surveying testers. No accounts or listings were changed.');
}

async function main() {
  // Cloud builds must use EAS variables, never an accidentally uploaded .env.
  if (!process.argv.includes('--eas') && fs.existsSync('.env')) process.loadEnvFile('.env');
  const config = validateBuildEnvironment(process.env);
  console.log(`PASS Supabase build settings: ${new URL(config.url).hostname} (${config.keyName}; value hidden)`);
  if (process.argv.includes('--online')) await checkSurveyBackend(config);
}

if (require.main === module) main().catch((error) => { console.error('RoomScout preflight: ' + error.message); process.exitCode = 1; });
module.exports = { validateBuildEnvironment };
