import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, stopApi, apiUrl, createAccount, createCategory, record, fetchUrl } from './helpers/integration.js';
import { PASSWORD, bearer, createRealUser, signIn, signToken } from './helpers/auth.js';
import AuditLog from '../src/models/AuditLog.js';
import Session from '../src/models/Session.js';

/**
 * US-28 (#67): SEC-4 JWT, SEC-5 ownership, SEC-6 injection and headers,
 * SEC-8 server-side inactivity timeout, SEC-9 prohibited credentials,
 * SEC-10 attachments. Real JWTs against the real app and MongoDB.
 */

let alice; let bob; let aliceApi; let bobApi; let aliceToken;
let aliceAccount; let aliceCategory; let aliceTx;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17),
  Buffer.alloc(300, 7), Buffer.from([0, 0, 0, 0]), Buffer.from('IEND'), Buffer.from([0xae, 0x42, 0x60, 0x82]),
]);

before(async () => {
  await startApi();
  alice = await createRealUser('alice');
  bob = await createRealUser('bob');
  aliceToken = (await signIn(alice)).token;
  aliceApi = bearer(apiUrl(), aliceToken);
  bobApi = bearer(apiUrl(), (await signIn(bob)).token);

  aliceAccount = (await aliceApi.post('/api/accounts', { name: 'Alice Savings', type: 'bank', opening_balance: '5000.00', currency: 'INR' })).body.account;
  aliceCategory = (await aliceApi.post('/api/categories', { name: 'Alice Food', type: 'expense' })).body.category;
  aliceTx = (await aliceApi.post('/api/transactions', {
    type: 'expense', amount: '321.00', account_id: aliceAccount.id, category_id: aliceCategory.id,
    transaction_date: new Date().toISOString().slice(0, 10), note: 'alice private note',
  })).body.data;
});
after(stopApi);

// ---------------------------------------------------------------------------
// SEC-4 - JWT
// ---------------------------------------------------------------------------

test('SEC-4 every protected area refuses a request with no token (401)', async () => {
  const anon = bearer(apiUrl(), null);
  for (const path of ['/api/accounts', '/api/transactions', '/api/budgets', '/api/goals', '/api/categories', '/api/tags', '/api/reports/dashboard', '/api/data/export.json', '/api/recurring-rules', '/api/bill-reminders', '/api/notifications', '/api/privacy/me', '/api/admin/users', '/api/auth/me', '/api/does-not-exist']) {
    assert.equal((await anon.get(path)).status, 401, path);
  }
  for (const [path, body] of [['/api/transactions', {}], ['/api/accounts', {}], ['/api/privacy/consent', {}]]) {
    assert.equal((await anon.post(path, body)).status, 401, path);
  }
});

test('SEC-4 only registration, sign-in, verification and password reset are open without a token', async () => {
  const anon = bearer(apiUrl(), null);
  // These reach their handlers (and fail validation), proving they are not behind the gate.
  for (const path of ['/api/auth/register', '/api/auth/login', '/api/auth/verify-email', '/api/auth/resend-code', '/api/auth/password-reset/request', '/api/auth/password-reset/confirm']) {
    assert.equal((await anon.post(path, {})).status, 400, path);
  }
  assert.equal((await fetch(`${apiUrl()}/api/health`)).status, 200);
});

test('SEC-4 an expired token is rejected with 401', async () => {
  const { jti } = await signIn(alice);
  const expired = signToken({ jti, iat: Math.floor(Date.now() / 1000) - 7200 }, { subject: String(alice._id), expiresIn: 60 });
  const res = await bearer(apiUrl(), expired).get('/api/accounts');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'TOKEN_EXPIRED');
});

test('SEC-4 a tampered token is rejected with 401 (payload edited, signature kept)', async () => {
  const [head, payload, sig] = aliceToken.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  claims.sub = String(bob._id);
  const forged = [head, Buffer.from(JSON.stringify(claims)).toString('base64url'), sig].join('.');
  const res = await bearer(apiUrl(), forged).get('/api/accounts');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'TOKEN_INVALID');
});

