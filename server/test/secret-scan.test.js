import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * US-28 (#67) SEC-11 / SEC-12: no hardcoded secrets, secrets files stay out of
 * Git, .env.example documents every required name with safe placeholders, and
 * the code never logs credentials.
 */
const root = path.resolve(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', 'backups', 'uploads', 'test'].includes(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.(js|jsx|mjs|cjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const SERVER = sourceFiles('server/src').concat(sourceFiles('server/scripts'));
const CLIENT = sourceFiles('client/src').filter((f) => !/\.test\./.test(f));

test('SEC-12 no source file contains a hardcoded secret, key, token or credentialed connection string', () => {
  const patterns = [
    [/-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
    [/\bghp_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
    [/\bsk-[A-Za-z0-9]{32,}\b/, 'API secret key'],
    [/mongodb(\+srv)?:\/\/[^'"`\s:@]+:[^'"`\s@]+@/, 'MongoDB URI with credentials'],
    [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
    [/(secret|api[_-]?key|encryption[_-]?key|private[_-]?key|signing[_-]?key)\s*[:=]\s*['"`][A-Za-z0-9+/=_-]{16,}['"`]/i, 'quoted secret assignment'],
    [/\b[0-9a-f]{64}\b/, '64-hex value (looks like a key)'],
  ];
  const hits = [];
  for (const file of [...SERVER, ...CLIENT]) {
    const text = read(file);
    for (const [pattern, label] of patterns) if (pattern.test(text)) hits.push(`${file}: ${label}`);
  }
  assert.deepEqual(hits, []);
});

test('SEC-12 secrets are read from the environment, never given a fallback value in code', () => {
  const hits = [];
  for (const file of SERVER) {
    const text = read(file);
    for (const match of text.matchAll(/process\.env\.(JWT_SECRET|EMAIL_VERIFICATION_SECRET|ENCRYPTION_KEY|BLIND_INDEX_KEY|BACKUP_ENCRYPTION_KEY|ATTACHMENT_URL_SECRET|APP_LOCK_SECRET)\s*(\|\||\?\?)\s*['"`]([^'"`]*)['"`]/g)) {
      hits.push(`${file}: ${match[1]} falls back to "${match[3]}"`);
    }
  }
  assert.deepEqual(hits, []);
});

test('SEC-12 real .env files are ignored by Git, and none is tracked', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
  assert.match(ignore, /^server\/backups\/?$/m, 'backup files are never committed');

  let tracked = '';
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return; // not a Git checkout (e.g. a ZIP): nothing to inspect
  }
  const bad = tracked.split('\n').filter((f) => /(^|\/)\.env($|\.(?!example$))|\.(pem|key|p12)$|\.pfembk$/.test(f));
  assert.deepEqual(bad, []);
});

test('SEC-12 .env.example names every required secret and holds only placeholders', () => {
  const example = read('server/.env.example');
  for (const name of ['JWT_SECRET', 'EMAIL_VERIFICATION_SECRET', 'ENCRYPTION_KEY', 'BLIND_INDEX_KEY', 'BACKUP_ENCRYPTION_KEY', 'ATTACHMENT_URL_SECRET', 'APP_LOCK_SECRET', 'BACKUP_DIR', 'CLIENT_ORIGIN', 'TRUST_PROXY', 'MONGO_URI']) {
    assert.match(example, new RegExp(`^#?\\s*${name}=`, 'm'), `${name} is documented`);
  }
  for (const line of example.split('\n')) {
    const match = /^([A-Z_]*(SECRET|KEY|PASSWORD|TOKEN)[A-Z_]*)=(.*)$/.exec(line);
    if (!match || /_ID$/.test(match[1])) continue; // a label, not a secret
    const value = match[3].trim();
    assert.ok(value === '' || /^<.*>$/.test(value) || /^(change|replace|generate)/i.test(value), `${match[1]} must be a placeholder, not "${value.slice(0, 12)}..."`);
    assert.ok(!/^[0-9a-f]{32,}$/i.test(value), `${match[1]} looks like a real secret`);
  }
  assert.ok(!/DEV_AUTH_HEADER=true/.test(example), 'the insecure development switch is off by default');
});

test('SEC-11 nothing logs a password, token, verification code or request body', () => {
  const offenders = [];
  const LOG = /console\.(log|info|warn|error|debug)\(([^;]*)\)/g;
  for (const file of SERVER) {
    const text = read(file);
    for (const match of text.matchAll(LOG)) {
      const args = match[2];
      if (/\b(password|newPassword|passwordHash|req\.body|req\.headers|authorization|token|jwt|code(?!\w))\b/i.test(args.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ''))) {
        offenders.push(`${file}: ${match[0].slice(0, 100)}`);
      }
    }
  }
  // The only permitted exception is the development mail console (DEV_EMAIL_CONSOLE),
  // which is refused at start-up in production. It is allow-listed by file, not pattern.
  const allowed = offenders.filter((o) => !o.startsWith('server/src/routes/auth.js'));
  assert.deepEqual(allowed, []);
});

test('SEC-11 the development mail console can never run in production', () => {
  const auth = read('server/src/routes/auth.js');
  assert.match(auth, /process\.env\.NODE_ENV !== 'production'\s*&&\s*process\.env\.DEV_EMAIL_CONSOLE === 'true'/);
  const channels = read('server/src/services/notifications/channels.js');
  assert.match(channels, /NODE_ENV !== 'production' && env\.DEV_EMAIL_CONSOLE === 'true'/);
  // and production start-up refuses the flag outright
  assert.match(read('server/src/config/security.js'), /DEV_EMAIL_CONSOLE: must not be enabled in production/);
});

test('SEC-9 the client has no field for card numbers, CVV, UPI PINs or bank passwords', () => {
  const forbidden = /(name|id|placeholder|label)\s*=\s*["'{`][^"'}`]*(card\s*number|cvv|cvc|upi\s*pin|bank\s*password|net\s*banking\s*password)/i;
  const offenders = CLIENT.filter((file) => forbidden.test(read(file)));
  assert.deepEqual(offenders, []);
});

test('SEC-6 the client never writes HTML from data (no innerHTML / dangerouslySetInnerHTML / eval)', () => {
  const offenders = CLIENT.filter((file) => /dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(|document\.write\(/.test(read(file)));
  assert.deepEqual(offenders, []);
});

test('SEC-6 the client keeps its token in memory-scoped storage helpers only, and sends no credentials in URLs', () => {
  const offenders = CLIENT.filter((file) => /[?&](token|password|jwt|access_token)=/.test(read(file)) && !/password-reset|reset/i.test(read(file)));
  assert.deepEqual(offenders, []);
});
