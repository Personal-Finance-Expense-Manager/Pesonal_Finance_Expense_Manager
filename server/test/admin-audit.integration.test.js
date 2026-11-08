import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, stopApi, apiUrl, createAccount, createCategory, apiAs, record, createUser } from './helpers/integration.js';
import { PASSWORD, bearer, createAdminUser, createRealUser, signIn, signToken } from './helpers/auth.js';
import AuditLog from '../src/models/AuditLog.js';
import Session from '../src/models/Session.js';
import User from '../src/models/User.js';

/**
 * US-26 (#62): REQ-94 administration, REQ-96 audit trail.
 * Real JWTs, real MongoDB, the real Express app.
 */

let admin; let adminApi; let person; let personApi; let personToken;

before(async () => {
  await startApi();
  admin = await createAdminUser();
  person = await createRealUser('member');
  adminApi = bearer(apiUrl(), (await signIn(admin)).token);
  personToken = (await signIn(person)).token;
  personApi = bearer(apiUrl(), personToken);
});
after(stopApi);

const actions = async (filter = {}) => (await AuditLog.find(filter).lean()).map((e) => e.action);

// ---------------------------------------------------------------------------
// REQ-94 - role enforcement on the server
// ---------------------------------------------------------------------------

test('REQ-94 every admin endpoint refuses an ordinary user with 403', async () => {
  const id = String(person._id);
  const calls = [
    ['get', '/api/admin/summary'],
    ['get', '/api/admin/users'],
    ['get', `/api/admin/users/${id}`],
    ['post', `/api/admin/users/${id}/suspend`, { reason: 'x' }],
    ['post', `/api/admin/users/${id}/restore`],
    ['get', '/api/admin/audit-logs'],
    ['get', '/api/admin/backups'],
    ['post', '/api/admin/backups'],
    ['post', '/api/admin/backups/pfem-backup-20260101T000000Z-aaaaaaaa/restore', { confirm: 'RESTORE', password: PASSWORD }],
  ];
  for (const [method, path, body] of calls) {
    const res = await personApi[method](path, body);
    assert.equal(res.status, 403, `${method} ${path}`);
  }
  assert.equal((await person.constructor.findById(person._id)).status, 'active');
});

test('REQ-94 every admin endpoint refuses a request with no token (401) and a forged role claim does nothing', async () => {
  assert.equal((await bearer(apiUrl(), null).get('/api/admin/users')).status, 401);
  // A token cannot grant a role: the role is read from the stored user, not the claims.
  const { jti } = await signIn(person);
  const forged = signToken({ jti, role: 'admin', isAdmin: true }, { subject: String(person._id), expiresIn: 3600 });
  assert.equal((await bearer(apiUrl(), forged).get('/api/admin/users')).status, 403);
});

test('REQ-94 the development X-User-Id shortcut can never act as an administrator', async () => {
  const res = await apiAs(admin).get('/api/admin/users');
  assert.equal(res.status, 403);
});

test('REQ-96 a denied admin attempt is audited with the actor and source IP', async () => {
  await personApi.get('/api/admin/users');
  const entry = await AuditLog.findOne({ action: 'admin.access_denied', user_id: person._id }).lean();
  assert.ok(entry);
  assert.equal(entry.category, 'authz');
  assert.equal(entry.outcome, 'denied');
  assert.ok(entry.ip_address, 'source IP recorded');
  assert.ok(entry.timestamp instanceof Date);
});

// ---------------------------------------------------------------------------
// REQ-94 - user counts, listing, filtering, pagination
// ---------------------------------------------------------------------------

test('REQ-94 the summary reports user counts and account statuses', async () => {
  const res = await adminApi.get('/api/admin/summary');
  assert.equal(res.status, 200);
  const { users } = res.body;
  assert.equal(users.total, await User.countDocuments());
  assert.equal(users.admins, 1);
  assert.equal(users.active + users.suspended + users.closed, users.total);
});

