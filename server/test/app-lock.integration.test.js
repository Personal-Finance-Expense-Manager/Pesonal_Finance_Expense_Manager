import { assertIsolatedTestDatabase } from './helpers/testIsolation.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { createSoftAuthenticator, FLAG_UP } from './helpers/softAuthenticator.js';

/**
 * US-05 (#17), REQ-11 / SEC-8 / HI-2 - the app lock through the real API.
 *
 * Drives the real Express app against a real MongoDB with real sign-in
 * tokens (not the X-User-Id header: the lock belongs to the session). Run with
 *
 *   npm run test:integration:isolated
 *
 * Only the unique database allocated by the isolated runner may be reset.
 */

process.env.NODE_ENV = 'test';
process.env.DEV_AUTH_HEADER = 'true'; // prove the lock routes ignore it
process.env.JWT_SECRET ||= crypto.randomBytes(32).toString('hex');
process.env.WEBAUTHN_ORIGIN = 'http://localhost:5173';
process.env.WEBAUTHN_RP_ID = 'localhost';

const uri = process.env.TEST_MONGO_URI;

if (!uri) {
  throw new Error(
    'TEST_MONGO_URI is not set. Example: npm run test:integration:isolated'
  );
}

const dbName = assertIsolatedTestDatabase(uri, process.env.PFEM_TEST_RUN_ID);

if (!/test/i.test(dbName)) {
  throw new Error(`Refusing to run: database "${dbName}" does not look like a test database.`);
}

const { default: app } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
const { default: Session } = await import('../src/models/Session.js');
const { default: AuditLog } = await import('../src/models/AuditLog.js');

const PIN = '4826'; // Test Plan UT_64 test data
const OTHER_PIN = '7391';
const PASSWORD = 'Str0ng!Passw0rd';
const RP = { rpId: 'localhost', origin: 'http://localhost:5173' };

let server;
let base;
let counter = 0;
const everyResponse = []; // every body the API sent, scanned for secrets at the end
const loggedLines = []; // everything the server wrote to the console
const realConsole = { log: console.log, error: console.error, warn: console.warn };