test('SEC-4 a token signed with another secret, the "none" algorithm, or another HMAC algorithm is rejected', async () => {
  const { jti } = await signIn(alice);
  const base = { jti };
  const wrongSecret = signToken(base, { subject: String(alice._id), expiresIn: 3600 }, 'x'.repeat(48));
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...base, sub: String(alice._id), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.`;
  const hs512 = signToken(base, { subject: String(alice._id), expiresIn: 3600, algorithm: 'HS512' });
  for (const token of [wrongSecret, none, hs512, 'not.a.jwt', 'garbage', '']) {
    assert.equal((await bearer(apiUrl(), token).get('/api/accounts')).status, 401, token.slice(0, 20));
  }
});

test('SEC-4 a token with no expiry, or older than 24 hours, is rejected even if signed correctly', async () => {
  const { jti } = await signIn(alice);
  const noExp = signToken({ jti }, { subject: String(alice._id) });
  assert.equal((await bearer(apiUrl(), noExp).get('/api/accounts')).status, 401);

  const old = signToken({ jti, iat: Math.floor(Date.now() / 1000) - 25 * 3600 }, { subject: String(alice._id), expiresIn: 7 * 24 * 3600 });
  assert.equal((await bearer(apiUrl(), old).get('/api/accounts')).status, 401);
});

test('SEC-4 a signed-out (revoked) session cannot be reused', async () => {
  const user = await createRealUser('logout');
  const { token } = await signIn(user);
  const api = bearer(apiUrl(), token);
  assert.equal((await api.get('/api/accounts')).status, 200);
  assert.equal((await api.post('/api/auth/logout')).status, 200);
  assert.equal((await api.get('/api/accounts')).status, 401);
});

test('SEC-4 a real sign-in issues a 24-hour token', async () => {
  const res = await bearer(apiUrl(), null).post('/api/auth/login', { email: alice.email, password: PASSWORD });
  assert.equal(res.status, 200);
  const claims = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
  assert.equal(claims.exp - claims.iat, 24 * 3600);
  assert.equal((await bearer(apiUrl(), res.body.token).get('/api/auth/me')).body.data.role, 'user');
});

// ---------------------------------------------------------------------------
// SEC-8 - inactivity timeout enforced by the server
// ---------------------------------------------------------------------------

test('SEC-8 a session idle for more than 30 minutes is ended by the server', async () => {
  const user = await createRealUser('idle');
  const { token, session } = await signIn(user, { lastActivity: new Date(Date.now() - 31 * 60 * 1000) });
  const res = await bearer(apiUrl(), token).get('/api/accounts');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'SESSION_IDLE');
  assert.ok((await Session.findById(session._id)).revoked_at, 'the session is revoked, so it cannot be revived');
  assert.equal((await bearer(apiUrl(), token).get('/api/accounts')).status, 401);
});

test('SEC-8 a session idle for less than 30 minutes works, and use pushes the deadline forward', async () => {
  const user = await createRealUser('active');
  const { token, session } = await signIn(user, { lastActivity: new Date(Date.now() - 29 * 60 * 1000) });
  assert.equal((await bearer(apiUrl(), token).get('/api/accounts')).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  const refreshed = await Session.findById(session._id);
  assert.ok(Date.now() - refreshed.last_activity_at.getTime() < 10_000, 'activity was recorded');
});

test('SEC-8 the app-lock heartbeat is a timer, not a person: it does not keep a session alive', async () => {
  const user = await createRealUser('heartbeat', { app_lock_enabled: true });
  const { token, session } = await signIn(user, { lastActivity: new Date(Date.now() - 20 * 60 * 1000) });
  await Session.updateOne({ _id: session._id }, { app_unlocked_until: new Date(Date.now() + 60_000) });
  const before = (await Session.findById(session._id)).last_activity_at.getTime();

  const api = bearer(apiUrl(), token);
  await api.post('/api/app-lock/heartbeat');
  await api.get('/api/app-lock/status');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await Session.findById(session._id)).last_activity_at.getTime(), before);
});

test('SEC-8 the idle limit is not configurable above 30 minutes', async () => {
  process.env.SESSION_IDLE_TIMEOUT_MINUTES = '600';
  try {
    const user = await createRealUser('idlecap');
    const { token } = await signIn(user, { lastActivity: new Date(Date.now() - 45 * 60 * 1000) });
    assert.equal((await bearer(apiUrl(), token).get('/api/accounts')).status, 401);
  } finally {
    delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
  }
});

// ---------------------------------------------------------------------------
// SEC-5 - ownership / IDOR
// ---------------------------------------------------------------------------

test('SEC-5 another user cannot read, change or delete an account', async () => {
  const id = aliceAccount.id;
  assert.ok([403, 404].includes((await bobApi.get(`/api/accounts/${id}`)).status));
  assert.ok([403, 404].includes((await bobApi.patch(`/api/accounts/${id}`, { name: 'hijack' })).status));
  assert.ok([403, 404].includes((await bobApi.delete(`/api/accounts/${id}`)).status));
  assert.ok(!JSON.stringify((await bobApi.get('/api/accounts')).body).includes('Alice Savings'));
  assert.equal((await aliceApi.get(`/api/accounts/${id}`)).status, 200);
});

test('SEC-5 another user cannot read, change, delete or restore a transaction, and cannot post into Alice\'s account', async () => {
  const id = aliceTx.id;
  for (const [method, path, body] of [['get', `/api/transactions/${id}`], ['patch', `/api/transactions/${id}`, { amount: '1' }], ['delete', `/api/transactions/${id}`], ['post', `/api/transactions/${id}/restore`]]) {
    const res = await bobApi[method](path, body);
    assert.ok([403, 404].includes(res.status), `${method} ${path} -> ${res.status}`);
  }
  assert.ok(!JSON.stringify((await bobApi.get('/api/transactions')).body).includes('alice private note'));
  const into = await bobApi.post('/api/transactions', { type: 'expense', amount: '5', account_id: aliceAccount.id, category_id: aliceCategory.id, transaction_date: new Date().toISOString().slice(0, 10) });
  assert.ok([400, 403, 404, 422].includes(into.status), `posting into another user's account -> ${into.status}`);
  const own = await aliceApi.get('/api/transactions');
  assert.equal(own.status, 200);
  assert.ok(JSON.stringify(own.body).includes('alice private note'), 'the owner still reads it, decrypted');
});

