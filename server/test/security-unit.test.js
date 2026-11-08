import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DecryptionError, blindIndex, decryptBuffer, decryptString, encryptBuffer, encryptString, isEncrypted, keyRing, resetKeyRingCache,
} from '../src/utils/crypto.js';
import { createDecryptStream, createEncryptStream } from '../src/utils/backupCrypto.js';
import { findUnsafeKey } from '../src/middleware/inputGuard.js';
import { MemoryStore, accountKey, createRateLimiter } from '../src/middleware/rateLimit.js';
import { SIGNED_URL_MAX_SECONDS, signAttachment, verifyAttachment } from '../src/utils/signedUrl.js';
import {
  auditRetentionDays, bcryptRounds, environmentProblems, sessionIdleMs, trustProxySetting,
} from '../src/config/security.js';
import { sanitizeForAudit } from '../src/services/auditService.js';
import { unsafeContentReason, validateAttachment } from '../src/validators/file.js';

process.env.JWT_SECRET ||= 'j'.repeat(48);

const collect = async (readable) => {
  const chunks = [];
  for await (const chunk of readable) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const encryptAll = (data, key) => collect(Readable.from([data]).pipe(createEncryptStream(key)));
const decryptAll = (data, key) => collect(Readable.from([data]).pipe(createDecryptStream(key)));

// ---------------------------------------------------------------------------
// SEC-3 - AES-256-GCM at rest
// ---------------------------------------------------------------------------

test('SEC-3 text encryption round-trips, is randomised and is labelled', () => {
  const a = encryptString('Rent for November');
  const b = encryptString('Rent for November');

  assert.ok(isEncrypted(a));
  assert.notEqual(a, b, 'a fresh IV is used every time');
  assert.ok(!a.includes('Rent'));
  assert.equal(decryptString(a), 'Rent for November');
  assert.equal(decryptString('legacy plaintext'), 'legacy plaintext', 'unmigrated values still read');
  assert.equal(encryptString(''), '');
  assert.equal(encryptString(null), null);
});

test('SEC-3 a changed ciphertext fails authentication instead of returning garbage', () => {
  const [prefix, version, id, iv, tag, body] = encryptString('secret note').split(':');
  const flipped = Buffer.from(body, 'base64url');
  flipped[0] ^= 1;

  assert.throws(() => decryptString([prefix, version, id, iv, tag, flipped.toString('base64url')].join(':')), DecryptionError);
  assert.throws(() => decryptString('enc:v1:1:AAAA'), DecryptionError);
});

test('SEC-3 file encryption is bound to its object key and detects tampering', () => {
  const file = crypto.randomBytes(5000);
  const sealed = encryptBuffer(file, 'abc.pdf');

  assert.ok(!sealed.includes(file.subarray(0, 64)));
  assert.ok(decryptBuffer(sealed, 'abc.pdf').equals(file));
  assert.throws(() => decryptBuffer(sealed, 'other.pdf'), DecryptionError, 'a file cannot be swapped for another');

  const damaged = Buffer.from(sealed);
  damaged[damaged.length - 1] ^= 1;
  assert.throws(() => decryptBuffer(damaged, 'abc.pdf'), DecryptionError);
  assert.ok(decryptBuffer(file, 'x').equals(file), 'legacy unencrypted files pass through');
});

test('SEC-3 a rotated key still reads old data; the blind index does not change', () => {
  const env = { ...process.env };
  try {
    process.env.ENCRYPTION_KEY = '11'.repeat(32);
    process.env.ENCRYPTION_KEY_ID = 'a';
    process.env.BLIND_INDEX_KEY = '22'.repeat(32);
    resetKeyRingCache();
    const oldValue = encryptString('before rotation');
    const index = blindIndex('Person@Example.com');

    process.env.ENCRYPTION_KEY = '33'.repeat(32);
    process.env.ENCRYPTION_KEY_ID = 'b';
    process.env.ENCRYPTION_KEYS_PREVIOUS = `a:${'11'.repeat(32)}`;
    resetKeyRingCache();

    assert.ok(encryptString('after').startsWith('enc:v1:b:'));
    assert.equal(decryptString(oldValue), 'before rotation');
    assert.equal(blindIndex(' person@example.com '), index, 'lookups survive a key rotation');

    delete process.env.ENCRYPTION_KEYS_PREVIOUS;
    resetKeyRingCache();
    assert.throws(() => decryptString(oldValue), DecryptionError, 'without the old key the data cannot be read');
  } finally {
    for (const key of ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_ID', 'BLIND_INDEX_KEY', 'ENCRYPTION_KEYS_PREVIOUS']) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    resetKeyRingCache();
  }
});

test('SEC-3 a malformed key is refused, never padded or truncated', () => {
  const saved = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'too-short';
  resetKeyRingCache();
  try {
    assert.throws(() => keyRing(), /32 bytes/);
  } finally {
    if (saved === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = saved;
    resetKeyRingCache();
  }
});

// ---------------------------------------------------------------------------
// REQ-97 - backup file encryption
// ---------------------------------------------------------------------------

const KEY = crypto.randomBytes(32);

test('REQ-97 a multi-chunk backup stream round-trips and hides its contents', async () => {
  const plain = Buffer.from('{"line":"patient zero"}\n'.repeat(120_000)); // > 2 MiB: several chunks
  const sealed = await encryptAll(plain, KEY);

  assert.ok(!sealed.includes('patient zero'));
  assert.ok((await decryptAll(sealed, KEY)).equals(plain));
});

test('REQ-97 the wrong key, a flipped byte, a truncated file and a damaged header are all refused', async () => {
  const sealed = await encryptAll(crypto.randomBytes(3 * 1024 * 1024), KEY);

  await assert.rejects(decryptAll(sealed, crypto.randomBytes(32)), /corrupt|wrong/i);

  const flipped = Buffer.from(sealed);
  flipped[Math.floor(flipped.length / 2)] ^= 1;
  await assert.rejects(decryptAll(flipped, KEY), /corrupt|wrong/i);

  await assert.rejects(decryptAll(sealed.subarray(0, sealed.length - 100), KEY), /truncated|corrupt/i);
  await assert.rejects(decryptAll(sealed.subarray(0, 20), KEY), /truncated/i);

  const badMagic = Buffer.from(sealed);
  badMagic[0] ^= 1;
  await assert.rejects(decryptAll(badMagic, KEY), /not a PFEM backup/i);
});

test('REQ-97 dropping a whole chunk from the middle (reordering/removal) is detected', async () => {
  const sealed = await encryptAll(crypto.randomBytes(3 * 1024 * 1024 + 123), KEY);
  const headerLength = 8 + 16 + 8;
  const first = sealed.readUInt32BE(headerLength) & 0x7fffffff;
  const firstChunkEnd = headerLength + 4 + first + 16;
  const removed = Buffer.concat([sealed.subarray(0, headerLength), sealed.subarray(firstChunkEnd)]);

  await assert.rejects(decryptAll(removed, KEY), /corrupt|wrong|truncated/i);
});

test('REQ-97 two backups of the same data differ (fresh salt and nonce each time)', async () => {
  const data = Buffer.from('same data');
  assert.ok(!(await encryptAll(data, KEY)).equals(await encryptAll(data, KEY)));
});

// ---------------------------------------------------------------------------
// SEC-6 / SEC-9 - input guard
// ---------------------------------------------------------------------------

test('SEC-6 operator injection and dotted keys are found at any depth', () => {
  assert.equal(findUnsafeKey({ email: { $ne: null } }).reason, 'operator_key');
  assert.equal(findUnsafeKey({ a: [{ b: { $where: '1' } }] }).reason, 'operator_key');
  assert.equal(findUnsafeKey({ 'a.b': 1 }).reason, 'operator_key');
  assert.equal(findUnsafeKey({ ok: 'a $dollar in a value is fine', n: [1, 2] }), null);
  assert.equal(findUnsafeKey('plain string'), null);
  assert.equal(findUnsafeKey(null), null);
});

test('SEC-9 card, CVV, UPI PIN and bank password fields are prohibited', () => {
  for (const key of ['cardNumber', 'card_number', 'cvv', 'CVV2', 'upi_pin', 'upiPin', 'bank_password', 'atmPin', 'card_security_code']) {
    assert.equal(findUnsafeKey({ [key]: 'x' })?.reason, 'prohibited_field', key);
  }
  assert.equal(findUnsafeKey({ name: 'HDFC Savings', note: 'paid card bill' }), null);
});

// ---------------------------------------------------------------------------
// SEC-7 - rate limiting
// ---------------------------------------------------------------------------

function fakeResponse() {
  const res = { headers: {}, statusCode: 200, body: null };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function hit(limiter, req) {
  const res = fakeResponse();
  let passed = false;
  await limiter(req, res, () => { passed = true; });
  return { passed, res };
}

test('SEC-7 the 101st request in a minute from one IP is answered 429 with Retry-After', async () => {
  const limiter = createRateLimiter({ name: 'g', max: 100, keyFor: (r) => `ip:${r.ip}`, store: new MemoryStore(60_000) });
  const req = { ip: '203.0.113.9', originalUrl: '/api/x' };

  for (let i = 1; i <= 100; i += 1) assert.ok((await hit(limiter, req)).passed, `request ${i}`);
  const blocked = await hit(limiter, req);

  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.ok(Number(blocked.res.headers['Retry-After']) >= 1);
  assert.ok((await hit(limiter, { ip: '203.0.113.10', originalUrl: '/api/x' })).passed, 'another IP is unaffected');
});

test('SEC-7 the authentication limit is 10 per minute per account, and accounts are independent', async () => {
  const limiter = createRateLimiter({ name: 'a', max: 10, keyFor: accountKey, store: new MemoryStore(60_000) });
  const as = (email, ip) => ({ ip, body: { email }, originalUrl: '/api/auth/login' });

  for (let i = 0; i < 10; i += 1) assert.ok((await hit(limiter, as('Victim@Example.com', `10.0.0.${i}`))).passed);
  // Same account from a new IP and with different capitalisation is still the same account.
  assert.equal((await hit(limiter, as('victim@example.com', '10.9.9.9'))).res.statusCode, 429);
  assert.ok((await hit(limiter, as('someone.else@example.com', '10.0.0.1'))).passed);
});

test('SEC-7 the window resets', async () => {
  const store = new MemoryStore(60_000);
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i += 1) store.hit('k', t0);
  assert.equal(store.hit('k', t0).count, 4);
  assert.equal(store.hit('k', t0 + 60_001).count, 1);
});

test('SEC-7 the client IP is only taken from a forwarded header when proxies are explicitly trusted', () => {
  const saved = process.env.TRUST_PROXY;
  try {
    delete process.env.TRUST_PROXY;
    assert.equal(trustProxySetting(), false);
    process.env.TRUST_PROXY = '1';
    assert.equal(trustProxySetting(), 1);
    process.env.TRUST_PROXY = 'true';
    assert.throws(() => trustProxySetting(), /TRUST_PROXY/, 'a blanket "trust everything" value is refused');
  } finally {
    if (saved === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = saved;
  }
});

// ---------------------------------------------------------------------------
// SEC-2, SEC-8, SEC-10, REQ-96 - configuration floors
// ---------------------------------------------------------------------------

test('SEC-2 the bcrypt work factor can never be configured below 12', () => {
  const saved = process.env.BCRYPT_ROUNDS;
  try {
    for (const value of ['4', '10', '11', '', 'abc', undefined]) {
      if (value === undefined) delete process.env.BCRYPT_ROUNDS;
      else process.env.BCRYPT_ROUNDS = value;
      assert.equal(bcryptRounds(), 12);
    }
    process.env.BCRYPT_ROUNDS = '13';
    assert.equal(bcryptRounds(), 13);
  } finally {
    if (saved === undefined) delete process.env.BCRYPT_ROUNDS;
    else process.env.BCRYPT_ROUNDS = saved;
  }
});

test('SEC-8 the inactivity limit is 30 minutes and cannot be raised', () => {
  const saved = process.env.SESSION_IDLE_TIMEOUT_MINUTES;
  try {
    delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
    assert.equal(sessionIdleMs(), 30 * 60 * 1000);
    process.env.SESSION_IDLE_TIMEOUT_MINUTES = '600';
    assert.equal(sessionIdleMs(), 30 * 60 * 1000);
    process.env.SESSION_IDLE_TIMEOUT_MINUTES = '5';
    assert.equal(sessionIdleMs(), 5 * 60 * 1000);
  } finally {
    if (saved === undefined) delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
    else process.env.SESSION_IDLE_TIMEOUT_MINUTES = saved;
  }
});

test('REQ-96 audit retention can never be configured below 12 months', () => {
  const saved = process.env.AUDIT_RETENTION_DAYS;
  try {
    process.env.AUDIT_RETENTION_DAYS = '30';
    assert.equal(auditRetentionDays(), 365);
    process.env.AUDIT_RETENTION_DAYS = '730';
    assert.equal(auditRetentionDays(), 730);
  } finally {
    if (saved === undefined) delete process.env.AUDIT_RETENTION_DAYS;
    else process.env.AUDIT_RETENTION_DAYS = saved;
  }
});

test('SEC-10 a signed attachment link never lives longer than 15 minutes', () => {
  const now = Date.now();
  const { expires } = signAttachment('a', 'u', now, 24 * 3600);
  assert.ok(expires - Math.floor(now / 1000) <= SIGNED_URL_MAX_SECONDS);

  const ok = signAttachment('a', 'u', now);
  assert.equal(verifyAttachment('a', 'u', ok.expires, ok.signature, now), 'ok');
  assert.equal(verifyAttachment('a', 'u', ok.expires, ok.signature, now + 6 * 60 * 1000), 'expired');
  assert.equal(verifyAttachment('a', 'someone-else', ok.expires, ok.signature, now), 'invalid');
});

// ---------------------------------------------------------------------------
// SEC-12 - configuration is validated, not trusted
// ---------------------------------------------------------------------------

const GOOD = {
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb://db/pfem',
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  EMAIL_VERIFICATION_SECRET: crypto.randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  BLIND_INDEX_KEY: crypto.randomBytes(32).toString('hex'),
  BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  ATTACHMENT_URL_SECRET: crypto.randomBytes(32).toString('hex'),
  APP_LOCK_SECRET: crypto.randomBytes(32).toString('hex'),
  CLIENT_ORIGIN: 'https://app.example.com',
  TRUST_PROXY: '1',
};

test('SEC-12 a complete production configuration has no problems', () => {
  assert.deepEqual(environmentProblems(GOOD), []);
});

test('SEC-12 production refuses placeholders, short secrets, a wildcard origin and dev switches', () => {
  const cases = [
    [{ JWT_SECRET: 'change-me-change-me-change-me-change-me' }, /JWT_SECRET/],
    [{ JWT_SECRET: 'short' }, /JWT_SECRET/],
    [{ ENCRYPTION_KEY: '' }, /ENCRYPTION_KEY/],
    [{ BLIND_INDEX_KEY: '' }, /BLIND_INDEX_KEY/],
    [{ CLIENT_ORIGIN: '*' }, /CLIENT_ORIGIN/],
    [{ CLIENT_ORIGIN: 'http://app.example.com' }, /https/],
    [{ DEV_AUTH_HEADER: 'true' }, /DEV_AUTH_HEADER/],
    [{ DEV_EMAIL_CONSOLE: 'true' }, /DEV_EMAIL_CONSOLE/],
    [{ TRUST_PROXY: '' }, /TRUST_PROXY/],
    [{ BACKUP_ENCRYPTION_KEY: GOOD.ENCRYPTION_KEY }, /BACKUP_ENCRYPTION_KEY/],
  ];
  for (const [override, pattern] of cases) {
    assert.ok(environmentProblems({ ...GOOD, ...override }).some((p) => pattern.test(p)), JSON.stringify(override));
  }
});

// ---------------------------------------------------------------------------
// SEC-11 / REQ-96 - the audit trail never holds secrets or financial detail
// ---------------------------------------------------------------------------

test('SEC-11 audit values drop secrets and replace notes and amounts', () => {
  const clean = sanitizeForAudit({
    password: 'hunter2', newPassword: 'x', token: 'eyJ.a.b', jwt: 'x', verification_code: '123456', code: '1',
    authorization: 'Bearer x', api_key: 'k', pin: '1234', app_lock_pin_hash: 'h',
    note: 'paid Dr. Rao for the biopsy', amount: '4500.00', balance: '1', opening_balance: '2',
    action: 'login', reason: 'wrong_password', count: 3, nested: { secret: 's', fine: 'ok' },
  });

  assert.equal(clean.action, 'login');
  assert.equal(clean.count, 3);
  assert.equal(clean.nested.fine, 'ok');
  for (const key of ['password', 'newPassword', 'token', 'jwt', 'verification_code', 'code', 'authorization', 'api_key', 'pin', 'app_lock_pin_hash', 'note', 'amount', 'balance', 'opening_balance']) {
    assert.equal(clean[key], '[redacted]', key);
  }
  assert.equal(clean.nested.secret, '[redacted]');
  assert.ok(!JSON.stringify(clean).includes('biopsy'));
});

test('SEC-11 long strings are truncated and deep objects are cut off', () => {
  const clean = sanitizeForAudit({ long: 'x'.repeat(5000), a: { b: { c: { d: { e: 1 } } } } });
  assert.ok(clean.long.length < 250);
  assert.equal(clean.a.b.c.d, '[redacted]');
});

// ---------------------------------------------------------------------------
// SEC-10 - file content screening
// ---------------------------------------------------------------------------

const pdf = (body) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`);

test('SEC-10 a PDF with JavaScript, auto-actions or embedded files is refused, even with hex-escaped names', () => {
  for (const body of ['/JavaScript (app.alert(1))', '/JS (x)', '/OpenAction 1 0 R', '/Launch /Win', '/EmbeddedFile', '/J#61vaScript (x)', '/AA << >>']) {
    assert.equal(unsafeContentReason(pdf(body), 'application/pdf'), 'pdf_active_content', body);
    const result = validateAttachment({ buffer: pdf(body), fileName: 'r.pdf', mimeType: 'application/pdf' });
    assert.equal(result.status, 422, body);
  }
  assert.equal(unsafeContentReason(pdf('1 0 obj << /Type /Catalog >> endobj'), 'application/pdf'), null);
});

test('SEC-10 an image carrying a script tag (polyglot) or missing its end marker is refused', () => {
  const jpg = (inner) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(inner), Buffer.from([0xff, 0xd9])]);
  assert.equal(unsafeContentReason(jpg('<script>alert(1)</script>'), 'image/jpeg'), 'embedded_markup');
  assert.equal(unsafeContentReason(jpg('<?php system($_GET[1]); ?>'), 'image/jpeg'), 'embedded_markup');
  assert.equal(unsafeContentReason(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), 'image/jpeg'), 'jpeg_truncated');
  assert.equal(unsafeContentReason(jpg('harmless'), 'image/jpeg'), null);
  assert.equal(unsafeContentReason(pdf('/Type /Catalog <html>'), 'application/pdf'), 'embedded_markup');
});