before(async () => {
  for (const level of ['log', 'error', 'warn']) {
    console[level] = (...args) => loggedLines.push(args.map(String).join(' '));
  }

  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(console, realConsole);
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function http(token) {
  async function call(method, path, body, headers = {}) {
    const all = { 'Content-Type': 'application/json', ...headers };
    if (token) all.Authorization = `Bearer ${token}`;

    const response = await fetch(base + path, {
      method,
      headers: all,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    everyResponse.push(text);

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    return { status: response.status, body: json };
  }

  return {
    get: (path, headers) => call('GET', path, undefined, headers),
    post: (path, body, headers) => call('POST', path, body ?? {}, headers),
    del: (path) => call('DELETE', path),
  };
}

async function makeUser(label = 'lock') {
  counter += 1;

  return User.create({
    name: `${label} ${counter}`,
    email: `${label}${counter}@example.test`,
    password_hash: await bcrypt.hash(PASSWORD, 4),
    email_verified: true,
    status: 'active',
  });
}

/** Sign in through the real endpoint; returns { token, api }. */
async function signIn(user, password = PASSWORD) {
  const res = await http().post('/api/auth/login', { email: user.email, password });
  assert.equal(res.status, 200, `sign-in failed: ${JSON.stringify(res.body)}`);

  return { token: res.body.token, api: http(res.body.token) };
}

/** A user with the lock already on, and one unlocked session. */
async function lockedUpUser(label) {
  const user = await makeUser(label);
  const session = await signIn(user);
  const enabled = await session.api.post('/api/app-lock/pin', { pin: PIN, confirmPin: PIN });
  assert.equal(enabled.status, 201, JSON.stringify(enabled.body));

  return { user, ...session };
}

const sessionDoc = (token) => Session.findOne({ jti: jwt.decode(token).jti });
const userDoc = (user) =>
  User.findById(user._id).select('+app_lock_pin_hash +app_lock_credentials +password_hash');

async function lock(api) {
  const res = await api.post('/api/app-lock/lock');
  assert.equal(res.status, 200);
}

async function unlock(api, pin = PIN) {
  return api.post('/api/app-lock/unlock', { method: 'pin', pin });
}

const auditActions = async (user) =>
  (await AuditLog.find({ user_id: user._id, entity_type: 'app_lock' }).sort({ _id: 1 }).lean()).map(
    (entry) => entry.action
  );

const PROTECTED_ROUTES = [
  '/api/accounts',
  '/api/accounts/summary',
  '/api/transactions',
  '/api/categories',
  '/api/budgets',
  '/api/reports/dashboard',
  '/api/data/export.json',
];

async function assertAllRoutesLocked(api) {
  for (const path of PROTECTED_ROUTES) {
    const res = await api.get(path);
    assert.equal(res.status, 423, `${path} should be locked, got ${res.status}`);
    assert.equal(res.body.code, 'APP_LOCKED');
  }
}

async function assertAccountsOpen(api) {
  const res = await api.get('/api/accounts');
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

// ---------------------------------------------------------------------------
// authentication and authorization
// ---------------------------------------------------------------------------

describe('every app-lock route needs a real signed-in session', () => {
  const routes = [
    ['get', '/api/app-lock/status'],
    ['post', '/api/app-lock/heartbeat'],
    ['post', '/api/app-lock/lock'],
    ['post', '/api/app-lock/unlock'],
    ['post', '/api/app-lock/pin'],
    ['post', '/api/app-lock/pin/change'],
    ['post', '/api/app-lock/pin/reset'],
    ['post', '/api/app-lock/disable'],
    ['post', '/api/app-lock/biometric/register/options'],
    ['post', '/api/app-lock/biometric/register/verify'],
    ['post', '/api/app-lock/biometric/options'],
    ['del', '/api/app-lock/biometric'],
  ];

  test('no token: 401 everywhere', async () => {
    for (const [method, path] of routes) {
      const res = await http()[method](path, method === 'post' ? { pin: PIN } : undefined);
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  });

  test('the development X-User-Id header does not authenticate the lock routes', async () => {
    const user = await makeUser();

    for (const [method, path] of routes) {
      const res = await http()[method](path, method === 'post' ? { pin: PIN } : undefined, {
        'X-User-Id': user._id.toString(),
      });
      assert.equal(res.status, 401, `${method} ${path}`);
    }

    assert.equal((await userDoc(user)).app_lock_enabled, false);
  });

  test('a forged token is refused', async () => {
    const user = await makeUser();
    const forged = jwt.sign({ jti: 'x' }, 'f'.repeat(40), { subject: user._id.toString(), algorithm: 'HS256' });

    assert.equal((await http(forged).get('/api/app-lock/status')).status, 401);
  });

  test('a signed-out (revoked) session is refused', async () => {
    const user = await makeUser();
    const { api } = await signIn(user);

    assert.equal((await api.post('/api/auth/logout')).status, 200);
    assert.equal((await api.get('/api/app-lock/status')).status, 401);
    assert.equal((await api.post('/api/app-lock/pin', { pin: PIN })).status, 401);
  });

  test('users without the lock are unaffected: a token still reaches the data routes (regression)', async () => {
    const user = await makeUser();
    const { api } = await signIn(user);

    for (const path of PROTECTED_ROUTES) {
      const res = await api.get(path);
      assert.notEqual(res.status, 423, path);
      assert.notEqual(res.status, 401, path);
    }
  });

  test('the sign-in response keeps its shape and carries no lock secrets (regression)', async () => {
    const user = await makeUser();
    const res = await http().post('/api/auth/login', { email: user.email, password: PASSWORD });

    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['expiresAt', 'message', 'token', 'user']);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['email', 'id', 'name']);
  });
});

// ---------------------------------------------------------------------------
// turning the lock on - REQ-11: optional, four-digit PIN
// ---------------------------------------------------------------------------

describe('turning the app lock on (REQ-11)', () => {
  let user;
  let api;
  let token;

  before(async () => {
    user = await makeUser();
    ({ api, token } = await signIn(user));
  });

  test('is optional: a new account has the lock off', async () => {
    const res = await api.get('/api/app-lock/status');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      enabled: false,
      locked: false,
      biometricDevices: 0,
      idleLockSeconds: 120,
      unlockedUntil: null,
    });
  });

  test('rejects a PIN that is not exactly four digits', async () => {
    const bad = ['', '1', '482', '48261', 'abcd', '48 26', '48a6', 4826, null, ['4826'], { a: 1 }];

    for (const pin of bad) {
      const res = await api.post('/api/app-lock/pin', { pin });
      assert.equal(res.status, 400, JSON.stringify(pin));
      assert.equal(res.body.code, 'INVALID_PIN_FORMAT');
    }

    assert.equal((await api.post('/api/app-lock/pin', {})).status, 400);
    assert.equal((await userDoc(user)).app_lock_enabled, false);
  });

  test('rejects a confirmation that does not match', async () => {
    const res = await api.post('/api/app-lock/pin', { pin: PIN, confirmPin: OTHER_PIN });

    assert.equal(res.status, 400);
    assert.equal((await userDoc(user)).app_lock_enabled, false);
  });

  test('turns the lock on with a valid PIN, leaving this session unlocked for two minutes', async () => {
    const before = Date.now();
    const res = await api.post('/api/app-lock/pin', { pin: PIN, confirmPin: PIN });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.locked, false);

    const remaining = new Date(res.body.unlockedUntil).getTime() - Date.now();
    assert.ok(remaining > 115_000 && remaining <= 121_000, `unlock window was ${remaining} ms`);
    await assertAccountsOpen(api);
  });

  test('stores a bcrypt hash, never the PIN, and nothing in the response reveals it', async () => {
    const doc = await userDoc(user);

    assert.equal(doc.app_lock_enabled, true);
    assert.match(doc.app_lock_pin_hash, /^\$2[aby]\$12\$/);
    assert.equal(doc.app_lock_pin_hash.includes(PIN), false);
    assert.equal(doc.app_lock_failed_attempts, 0);

    // The user object is not selectable with the secret by default.
    const plain = await User.findById(user._id).lean();
    assert.equal('app_lock_pin_hash' in plain, false);
    assert.equal('app_lock_credentials' in plain, false);
  });

  test('refuses to turn it on twice, and the first PIN stays', async () => {
    const res = await api.post('/api/app-lock/pin', { pin: OTHER_PIN });

    assert.equal(res.status, 409);

    await lock(api);
    assert.equal((await unlock(api, OTHER_PIN)).status, 401);
    assert.equal((await unlock(api, PIN)).status, 200);
  });

  test('turning it on locks the user\'s other signed-in devices', async () => {
    const other = await makeUser();
    const phone = await signIn(other);
    const laptop = await signIn(other);

    await assertAccountsOpen(phone.api);
    await assertAccountsOpen(laptop.api);

    assert.equal((await phone.api.post('/api/app-lock/pin', { pin: PIN })).status, 201);

    await assertAccountsOpen(phone.api);
    assert.equal((await laptop.api.get('/api/accounts')).status, 423);
    assert.equal((await unlock(laptop.api)).status, 200);
    await assertAccountsOpen(laptop.api);
  });

  test('the lock belongs to one user: another user is not locked by it', async () => {
    const bystander = await makeUser();
    const session = await signIn(bystander);

    await assertAccountsOpen(session.api);
    assert.equal((await session.api.get('/api/app-lock/status')).body.enabled, false);
    assert.ok(token); // the first user's token is separate
  });
});

// ---------------------------------------------------------------------------
// locking and unlocking - the server enforces it, not the screen
// ---------------------------------------------------------------------------

describe('locking and unlocking (server-enforced)', () => {
  let user;
  let api;

  before(async () => {
    ({ user, api } = await lockedUpUser());
  });

  test('"lock now" locks the session', async () => {
    const res = await api.post('/api/app-lock/lock');

    assert.equal(res.status, 200);
    assert.equal(res.body.locked, true);
    assert.equal(res.body.unlockedUntil, null);
  });

  test('a locked session cannot reach ANY data route, whatever the client does', async () => {
    await assertAllRoutesLocked(api);

    const write = await api.post('/api/accounts', { name: 'Sneaky', type: 'cash', opening_balance: '1.00' });
    assert.equal(write.status, 423);
  });

  test('a locked session can still ask its status, unlock, and sign out', async () => {
    const status = await api.get('/api/app-lock/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.locked, true);
    assert.equal((await api.post('/api/app-lock/heartbeat')).body.locked, true);
    assert.equal((await api.post('/api/app-lock/biometric/options')).status, 409); // reachable; none enrolled
  });

  test('a locked session cannot change or remove the lock', async () => {
    const attempts = [
      ['/api/app-lock/pin', { pin: OTHER_PIN }],
      ['/api/app-lock/pin/change', { currentPin: PIN, newPin: OTHER_PIN }],
      ['/api/app-lock/disable', { pin: PIN }],
      ['/api/app-lock/biometric/register/options', { pin: PIN }],
      ['/api/app-lock/biometric/register/verify', {}],
    ];

    for (const [path, body] of attempts) {
      assert.equal((await api.post(path, body)).status, 423, path);
    }

    assert.equal((await api.del('/api/app-lock/biometric')).status, 423);
    assert.equal((await userDoc(user)).app_lock_enabled, true);
  });

  test('a wrong PIN is refused, says how many tries are left, and stays locked', async () => {
    const first = await unlock(api, '0000');
    const second = await unlock(api, '1111');

    assert.equal(first.status, 401);
    assert.equal(first.body.attemptsRemaining, 4);
    assert.equal(second.body.attemptsRemaining, 3);
    assert.equal((await api.get('/api/accounts')).status, 423);
  });

  test('the right PIN unlocks, and the count of wrong PINs starts again', async () => {
    const ok = await unlock(api, PIN);

    assert.equal(ok.status, 200);
    assert.equal(ok.body.locked, false);
    await assertAccountsOpen(api);
    assert.equal((await userDoc(user)).app_lock_failed_attempts, 0);

    await lock(api);
    assert.equal((await unlock(api, '0000')).body.attemptsRemaining, 4);
    assert.equal((await unlock(api, PIN)).status, 200);
  });

  test('a malformed PIN is a 400 and does not use up an attempt', async () => {
    await lock(api);

    for (const pin of ['12', 'abcd', 4826, null, undefined, '48261']) {
      const res = await api.post('/api/app-lock/unlock', { method: 'pin', pin });
      assert.equal(res.status, 400, JSON.stringify(pin));
    }

    assert.equal((await userDoc(user)).app_lock_failed_attempts, 0);
    assert.equal((await api.post('/api/app-lock/unlock', { method: 'magic' })).status, 400);
    assert.equal((await api.post('/api/app-lock/unlock', {})).status, 400);
    assert.equal((await unlock(api)).status, 200);
  });

  test('a locked session of one user cannot be unlocked by another user\'s PIN', async () => {
    const stranger = await lockedUpUser('stranger');
    await lock(api);

    // The stranger's PIN is also 4826; what matters is that unlocking works only
    // for the caller\'s own session and own record.
    assert.equal((await unlock(api, OTHER_PIN)).status, 401);
    assert.equal((await api.get('/api/accounts')).status, 423);
    await assertAccountsOpen(stranger.api);
    assert.equal((await unlock(api)).status, 200);
  });

  test('locking when the lock is off is a conflict, not a silent no-op', async () => {
    const plain = await signIn(await makeUser());

    assert.equal((await plain.api.post('/api/app-lock/lock')).status, 409);
    assert.equal((await plain.api.post('/api/app-lock/unlock', { method: 'pin', pin: PIN })).status, 409);
  });
});

// ---------------------------------------------------------------------------
// two minutes in the background - REQ-11, SEC-8, UT_64
// ---------------------------------------------------------------------------

describe('re-locks after two minutes in the background (REQ-11, UT_64)', () => {
  let user;
  let api;
  let token;

  before(async () => {
    ({ user, api, token } = await lockedUpUser());
  });

  test('after unlocking, the session is open for two minutes', async () => {
    await lock(api);
    const before = Date.now();
    await unlock(api);

    const doc = await sessionDoc(token);
    const remaining = doc.app_unlocked_until.getTime() - Date.now();

    assert.ok(remaining > 115_000 && remaining <= 121_000, `window was ${remaining} ms`);
  });

  test('two minutes with no heartbeat later the server locks it by itself', async () => {
    // Two minutes pass with the app in the background: nothing was sent.
    await Session.updateOne({ jti: jwt.decode(token).jti }, { $set: { app_unlocked_until: new Date(Date.now() - 1) } });

    await assertAllRoutesLocked(api);
    assert.equal((await api.get('/api/app-lock/status')).body.locked, true);
  });

  test('returning to the app then requires the PIN, and the PIN brings it back', async () => {
    assert.equal((await unlock(api, '0000')).status, 401);
    assert.equal((await api.get('/api/accounts')).status, 423);
    assert.equal((await unlock(api, PIN)).status, 200);
    await assertAccountsOpen(api);
  });

  test('a heartbeat while the app is on screen keeps it open', async () => {
    await Session.updateOne({ jti: jwt.decode(token).jti }, { $set: { app_unlocked_until: new Date(Date.now() + 10_000) } });

    const before = Date.now();
    const res = await api.post('/api/app-lock/heartbeat');
    const doc = await sessionDoc(token);

    assert.equal(res.status, 200);
    assert.equal(res.body.locked, false);
    assert.ok(doc.app_unlocked_until.getTime() - before > 115_000);
  });

  test('a heartbeat can never reopen a session that has already locked', async () => {
    const expired = new Date(Date.now() - 5_000);
    await Session.updateOne({ jti: jwt.decode(token).jti }, { $set: { app_unlocked_until: expired } });

    const res = await api.post('/api/app-lock/heartbeat');
    const doc = await sessionDoc(token);

    assert.equal(res.body.locked, true);
    assert.equal(doc.app_unlocked_until.getTime(), expired.getTime());
    assert.equal((await api.get('/api/accounts')).status, 423);

    await lock(api);
    assert.equal((await api.post('/api/app-lock/heartbeat')).body.locked, true);
    assert.equal((await sessionDoc(token)).app_unlocked_until, null);

    assert.equal((await unlock(api)).status, 200);
  });

  test('with the lock off, a heartbeat is harmless', async () => {
    const plain = await signIn(await makeUser());
    const res = await plain.api.post('/api/app-lock/heartbeat');

    assert.equal(res.status, 200);
    assert.deepEqual([res.body.enabled, res.body.locked], [false, false]);
  });

  test('signing in with the password starts an unlocked session; the PIN is asked later', async () => {
    const again = await signIn(user);

    await assertAccountsOpen(again.api);

    const doc = await sessionDoc(again.token);
    assert.ok(doc.app_unlocked_until.getTime() - Date.now() > 100_000);

    // ...and two minutes of silence locks that one too.
    await Session.updateOne({ jti: jwt.decode(again.token).jti }, { $set: { app_unlocked_until: new Date(Date.now() - 1) } });
    assert.equal((await again.api.get('/api/accounts')).status, 423);
  });

  test('a locked session can sign out, and the token is dead afterwards', async () => {
    const session = await signIn(user);
    await lock(session.api);

    assert.equal((await session.api.get('/api/accounts')).status, 423);
    assert.equal((await session.api.post('/api/auth/logout')).status, 200);
    assert.equal((await session.api.get('/api/app-lock/status')).status, 401);
  });
});

// ---------------------------------------------------------------------------
// protection against repeated wrong PINs
// ---------------------------------------------------------------------------

describe('repeated wrong PINs are stopped', () => {
  test('five wrong PINs in a row sign the user out everywhere', async () => {
    const { user, api, token } = await lockedUpUser();
    const second = await signIn(user); // another device, also signed in
    await lock(api);

    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await unlock(api, '0000'));

    assert.deepEqual(results.map((r) => r.status), [401, 401, 401, 401, 429]);
    assert.deepEqual(results.slice(0, 4).map((r) => r.body.attemptsRemaining), [4, 3, 2, 1]);
    assert.equal(results[4].body.signedOut, true);

    // Both devices lost their sessions: nothing works without the password now.
    assert.equal((await api.get('/api/accounts')).status, 401);
    assert.equal((await unlock(api, PIN)).status, 401);
    assert.equal((await second.api.get('/api/accounts')).status, 401);
    assert.ok((await sessionDoc(token)).revoked_at);

    const actions = await auditActions(user);
    assert.equal(actions.filter((a) => a === 'pin_attempt_failed').length, 5);
    assert.ok(actions.includes('pin_attempts_exceeded'));
  });

  test('the password gets the user back in, and clears the count', async () => {
    const { user, api } = await lockedUpUser();
    await lock(api);
    for (let i = 0; i < 5; i += 1) await unlock(api, '0000');

    assert.ok((await userDoc(user)).app_lock_failed_attempts >= 5);

    const again = await signIn(user);
    assert.equal((await userDoc(user)).app_lock_failed_attempts, 0);

    await lock(again.api);
    const res = await unlock(again.api, '0000');
    assert.equal(res.body.attemptsRemaining, 4);
    assert.equal((await unlock(again.api, PIN)).status, 200);
  });

  test('a burst of parallel guesses gets at most five tries', async () => {
    const { user, api } = await lockedUpUser();
    await lock(api);

    const guesses = Array.from({ length: 12 }, (_, i) => String(1000 + i * 111).padStart(4, '0'));
    const responses = await Promise.all(guesses.map((pin) => unlock(api, pin)));

    assert.equal(responses.filter((r) => r.status === 200).length, 0);

    const compared = (await auditActions(user)).filter((a) => a === 'pin_attempt_failed').length;
    assert.ok(compared <= 5, `${compared} PINs were compared`);
    assert.ok((await userDoc(user)).app_lock_failed_attempts >= 5);
  });

  test('even the CORRECT PIN is not compared once the limit is reached', async () => {
    const { user, api } = await lockedUpUser();
    await lock(api);

    // Reach the limit without the sign-out being observed by this client.
    await User.updateOne({ _id: user._id }, { $set: { app_lock_failed_attempts: 5 } });

    const res = await unlock(api, PIN);

    assert.equal(res.status, 429);
    assert.equal((await api.get('/api/accounts')).status, 401);
  });

  test('wrong PINs while changing or turning off the lock count toward the same limit', async () => {
    const { user, api } = await lockedUpUser();

    for (let i = 0; i < 4; i += 1) {
      const res = await api.post('/api/app-lock/disable', { pin: '0000' });
      assert.equal(res.status, 401);
    }

    const last = await api.post('/api/app-lock/disable', { pin: '0000' });
    assert.equal(last.status, 429);

    assert.equal((await userDoc(user)).app_lock_enabled, true);
    assert.equal((await api.get('/api/accounts')).status, 401);
  });

  test('a successful PIN in between resets the run (consecutive failures only)', async () => {
    const { api } = await lockedUpUser();
    await lock(api);

    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 4; i += 1) assert.equal((await unlock(api, '0000')).status, 401);
      assert.equal((await unlock(api, PIN)).status, 200);
      await lock(api);
    }

    assert.equal((await unlock(api, PIN)).status, 200);
  });
});