test('SEC-5 another user cannot touch Alice\'s categories, budgets, goals, tags, recurring rules or reminders', async () => {
  const budget = (await aliceApi.post('/api/budgets', { period_type: 'monthly', amount: '9999' })).body.budget;
  const goal = (await aliceApi.post('/api/goals', { name: 'Alice Goal', target_amount: '1000', target_date: '2030-01-01' })).body;
  const goalId = goal.goal?.id ?? goal.data?.id ?? goal.id;
  assert.ok(budget?.id && goalId, 'Alice\'s fixtures were created');

  for (const [resource, id] of [['categories', aliceCategory.id], ['budgets', budget.id], ['goals', goalId]]) {
    for (const [method, body] of [['get'], ['patch', { name: 'hijack', amount: '1' }], ['put', { name: 'hijack' }], ['delete']]) {
      if (typeof bobApi[method] !== 'function') continue;
      const res = await bobApi[method](`/api/${resource}/${id}`, body);
      assert.ok([400, 403, 404, 405].includes(res.status), `${method} /api/${resource}/${id} -> ${res.status}`);
      assert.notEqual(res.status, 200, `${method} /api/${resource}/${id} must not succeed`);
      assert.notEqual(res.status, 204);
    }
  }

  const listings = JSON.stringify([
    (await bobApi.get('/api/categories')).body, (await bobApi.get('/api/budgets')).body, (await bobApi.get('/api/goals')).body,
    (await bobApi.get('/api/tags')).body, (await bobApi.get('/api/recurring-rules')).body, (await bobApi.get('/api/bill-reminders')).body,
    (await bobApi.get('/api/notifications')).body,
  ]);
  for (const secret of ['Alice Food', 'Alice Goal', '9999.00', 'alice private note']) assert.ok(!listings.includes(secret), secret);

  // Nothing of Alice's was changed or removed by Bob.
  assert.equal((await aliceApi.get('/api/goals')).body && JSON.stringify((await aliceApi.get('/api/goals')).body).includes('Alice Goal'), true);
  assert.ok(JSON.stringify((await aliceApi.get('/api/categories')).body).includes('Alice Food'));
  assert.ok(JSON.stringify((await aliceApi.get('/api/budgets')).body).includes('9999.00'));
  assert.ok(!JSON.stringify((await aliceApi.get('/api/categories')).body).includes('hijack'));

  // A budget or transaction cannot be pointed at another user's category or account.
  const crossCategory = await bobApi.post('/api/budgets', { period_type: 'monthly', amount: '5', category_id: aliceCategory.id });
  assert.ok(crossCategory.status >= 400 && crossCategory.status < 500, `budget on another user's category -> ${crossCategory.status}`);
});