test('REQ-94 the user list is paginated and filterable by status, role, verification and exact email', async () => {
  for (let i = 0; i < 4; i += 1) await createRealUser('filler');
  await createRealUser('unverified', { email_verified: false });

  const page1 = await adminApi.get('/api/admin/users?limit=3&page=1');
  assert.equal(page1.status, 200);
  assert.equal(page1.body.data.length, 3);
  assert.equal(page1.body.total, await User.countDocuments());
  assert.equal(page1.body.total_pages, Math.ceil(page1.body.total / 3));

  const page2 = await adminApi.get('/api/admin/users?limit=3&page=2');
  const ids1 = new Set(page1.body.data.map((u) => u.id));
  assert.ok(page2.body.data.every((u) => !ids1.has(u.id)), 'pages do not overlap');

  assert.ok((await adminApi.get('/api/admin/users?role=admin')).body.data.every((u) => u.role === 'admin'));
  assert.ok((await adminApi.get('/api/admin/users?verified=false')).body.data.every((u) => u.email_verified === false));

  const byEmail = await adminApi.get(`/api/admin/users?email=${encodeURIComponent(person.email.toUpperCase())}`);
  assert.equal(byEmail.body.data.length, 1, 'encrypted email is found through the blind index');
  assert.equal(byEmail.body.data[0].email, person.email, 'and returned decrypted');
  assert.equal(byEmail.body.data[0].name, person.name);

  for (const bad of ['limit=0', 'limit=101', 'page=0', 'status=banana', 'role=root', 'sort=random', 'id=nope']) {
    assert.equal((await adminApi.get(`/api/admin/users?${bad}`)).status, 400, bad);
  }
});

// ---------------------------------------------------------------------------
// REQ-94 - administrators never see financial data
// ---------------------------------------------------------------------------

test('REQ-94 admin responses contain no financial data, secrets or attachments', async () => {
  const owner = await createUser('owner');
  const account = await createAccount(owner, { opening_balance: '73123.45' });
  const category = await createCategory(owner);
  await record(owner, { type: 'expense', amount: '98765.43', account_id: String(account._id), category_id: String(category._id), note: 'chemotherapy deposit' });

  const bodies = [
    JSON.stringify((await adminApi.get('/api/admin/users?limit=100')).body),
    JSON.stringify((await adminApi.get(`/api/admin/users/${owner._id}`)).body),
    JSON.stringify((await adminApi.get('/api/admin/summary')).body),
    JSON.stringify((await adminApi.get('/api/admin/audit-logs?limit=100')).body),
  ];
  for (const text of bodies) {
    for (const forbidden of ['98765', '73123', 'chemotherapy', 'opening_balance', 'password_hash', 'app_lock_pin', 'email_verification_code', 'password_reset_token', 'object_key', 'monthly_income']) {
      assert.ok(!text.includes(forbidden), `admin response leaked "${forbidden}"`);
    }
  }

  const keys = Object.keys((await adminApi.get(`/api/admin/users/${owner._id}`)).body.data).sort();
  assert.deepEqual(keys, ['consent_given', 'created_at', 'email', 'email_verified', 'erased_at', 'id', 'last_sign_in_at', 'name', 'role', 'status', 'suspended_at', 'suspension_reason'].sort());

  // There is simply no admin route to a user's money.
  for (const path of [`/api/admin/users/${owner._id}/transactions`, `/api/admin/transactions`, `/api/admin/accounts`, `/api/admin/reports`, `/api/admin/attachments`]) {
    assert.equal((await adminApi.get(path)).status, 404, path);
  }
  // And an admin token cannot read another user's data through the ordinary API either.
  const asAdmin = await adminApi.get(`/api/transactions`);
  assert.ok(!JSON.stringify(asAdmin.body).includes('98765.43'));
});

// ---------------------------------------------------------------------------
// REQ-94 - suspension and restoration
// ---------------------------------------------------------------------------