// ---------------------------------------------------------------------------
// change, forgot, turn off
// ---------------------------------------------------------------------------

describe('changing, forgetting and turning off the PIN', () => {
  test('changes the PIN: the old one stops working and the new one works', async () => {
    const { user, api } = await lockedUpUser();
    const hashBefore = (await userDoc(user)).app_lock_pin_hash;

    assert.equal((await api.post('/api/app-lock/pin/change', { currentPin: '0000', newPin: OTHER_PIN })).status, 401);
    assert.equal((await api.post('/api/app-lock/pin/change', { currentPin: PIN, newPin: '12' })).status, 400);
    assert.equal((await api.post('/api/app-lock/pin/change', { currentPin: PIN, newPin: 'abcd' })).status, 400);

    const ok = await api.post('/api/app-lock/pin/change', { currentPin: PIN, newPin: OTHER_PIN });
    assert.equal(ok.status, 200);

    const hashAfter = (await userDoc(user)).app_lock_pin_hash;
    assert.notEqual(hashAfter, hashBefore);
    assert.equal(hashAfter.includes(OTHER_PIN), false);

    await lock(api);
    assert.equal((await unlock(api, PIN)).status, 401);
    assert.equal((await unlock(api, OTHER_PIN)).status, 200);
  });

  test('a malformed new PIN is refused before any attempt is used', async () => {
    const { user, api } = await lockedUpUser();

    await api.post('/api/app-lock/pin/change', { currentPin: PIN, newPin: '1' });
    assert.equal((await userDoc(user)).app_lock_failed_attempts, 0);
  });

  test('changing the PIN locks the other devices', async () => {
    const { user, api } = await lockedUpUser();
    const other = await signIn(user);
    await assertAccountsOpen(other.api);

    await api.post('/api/app-lock/pin/change', { currentPin: PIN, newPin: OTHER_PIN });

    assert.equal((await other.api.get('/api/accounts')).status, 423);
    await assertAccountsOpen(api);
  });

  test('"Forgot PIN": the password resets it while locked; a wrong password does not', async () => {
    const { user, api } = await lockedUpUser();
    await lock(api);

    const wrong = await api.post('/api/app-lock/pin/reset', { password: 'Wr0ng!Passw0rd', newPin: OTHER_PIN });
    assert.equal(wrong.status, 401);
    assert.equal((await api.get('/api/accounts')).status, 423);

    assert.equal((await api.post('/api/app-lock/pin/reset', { password: PASSWORD, newPin: '12' })).status, 400);
    assert.equal((await api.post('/api/app-lock/pin/reset', { newPin: OTHER_PIN })).status, 400);
    assert.equal((await api.post('/api/app-lock/pin/reset', { password: 5, newPin: OTHER_PIN })).status, 400);

    const ok = await api.post('/api/app-lock/pin/reset', { password: PASSWORD, newPin: OTHER_PIN });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.locked, false);
    assert.equal(JSON.stringify(ok.body).includes(PASSWORD), false);
    await assertAccountsOpen(api);

    await lock(api);
    assert.equal((await unlock(api, PIN)).status, 401);
    assert.equal((await unlock(api, OTHER_PIN)).status, 200);
    assert.ok((await auditActions(user)).includes('pin_reset'));
  });

  test('resetting by password also clears a run of wrong PINs', async () => {
    const { user, api } = await lockedUpUser();
    await lock(api);

    for (let i = 0; i < 3; i += 1) await unlock(api, '0000');
    assert.equal((await userDoc(user)).app_lock_failed_attempts, 3);

    await api.post('/api/app-lock/pin/reset', { password: PASSWORD, newPin: OTHER_PIN });
    assert.equal((await userDoc(user)).app_lock_failed_attempts, 0);
  });

  test('guessing the password through the reset shares the sign-in lockout (REQ-8)', async () => {
    const { user, api } = await lockedUpUser();
    await lock(api);

    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await api.post('/api/app-lock/pin/reset', { password: `Wr0ng!Passw0rd${i}`, newPin: OTHER_PIN })).status);
    }

    assert.deepEqual(statuses, [401, 401, 401, 401, 423]);

    // Locked out of the reset AND of signing in, even with the right password.
    assert.equal((await api.post('/api/app-lock/pin/reset', { password: PASSWORD, newPin: OTHER_PIN })).status, 423);
    const signInAttempt = await http().post('/api/auth/login', { email: user.email, password: PASSWORD });
    assert.equal(signInAttempt.status, 423);
  });

  test('turning it off needs the PIN, then removes every trace', async () => {
    const { user, api } = await lockedUpUser();

    assert.equal((await api.post('/api/app-lock/disable', { pin: '0000' })).status, 401);
    assert.equal((await api.post('/api/app-lock/disable', {})).status, 400);
    assert.equal((await userDoc(user)).app_lock_enabled, true);

    const ok = await api.post('/api/app-lock/disable', { pin: PIN });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.enabled, false);

    const doc = await userDoc(user);
    assert.equal(doc.app_lock_enabled, false);
    assert.equal(doc.app_lock_pin_hash, undefined);
    assert.equal(doc.app_lock_credentials.length, 0);

    // With the lock off the app is open, and lock actions explain themselves.
    await assertAccountsOpen(api);
    assert.equal((await api.post('/api/app-lock/lock')).status, 409);
    assert.equal((await api.post('/api/app-lock/disable', { pin: PIN })).status, 409);
  });

  test('can be turned on again afterwards with a different PIN', async () => {
    const { api } = await lockedUpUser();
    await api.post('/api/app-lock/disable', { pin: PIN });

    assert.equal((await api.post('/api/app-lock/pin', { pin: OTHER_PIN })).status, 201);
    await lock(api);
    assert.equal((await unlock(api, PIN)).status, 401);
    assert.equal((await unlock(api, OTHER_PIN)).status, 200);
  });

  test('a session that was locked is open again once the lock is turned off', async () => {
    const { user, api } = await lockedUpUser();
    const other = await signIn(user);

    await lock(other.api);
    assert.equal((await other.api.get('/api/accounts')).status, 423);

    await api.post('/api/app-lock/disable', { pin: PIN });
    await assertAccountsOpen(other.api);
  });
});