test('SEC-5 another user cannot list, read, delete or download Alice\'s attachments', async () => {
  const up = await aliceApi.raw('POST', `/api/transactions/${aliceTx.id}/attachments`, { body: png, headers: { 'Content-Type': 'image/png', 'X-File-Name': 'receipt.png' } });
  assert.equal(up.status, 201);
  const attachment = (await up.json()).data;

  assert.ok([403, 404].includes((await bobApi.get(`/api/transactions/${aliceTx.id}/attachments`)).status));
  assert.ok([403, 404].includes((await bobApi.get(`/api/attachments/${attachment.id}`)).status));
  assert.ok([403, 404].includes((await bobApi.delete(`/api/attachments/${attachment.id}`)).status));
  const uploadToHers = await bobApi.raw('POST', `/api/transactions/${aliceTx.id}/attachments`, { body: png, headers: { 'Content-Type': 'image/png', 'X-File-Name': 'x.png' } });
  assert.ok([403, 404].includes(uploadToHers.status));

  // Bob cannot reuse a link that was signed for Alice by changing the user, and a bare URL is refused.
  const bare = await fetchUrl(`${apiUrl()}/api/attachments/${attachment.id}/content`);
  assert.equal(bare.status, 403);
  const url = new URL(attachment.view_url);
  url.searchParams.set('signature', 'A'.repeat(43));
  assert.equal((await fetchUrl(url.toString())).status, 403);
  assert.equal((await fetchUrl(attachment.view_url)).status, 200, 'the genuine signed link works');
});

// ---------------------------------------------------------------------------
// SEC-10 - attachments
// ---------------------------------------------------------------------------

