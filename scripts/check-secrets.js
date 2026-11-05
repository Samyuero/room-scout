// A small pre-push guard. Reports filenames only, never matching credentials.
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { Buffer } = require('node:buffer');
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of new Set(files)) {
  if (/(^|\/)\.env(?:\..*)?$/.test(file) && !file.endsWith('.env.example')) findings.push(file + ': private environment file');
  if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > 2_000_000) continue;
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const content = bytes.toString('utf8');
  if (/AIza[0-9A-Za-z_-]{30,}|sb_secret_[0-9A-Za-z_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push(file + ': possible secret key');
  for (const jwt of content.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    try { if (JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role === 'service_role') findings.push(file + ': privileged Supabase key'); }
    catch { /* Not a JWT payload. */ }
  }
}
if (findings.length) { console.error([...new Set(findings)].join('\n')); process.exitCode = 1; }
else console.log('PASS: no private .env files or recognized secret credentials in publishable files');