// ---------------------------------------------------------------------------
// device biometric (WebAuthn) - HI-2
// ---------------------------------------------------------------------------

describe('device biometric unlock (HI-2)', () => {
  const newDevice = (algorithm = 'ES256') => createSoftAuthenticator({ ...RP, algorithm });

  async function enrol(api, device = newDevice()) {
    const options = await api.post('/api/app-lock/biometric/register/options', { pin: PIN });
    assert.equal(options.status, 200, JSON.stringify(options.body));

    const res = await api.post('/api/app-lock/biometric/register/verify', {
      credential: device.register(options.body.options),
    });

    return { device, options: options.body.options, res };
  }

  async function biometricUnlock(api, device, tweaks) {
    const options = await api.post('/api/app-lock/biometric/options');
    assert.equal(options.status, 200, JSON.stringify(options.body));

    return api.post('/api/app-lock/unlock', {
      method: 'biometric',
      credential: device.assert(options.body.options, tweaks),
    });
  }

  test('there is no biometric until one is enrolled; PIN is the base lock', async () => {
    const plain = await signIn(await makeUser());

    // No lock at all: enrolling is impossible, which also means biometric alone cannot be the lock.
    assert.equal((await plain.api.post('/api/app-lock/biometric/register/options', { pin: PIN })).status, 409);

    const { api } = await lockedUpUser();
    assert.equal((await api.get('/api/app-lock/status')).body.biometricDevices, 0);
    assert.equal((await api.post('/api/app-lock/biometric/options')).status, 409);
  });

  test('enrolling needs the PIN, so a borrowed unlocked phone cannot add a fingerprint', async () => {
    const { api } = await lockedUpUser();

    assert.equal((await api.post('/api/app-lock/biometric/register/options', {})).status, 400);
    assert.equal((await api.post('/api/app-lock/biometric/register/options', { pin: '0000' })).status, 401);

    const ok = await api.post('/api/app-lock/biometric/register/options', { pin: PIN });
    assert.equal(ok.status, 200);

    const { options } = ok.body;
    assert.equal(options.rp.id, 'localhost');
    assert.equal(options.authenticatorSelection.authenticatorAttachment, 'platform');
    assert.equal(options.authenticatorSelection.userVerification, 'required');
    assert.equal(options.attestation, 'none');
    assert.ok(options.challenge.length >= 43);
  });

  test('enrols a device whose response genuinely verifies', async () => {
    const { user, api } = await lockedUpUser();
    const { device, res } = await enrol(api);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.biometricDevices, 1);

    const doc = await userDoc(user);
    assert.equal(doc.app_lock_credentials.length, 1);
    assert.equal(doc.app_lock_credentials[0].credential_id, device.id);
    // A public key, not a private one, and nothing biometric.
    const key = crypto.createPublicKey({ key: Buffer.from(doc.app_lock_credentials[0].public_key, 'base64'), format: 'der', type: 'spki' });
    assert.equal(key.type, 'public');

    // Nothing in any response exposes the key material.
    assert.equal(JSON.stringify(res.body).includes(doc.app_lock_credentials[0].public_key), false);
  });

  test('refuses enrolment with a wrong challenge, a replayed response, or garbage', async () => {
    const { user, api } = await lockedUpUser();
    const device = newDevice();

    const options = await api.post('/api/app-lock/biometric/register/options', { pin: PIN });
    const forged = device.register(options.body.options, { challenge: crypto.randomBytes(32).toString('base64url') });

    assert.equal((await api.post('/api/app-lock/biometric/register/verify', { credential: forged })).status, 400);

    // The challenge was spent by that attempt, so even a correct answer now fails.
    const late = device.register(options.body.options);
    assert.equal((await api.post('/api/app-lock/biometric/register/verify', { credential: late })).body.code, 'CHALLENGE_EXPIRED');

    // No challenge issued at all.
    assert.equal((await api.post('/api/app-lock/biometric/register/verify', { credential: late })).status, 400);

    // Garbage.
    const fresh = await api.post('/api/app-lock/biometric/register/options', { pin: PIN });
    assert.equal((await api.post('/api/app-lock/biometric/register/verify', { credential: { id: 'x' } })).status, 400);
    assert.equal((await api.post('/api/app-lock/biometric/register/verify', {})).status, 400);
    assert.ok(fresh.body.options);

    assert.equal((await userDoc(user)).app_lock_credentials.length, 0);
  });

  test('refuses enrolment when the person was not verified on the device', async () => {
    const { user, api } = await lockedUpUser();
    const device = newDevice();
    const options = await api.post('/api/app-lock/biometric/register/options', { pin: PIN });

    const res = await api.post('/api/app-lock/biometric/register/verify', {
      credential: device.register(options.body.options, { flags: FLAG_UP | 0x40 }),
    });

    assert.equal(res.status, 400);
    assert.equal((await userDoc(user)).app_lock_credentials.length, 0);
  });

  test('unlocks with a genuine signed assertion', async () => {
    const { user, api } = await lockedUpUser();
    const { device } = await enrol(api);

    await lock(api);
    assert.equal((await api.get('/api/accounts')).status, 423);

    const res = await biometricUnlock(api, device);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.locked, false);
    await assertAccountsOpen(api);
    assert.equal((await userDoc(user)).app_lock_credentials[0].sign_count, 1);
    assert.ok((await auditActions(user)).includes('unlocked_with_biometric'));
  });

  test('works for an RSA (Windows Hello style) key too', async () => {
    const { api } = await lockedUpUser();
    const { device, res } = await enrol(api, newDevice('RS256'));

    assert.equal(res.status, 201);
    await lock(api);
    assert.equal((await biometricUnlock(api, device)).status, 200);
  });

  test('a captured response cannot be replayed: each challenge works once', async () => {
    const { api } = await lockedUpUser();
    const { device } = await enrol(api);
    await lock(api);

    const options = await api.post('/api/app-lock/biometric/options');
    const assertion = device.assert(options.body.options);
    const body = { method: 'biometric', credential: assertion };

    assert.equal((await api.post('/api/app-lock/unlock', body)).status, 200);

    await lock(api);
    const replay = await api.post('/api/app-lock/unlock', body);

    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'BIOMETRIC_FAILED');
    assert.equal((await api.get('/api/accounts')).status, 423);
  });

  test('refuses an assertion nobody asked for (no challenge was issued)', async () => {
    const { api } = await lockedUpUser();
    const { device } = await enrol(api);
    await lock(api);

    const res = await api.post('/api/app-lock/unlock', {
      method: 'biometric',
      credential: device.assert({ challenge: crypto.randomBytes(32).toString('base64url') }),
    });

    assert.equal(res.status, 401);
    assert.equal((await api.get('/api/accounts')).status, 423);
  });

  test('refuses forged or wrongly-made assertions, and the session stays locked', async () => {
    const { user, api } = await lockedUpUser();
    const { device } = await enrol(api);
    const attacker = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

    const cases = {
      'signed by a different key': { privateKey: attacker.privateKey },
      'a tampered signature': { tamperSignature: true },
      'the wrong origin': { origin: 'https://evil.example' },
      'the wrong relying party': { rpId: 'evil.example' },
      'a different challenge': { challenge: crypto.randomBytes(32).toString('base64url') },
      'no user verification': { flags: FLAG_UP },
      'another credential id': { id: crypto.randomBytes(32).toString('base64url') },
    };

    for (const [name, tweaks] of Object.entries(cases)) {
      await lock(api);
      const res = await biometricUnlock(api, device, tweaks);

      assert.equal(res.status, 401, name);
      assert.equal((await api.get('/api/accounts')).status, 423, name);
    }

    // None of that used up PIN attempts - and none of it is invisible.
    assert.equal((await userDoc(user)).app_lock_failed_attempts, 0);
    assert.ok((await auditActions(user)).filter((a) => a === 'biometric_attempt_failed').length >= 6);

    // The genuine device still works afterwards.
    await lock(api);
    assert.equal((await biometricUnlock(api, device)).status, 200);
  });

  test('a challenge that has expired is refused', async () => {
    const { api, token } = await lockedUpUser();
    const { device } = await enrol(api);
    await lock(api);

    const options = await api.post('/api/app-lock/biometric/options');
    await Session.updateOne(
      { jti: jwt.decode(token).jti },
      { $set: { webauthn_challenge_expires_at: new Date(Date.now() - 1000) } }
    );

    const res = await api.post('/api/app-lock/unlock', {
      method: 'biometric',
      credential: device.assert(options.body.options),
    });

    assert.equal(res.status, 401);
  });

  test('a cloned authenticator (counter goes backwards) is refused', async () => {
    const { api } = await lockedUpUser();
    const { device } = await enrol(api);

    await lock(api);
    assert.equal((await biometricUnlock(api, device, { signCount: 10 })).status, 200);

    await lock(api);
    assert.equal((await biometricUnlock(api, device, { signCount: 10 })).status, 401);
    assert.equal((await biometricUnlock(api, device, { signCount: 3 })).status, 401);
    assert.equal((await biometricUnlock(api, device, { signCount: 11 })).status, 200);
  });

  test('another user\'s device cannot unlock this user, and vice versa', async () => {
    const alice = await lockedUpUser('alice');
    const bob = await lockedUpUser('bob');
    const aliceDevice = (await enrol(alice.api)).device;
    const bobDevice = (await enrol(bob.api)).device;

    await lock(alice.api);
    await lock(bob.api);

    // Alice's own device, answering Bob's challenge, and Bob's device answering Alice's.
    assert.equal((await biometricUnlock(alice.api, bobDevice)).status, 401);
    assert.equal((await biometricUnlock(bob.api, aliceDevice)).status, 401);
    assert.equal((await alice.api.get('/api/accounts')).status, 423);
    assert.equal((await bob.api.get('/api/accounts')).status, 423);

    assert.equal((await biometricUnlock(alice.api, aliceDevice)).status, 200);
    assert.equal((await biometricUnlock(bob.api, bobDevice)).status, 200);
  });

  test('the same device cannot be enrolled twice', async () => {
    const { user, api } = await lockedUpUser();
    const device = newDevice();

    assert.equal((await enrol(api, device)).res.status, 201);
    assert.equal((await enrol(api, device)).res.status, 409);
    assert.equal((await userDoc(user)).app_lock_credentials.length, 1);
  });

  test('at most five devices are enrolled', async () => {
    const { user, api } = await lockedUpUser();

    for (let i = 0; i < 5; i += 1) assert.equal((await enrol(api)).res.status, 201);

    const sixth = await api.post('/api/app-lock/biometric/register/options', { pin: PIN });
    assert.equal(sixth.status, 409);
    assert.equal((await userDoc(user)).app_lock_credentials.length, 5);
  });

  test('biometric can be turned off without touching the PIN', async () => {
    const { api } = await lockedUpUser();
    await enrol(api);

    const res = await api.del('/api/app-lock/biometric');
    assert.equal(res.status, 200);
    assert.equal(res.body.biometricDevices, 0);

    assert.equal((await api.post('/api/app-lock/biometric/options')).status, 409);
    await lock(api);
    assert.equal((await unlock(api)).status, 200);
  });

  test('turning the lock off forgets the enrolled devices', async () => {
    const { user, api } = await lockedUpUser();
    await enrol(api);

    await api.post('/api/app-lock/disable', { pin: PIN });
    assert.equal((await userDoc(user)).app_lock_credentials.length, 0);

    await api.post('/api/app-lock/pin', { pin: PIN });
    assert.equal((await api.get('/api/app-lock/status')).body.biometricDevices, 0);
  });

  test('the biometric options list only the caller\'s own credentials', async () => {
    const alice = await lockedUpUser('alice2');
    const bob = await lockedUpUser('bob2');
    const aliceDevice = (await enrol(alice.api)).device;
    await enrol(bob.api);

    await lock(bob.api);
    const options = await bob.api.post('/api/app-lock/biometric/options');

    assert.equal(options.body.options.allowCredentials.length, 1);
    assert.notEqual(options.body.options.allowCredentials[0].id, aliceDevice.id);
    assert.equal(options.body.options.userVerification, 'required');
  });
});