test('SEC-10 files are encrypted on disk under unpredictable names, outside the web root, and served through a signed link under 15 minutes', async () => {
  const fs = await import('node:fs/promises');
  const { uploadDir } = await import('../src/services/storageService.js');
  const up = await aliceApi.raw('POST', `/api/transactions/${aliceTx.id}/attachments`, { body: png, headers: { 'Content-Type': 'image/png', 'X-File-Name': 'second.png' } });
  const attachment = (await up.json()).data;

  const files = await fs.readdir(uploadDir());
  assert.ok(files.every((f) => /^[a-f\d]{32}\.(png|jpg|pdf)$/.test(f)), 'random 128-bit names');
  const raw = await fs.readFile(`${uploadDir()}/${files[0]}`);
  assert.equal(raw.subarray(0, 8).toString(), 'PFEMENC1');
  assert.ok(!raw.includes(Buffer.from('IHDR')), 'file bytes are not readable on disk');
  assert.ok(!uploadDir().includes('/public') && !uploadDir().includes('/client'), 'not in a served directory');

  const link = new URL(attachment.view_url);
  const ttl = Number(link.searchParams.get('expires')) - Math.floor(Date.now() / 1000);
  assert.ok(ttl > 0 && ttl <= 15 * 60, `link lives ${ttl}s`);

  const served = await fetchUrl(attachment.view_url);
  assert.ok(served.buffer.equals(png), 'the original bytes come back intact');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('content-security-policy'), /sandbox/);
  assert.match(served.headers.get('cache-control'), /no-store/);
});

test('SEC-10 a signed link stops working when its owner is suspended', async () => {
  const user = await createRealUser('linkowner');
  const api = bearer(apiUrl(), (await signIn(user)).token);
  const account = (await api.post('/api/accounts', { name: 'A', type: 'cash', opening_balance: '1', currency: 'INR' })).body.account;
  const category = (await api.post('/api/categories', { name: 'C', type: 'expense' })).body.category;
  const tx = (await api.post('/api/transactions', { type: 'expense', amount: '1', account_id: account.id, category_id: category.id, transaction_date: new Date().toISOString().slice(0, 10) })).body.data;
  const att = (await (await api.raw('POST', `/api/transactions/${tx.id}/attachments`, { body: png, headers: { 'Content-Type': 'image/png', 'X-File-Name': 'a.png' } })).json()).data;

  assert.equal((await fetchUrl(att.view_url)).status, 200);
  const User = (await import('../src/models/User.js')).default;
  await User.updateOne({ _id: user._id }, { status: 'suspended' });
  assert.equal((await fetchUrl(att.view_url)).status, 403);
  assert.ok(await AuditLog.findOne({ action: 'attachment.access_denied', 'metadata.reason': 'owner_inactive' }));
});

test('SEC-10 malicious uploads are refused: executables, renamed files, scripted PDFs, polyglots, oversize', async () => {
  const send = (body, type, name) => aliceApi.raw('POST', `/api/transactions/${aliceTx.id}/attachments`, { body, headers: { 'Content-Type': type, 'X-File-Name': name } });
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]);
  const scriptedPdf = Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF\n');
  const polyglot = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<script>alert(1)</script>'), Buffer.from([0xff, 0xd9])]);
  const html = Buffer.from('<html><script>alert(1)</script></html>');

  assert.equal((await send(exe, 'image/png', 'a.png')).status, 415);
  assert.equal((await send(exe, 'application/pdf', 'a.pdf')).status, 415);
  assert.equal((await send(html, 'text/html', 'a.html')).status, 415);
  assert.equal((await send(html, 'image/png', 'a.png')).status, 415);
  assert.equal((await send(scriptedPdf, 'application/pdf', 'a.pdf')).status, 422);
  assert.equal((await send(polyglot, 'image/jpeg', 'a.jpg')).status, 422);
  assert.equal((await send(png, 'image/png', 'a.png.exe')).status, 415);
  assert.equal((await send(Buffer.alloc(6 * 1024 * 1024), 'image/png', 'big.png')).status, 413);
  assert.equal((await send(Buffer.alloc(0), 'image/png', 'empty.png')).status, 400);
});

// ---------------------------------------------------------------------------
// SEC-6 / SEC-9 - injection and prohibited credentials
// ---------------------------------------------------------------------------

test('SEC-6 operator injection in a JSON body is refused (login bypass attempt)', async () => {
  const anon = bearer(apiUrl(), null);
  for (const body of [{ email: { $ne: null }, password: { $ne: null } }, { email: alice.email, password: { $gt: '' } }, { email: { $regex: '.*' }, password: 'x' }, { 'email.$ne': 'x', password: 'y' }]) {
    const res = await anon.post('/api/auth/login', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.token, undefined);
  }
  assert.ok(await AuditLog.findOne({ action: 'request.injection_rejected' }));
});