test('REQ-94 suspending requires a reason, ends sessions at once and blocks sign-in; restoring reverses it', async () => {
  const target = await createRealUser('suspendee');
  const { token } = await signIn(target);
  const targetApi = bearer(apiUrl(), token);
  assert.equal((await targetApi.get('/api/accounts')).status, 200);

  assert.equal((await adminApi.post(`/api/admin/users/${target._id}/suspend`, {})).status, 400, 'a reason is required');
  assert.equal((await adminApi.post(`/api/admin/users/${target._id}/suspend`, { reason: 'x'.repeat(301) })).status, 400);

  const suspended = await adminApi.post(`/api/admin/users/${target._id}/suspend`, { reason: 'Reported abuse' });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.data.status, 'suspended');
  assert.equal(suspended.body.data.suspension_reason, 'Reported abuse');

  // The existing token stops working immediately.
  const refused = await targetApi.get('/api/accounts');
  assert.equal(refused.status, 401);
  assert.equal(await Session.countDocuments({ user_id: target._id, revoked_at: null }), 0);

  // Password sign-in: told it is suspended only with the right password.
  const login = (email, password) => bearer(apiUrl(), null).post('/api/auth/login', { email, password });
  const right = await login(target.email, PASSWORD);
  assert.equal(right.status, 403);
  assert.equal(right.body.code, 'ACCOUNT_SUSPENDED');
  const wrong = await login(target.email, 'Wrong-Password1!');
  assert.equal(wrong.status, 401, 'a wrong password reveals nothing about the account');

  assert.equal((await adminApi.post(`/api/admin/users/${target._id}/suspend`, { reason: 'again' })).status, 409);

  const restored = await adminApi.post(`/api/admin/users/${target._id}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.status, 'active');
  assert.equal(restored.body.data.suspension_reason, null);
  assert.equal((await login(target.email, PASSWORD)).status, 200, 'the user can sign in again');
  assert.equal((await adminApi.post(`/api/admin/users/${target._id}/restore`)).status, 409, 'only a suspended account can be restored');
});

test('REQ-94 an administrator cannot suspend themselves, another administrator or an unknown user', async () => {
  const other = await createAdminUser('otheradmin');
  assert.equal((await adminApi.post(`/api/admin/users/${admin._id}/suspend`, { reason: 'x' })).status, 400);
  assert.equal((await adminApi.post(`/api/admin/users/${other._id}/suspend`, { reason: 'x' })).status, 403);
  assert.equal((await adminApi.post('/api/admin/users/64b000000000000000000000/suspend', { reason: 'x' })).status, 404);
  assert.equal((await adminApi.post('/api/admin/users/not-an-id/suspend', { reason: 'x' })).status, 404);
  assert.equal((await User.findById(other._id)).status, 'active');
});

test('REQ-96 suspension and restoration are audited with admin, target, IP and time', async () => {
  const target = await createRealUser('audited');
  await adminApi.post(`/api/admin/users/${target._id}/suspend`, { reason: 'test' });
  await adminApi.post(`/api/admin/users/${target._id}/restore`);

  const entries = await AuditLog.find({ target_user_id: target._id }).sort({ timestamp: 1 }).lean();
  assert.deepEqual(entries.map((e) => e.action), ['admin.user_suspended', 'admin.user_restored']);
  for (const entry of entries) {
    assert.equal(String(entry.user_id), String(admin._id));
    assert.equal(entry.actor_role, 'admin');
    assert.equal(entry.category, 'admin');
    assert.ok(entry.ip_address);
    assert.ok(entry.timestamp);
  }
});

test('REQ-96 an admin action that cannot be audited does not happen (fail closed)', async () => {
  const target = await createRealUser('failclosed');
  const original = AuditLog.create;
  const quiet = console.error;
  AuditLog.create = async () => { throw new Error('audit store down'); };
  console.error = () => {};
  let res;
  try {
    res = await adminApi.post(`/api/admin/users/${target._id}/suspend`, { reason: 'x' });
  } finally {
    AuditLog.create = original;
    console.error = quiet;
  }
  assert.equal(res.status, 503);
  assert.equal((await User.findById(target._id)).status, 'active', 'the account was not suspended');
});

test('REQ-96 an ordinary event survives an audit outage, and the failure is reported, not silent', async () => {
  const { auditFailureCount } = await import('../src/services/auditService.js');
  const before = auditFailureCount();
  const original = AuditLog.insertMany;
  const logged = [];
  const quiet = console.error;
  AuditLog.insertMany = async () => { throw new Error('audit store down'); };
  console.error = (...args) => logged.push(args.join(' '));
  let res;
  try {
    res = await bearer(apiUrl(), null).post('/api/auth/login', { email: 'nobody@example.test', password: 'Whatever1!' });
  } finally {
    AuditLog.insertMany = original;
    console.error = quiet;
  }
  assert.equal(res.status, 401, 'sign-in behaves normally');
  assert.ok(auditFailureCount() > before);
  assert.ok(logged.some((l) => l.includes('[audit:FAILED]') && l.includes('auth.login_failed')));
  assert.ok(!logged.join('\n').includes('Whatever1!'), 'the password is not in the fallback log');
});

// ---------------------------------------------------------------------------
// REQ-96 - what is recorded
// ---------------------------------------------------------------------------

test('REQ-96 sign-in success and failure are audited without the password or token', async () => {
  const user = await createRealUser('logger');
  const anon = bearer(apiUrl(), null);

  const bad = await anon.post('/api/auth/login', { email: user.email, password: 'Not-The-Password1!' });
  assert.equal(bad.status, 401);
  const good = await anon.post('/api/auth/login', { email: user.email, password: PASSWORD });
  assert.equal(good.status, 200);
  const jwt = good.body.token;

  const entries = await AuditLog.find({ user_id: user._id }).sort({ timestamp: 1 }).lean();
  const names = entries.map((e) => e.action);
  assert.ok(names.includes('auth.login_failed'));
  assert.ok(names.includes('auth.login'));

  const failed = entries.find((e) => e.action === 'auth.login_failed');
  assert.equal(failed.outcome, 'failure');
  assert.equal(failed.metadata.reason, 'wrong_password');
  assert.ok(failed.ip_address);

  const dump = JSON.stringify(await AuditLog.find({}).lean());
  for (const secret of [PASSWORD, 'Not-The-Password1!', jwt, user.email]) {
    assert.ok(!dump.includes(secret), 'a secret or address reached the audit trail');
  }
  assert.ok(!dump.includes(good.body.token.split('.')[1]), 'no part of the token is stored');
});

test('REQ-96 rejected tokens are audited as authorization failures, without the token', async () => {
  const bogus = signToken({ jti: 'x' }, { subject: String(person._id), expiresIn: 60 }, 'z'.repeat(40));
  assert.equal((await bearer(apiUrl(), bogus).get('/api/accounts')).status, 401);
  const entry = await AuditLog.findOne({ action: 'auth.request_rejected', 'metadata.reason': 'token_invalid' }).lean();
  assert.ok(entry);
  assert.equal(entry.category, 'authz');
  assert.ok(!JSON.stringify(entry).includes(bogus.split('.')[2]));
});

test('REQ-96 exports are audited', async () => {
  const owner = await createRealUser('exporter');
  const api = bearer(apiUrl(), (await signIn(owner)).token);
  assert.equal((await api.get('/api/data/export.json')).status, 200);
  assert.equal((await api.get('/api/data/transactions.csv')).status, 200);
  const found = await AuditLog.find({ user_id: owner._id, category: 'export' }).lean();
  assert.ok(found.length >= 2);
  assert.ok(found.every((e) => e.ip_address && e.timestamp));
});

test('REQ-96 transaction edits audit which fields changed, never the amount or note', async () => {
  const owner = await createUser('editor');
  const account = await createAccount(owner);
  const category = await createCategory(owner);
  const tx = await record(owner, { type: 'expense', amount: '123.00', account_id: String(account._id), category_id: String(category._id), note: 'private thing' });
  await apiAs(owner).patch(`/api/transactions/${tx.id}`, { amount: '456.00', note: 'another private thing' });
  const dump = JSON.stringify(await AuditLog.find({ user_id: owner._id }).lean());
  for (const leaked of ['123.00', '456.00', 'private thing']) assert.ok(!dump.includes(leaked), leaked);
  assert.ok(dump.includes('changed_fields'));
});

test('REQ-96 the purge of expired recycle-bin records is audited as a bulk deletion', async () => {
  const owner = await createUser('purger');
  const account = await createAccount(owner);
  const category = await createCategory(owner);
  const tx = await record(owner, { type: 'expense', amount: '10', account_id: String(account._id), category_id: String(category._id) });
  await apiAs(owner).delete(`/api/transactions/${tx.id}`);

  const Transaction = (await import('../src/models/Transaction.js')).default;
  await Transaction.updateOne({ _id: tx.id }, { $set: { deleted_at: new Date(Date.now() - 40 * 24 * 3600 * 1000) } });
  const { purgeExpired } = await import('../src/services/recycleBinService.js');
  assert.equal((await purgeExpired()).transactions, 1);

  const batch = await AuditLog.findOne({ action: 'purge.batch' }).lean();
  assert.equal(batch.category, 'bulk_delete');
  assert.equal(batch.metadata.transactions, 1);
});

// ---------------------------------------------------------------------------
// REQ-96 - the trail is private, append-only and has a 12-month retention
// ---------------------------------------------------------------------------

test('REQ-96 an ordinary user has no way to read the audit trail', async () => {
  assert.equal((await personApi.get('/api/admin/audit-logs')).status, 403);
  for (const path of ['/api/audit', '/api/audit-logs', '/api/auditlogs', '/api/privacy/audit']) {
    assert.ok([401, 404].includes((await personApi.get(path)).status), path);
  }
});

test('REQ-96 an administrator can filter and page the trail', async () => {
  const res = await adminApi.get('/api/admin/audit-logs?category=admin&limit=2');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length <= 2 && res.body.data.length >= 1);
  assert.ok(res.body.data.every((e) => e.category === 'admin' && e.timestamp && 'ip_address' in e));
  assert.equal((await adminApi.get('/api/admin/audit-logs?category=nope')).status, 400);
  assert.equal((await adminApi.get('/api/admin/audit-logs?from=notadate')).status, 400);
  const future = await adminApi.get(`/api/admin/audit-logs?from=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`);
  assert.equal(future.body.total, 0);
});

test('REQ-96 audit records cannot be changed or deleted through the application', async () => {
  const entry = await AuditLog.create({ action: 'test.event' });
  await assert.rejects(AuditLog.updateOne({ _id: entry._id }, { action: 'edited' }), /append-only/);
  await assert.rejects(AuditLog.deleteOne({ _id: entry._id }), /append-only/);
  await assert.rejects(AuditLog.deleteMany({}), /append-only/);
  await assert.rejects(AuditLog.findOneAndUpdate({ _id: entry._id }, { action: 'x' }), /append-only/);
  const loaded = await AuditLog.findById(entry._id);
  loaded.action = 'edited';
  await assert.rejects(loaded.save(), /append-only/);
  await assert.rejects(loaded.deleteOne(), /append-only/);
  assert.equal((await AuditLog.findById(entry._id)).action, 'test.event');
});

test('REQ-96 every record expires no sooner than 12 months, and MongoDB removes it itself (TTL index)', async () => {
  const entry = await AuditLog.create({ action: 'test.retention' });
  const days = (entry.expires_at.getTime() - entry.timestamp.getTime()) / 86_400_000;
  assert.ok(days >= 365, `retained for ${days} days`);

  const ttl = (await AuditLog.collection.indexes()).find((i) => i.key.expires_at === 1);
  assert.ok(ttl, 'a TTL index exists');
  assert.equal(ttl.expireAfterSeconds, 0);
});

test('REQ-96 each record carries actor, action, timestamp and source IP', async () => {
  const owner = await createRealUser('fields');
  await bearer(apiUrl(), null).post('/api/auth/login', { email: owner.email, password: PASSWORD });
  const entry = await AuditLog.findOne({ user_id: owner._id, action: 'auth.login' }).lean();
  assert.equal(String(entry.user_id), String(owner._id));
  assert.equal(entry.action, 'auth.login');
  assert.ok(entry.timestamp instanceof Date);
  assert.match(entry.ip_address, /127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/);
});

test('REQ-96 a forged X-Forwarded-For header does not change the recorded source IP', async () => {
  const owner = await createRealUser('xff');
  await bearer(apiUrl(), null, { 'X-Forwarded-For': '6.6.6.6' }).post('/api/auth/login', { email: owner.email, password: PASSWORD });
  const entry = await AuditLog.findOne({ user_id: owner._id, action: 'auth.login' }).lean();
  assert.ok(!entry.ip_address.includes('6.6.6.6'));
});