// ---------------------------------------------------------------------------
// secrets stay on the server
// ---------------------------------------------------------------------------

describe('secrets never leave the server', () => {
  test('the "all my data" JSON export carries no lock secrets', async () => {
    const { api } = await lockedUpUser();
    const device = createSoftAuthenticator(RP);
    const options = await api.post('/api/app-lock/biometric/register/options', { pin: PIN });
    await api.post('/api/app-lock/biometric/register/verify', { credential: device.register(options.body.options) });

    const res = await api.get('/api/data/export.json');
    const text = JSON.stringify(res.body);

    assert.equal(res.status, 200);
    for (const secret of ['app_lock_pin_hash', 'app_lock_credentials', 'app_lock_failed_attempts', 'public_key', 'credential_id', 'password_hash']) {
      assert.equal(text.includes(secret), false, secret);
    }
  });

  test('audit entries record that things happened, never the PIN', async () => {
    const { user, api } = await lockedUpUser();
    await api.post('/api/app-lock/pin/change', { currentPin: PIN, newPin: OTHER_PIN });
    await lock(api);
    await unlock(api, '0000');
    await unlock(api, OTHER_PIN);

    const entries = await AuditLog.find({ user_id: user._id, entity_type: 'app_lock' }).lean();

    assert.deepEqual(
      [...new Set(entries.map((e) => e.action))].sort(),
      ['enabled', 'pin_attempt_failed', 'pin_changed', 'unlocked_with_pin']
    );

    for (const entry of entries) {
      assert.equal(entry.old_value, null);
      assert.equal(entry.new_value, null);
      assert.equal(String(entry.entity_id), String(user._id));
    }
  });

  test('after all of the above, no response or log line ever contained a PIN, a hash or a key', () => {
    const responses = everyResponse.join('\n');

    assert.equal(/\$2[aby]\$\d\d\$/.test(responses), false, 'a bcrypt hash was sent to a client');
    assert.equal(responses.includes('app_lock_pin_hash'), false);
    assert.equal(responses.includes('public_key'), false);
    assert.equal(responses.includes('password_hash'), false);
    assert.equal(responses.includes(PASSWORD), false);
    assert.equal(/"pin"\s*:/.test(responses), false, 'a PIN was echoed back');

    const logs = loggedLines.join('\n');

    assert.equal(logs.includes(PASSWORD), false);
    assert.equal(/pin["']?\s*[:=]\s*["']?\d{4}/i.test(logs), false, 'a PIN reached the console');
    assert.equal(/\$2[aby]\$\d\d\$/.test(logs), false);
  });
});