test('SEC-6 operator injection in a query string is refused', async () => {
  for (const q of ['note[$ne]=x', 'search[$regex]=.*', 'account_id[$gt]=', 'type[$in][]=expense', 'a.b=1']) {
    assert.equal((await aliceApi.get(`/api/transactions?${q}`)).status, 400, q);
  }
});

test('SEC-6 operator injection in a body to an authenticated route is refused and stores nothing', async () => {
  const before = (await aliceApi.get('/api/transactions')).body;
  const res = await aliceApi.post('/api/transactions', { type: 'expense', amount: { $gt: 0 }, account_id: { $ne: null }, category_id: aliceCategory.id });
  assert.equal(res.status, 400);
  assert.deepEqual((await aliceApi.get('/api/transactions')).body, before);
});

test('SEC-6 invalid input is rejected by server-side validation (types, ranges, lengths)', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const base = { type: 'expense', amount: '10', account_id: aliceAccount.id, category_id: aliceCategory.id, transaction_date: today };
  for (const bad of [{ amount: '-5' }, { amount: 'abc' }, { amount: '1.234' }, { type: 'sideways' }, { transaction_date: 'tomorrow' }, { note: 'x'.repeat(1001) }, { account_id: 'not-an-id' }]) {
    const res = await aliceApi.post('/api/transactions', { ...base, ...bad });
    assert.ok(res.status >= 400 && res.status < 500, `${JSON.stringify(bad)} -> ${res.status}`);
  }
  assert.equal((await bearer(apiUrl(), null).post('/api/auth/register', { name: 'x'.repeat(500), email: 'a@b.co', password: 'Aa1!aaaa', termsAccepted: true, privacyPolicyAccepted: true, dataProcessingConsent: true })).status, 400);
});

test('SEC-6 stored markup is returned as inert JSON text, never as HTML', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const res = await aliceApi.post('/api/transactions', { type: 'expense', amount: '2', account_id: aliceAccount.id, category_id: aliceCategory.id, transaction_date: new Date().toISOString().slice(0, 10), note: payload });
  assert.equal(res.status, 201);
  const raw = await aliceApi.raw('GET', '/api/transactions');
  assert.match(raw.headers.get('content-type'), /^application\/json/);
  assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
});

test('SEC-9 card numbers, CVVs, UPI PINs and bank passwords are refused wherever they are sent', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const attempts = [
    ['/api/accounts', { name: 'Card', type: 'card', opening_balance: '1', currency: 'INR', cardNumber: '4111111111111111' }],
    ['/api/accounts', { name: 'Bank', type: 'bank', opening_balance: '1', currency: 'INR', cvv: '123' }],
    ['/api/accounts', { name: 'UPI', type: 'bank', opening_balance: '1', currency: 'INR', upi_pin: '1234' }],
    ['/api/accounts', { name: 'Bank', type: 'bank', opening_balance: '1', currency: 'INR', bank_password: 'hunter2' }],
    ['/api/transactions', { type: 'expense', amount: '1', account_id: aliceAccount.id, category_id: aliceCategory.id, transaction_date: today, nested: { card_number: '4111111111111111' } }],
    ['/api/auth/register', { name: 'A', email: 'a@b.co', password: 'Aa1!aaaa', cvv: '1' }],
  ];
  for (const [path, body] of attempts) {
    const res = await aliceApi.post(path, body);
    assert.equal(res.status, 400, `${path} ${Object.keys(body).join(',')}`);
    assert.match(res.body.message, /never collects/);
  }
  const Account = (await import('../src/models/Account.js')).default;
  assert.equal(await Account.countDocuments({ name: { $in: ['Card', 'UPI'] } }), 0);
  assert.ok(await AuditLog.findOne({ action: 'request.prohibited_field' }));
});

test('SEC-9 no model has a field for card, CVV, UPI PIN or bank-password data', async () => {
  const mongoose = (await import('mongoose')).default;
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(new URL('../src/models', import.meta.url)).filter((n) => n.endsWith('.js'))) await import(`../src/models/${f}`);
  const forbidden = /card.?(number|no)|cvv|cvc|upi.?pin|atm.?pin|bank.?(password|login)|net.?banking/i;
  for (const name of mongoose.modelNames()) {
    for (const path of Object.keys(mongoose.model(name).schema.paths)) assert.ok(!forbidden.test(path), `${name}.${path}`);
  }
});

// ---------------------------------------------------------------------------
// SEC-6 - headers, CORS, CSRF, error handling
// ---------------------------------------------------------------------------

test('SEC-6 responses carry the security headers and a strict Content-Security-Policy', async () => {
  const res = await fetch(`${apiUrl()}/api/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'.*frame-ancestors 'none'/);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.ok(res.headers.get('permissions-policy'));
});

test('SEC-6 CORS allows only the configured origin and never credentials', async () => {
  const good = await fetch(`${apiUrl()}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const evil = await fetch(`${apiUrl()}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.notEqual(good.headers.get('access-control-allow-origin'), '*');
  assert.equal(good.headers.get('access-control-allow-credentials'), null);

  const preflight = await fetch(`${apiUrl()}/api/transactions`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
});

test('SEC-6 CSRF: a state-changing request from a foreign origin is refused even with a valid token', async () => {
  const res = await bearer(apiUrl(), aliceToken, { Origin: 'https://evil.example' }).post('/api/categories', { name: 'csrf', type: 'expense' });
  assert.equal(res.status, 403);
  assert.equal((await bearer(apiUrl(), aliceToken, { Origin: 'http://localhost:5173' }).post('/api/categories', { name: 'fromclient', type: 'expense' })).status, 201);
  // Reads from a foreign origin are not blocked by the guard (CORS stops the page reading them).
  assert.equal((await bearer(apiUrl(), aliceToken, { Origin: 'https://evil.example' }).get('/api/categories')).status, 200);
});

test('SEC-6 the API sets no cookies, so there is nothing for CSRF to ride on', async () => {
  const login = await bearer(apiUrl(), null).post('/api/auth/login', { email: alice.email, password: PASSWORD });
  assert.equal(login.headers.get('set-cookie'), null);
});

test('SEC-11 errors do not leak stack traces, queries or internals', async () => {
  const bad = await fetch(`${apiUrl()}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email": ' });
  assert.equal(bad.status, 400);
  const text = await bad.text();
  assert.ok(!/at .*\.js|node_modules|SyntaxError|Unexpected/.test(text), text);

  const missing = await aliceApi.get('/api/transactions/not-an-object-id');
  assert.ok(!/CastError|node_modules|mongoose|at .*\.js/.test(JSON.stringify(missing.body)));
  const notFound = await aliceApi.get('/api/nope?x=<script>');
  assert.ok(!JSON.stringify(notFound.body).includes('<script>'), 'the request path is not reflected');
});

test('SEC-11 no response from the auth, admin or privacy areas contains a hash, secret or other user\'s data', async () => {
  const login = await bearer(apiUrl(), null).post('/api/auth/login', { email: alice.email, password: PASSWORD });
  const me = await bearer(apiUrl(), login.body.token).get('/api/auth/me');
  const privacy = await aliceApi.get('/api/privacy/me');
  const text = JSON.stringify([login.body, me.body, privacy.body]);
  for (const forbidden of ['password_hash', '$2a$', '$2b$', 'email_hash', 'app_lock_pin', 'email_verification_code', 'password_reset_token', 'enc:v1:']) {
    assert.ok(!text.includes(forbidden), forbidden);
  }
  assert.ok(!text.includes(bob.email));
});
