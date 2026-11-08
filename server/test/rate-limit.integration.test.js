// The limiter is off for the other suites (they send hundreds of requests a
// minute from one address). It is switched on here, before the app is loaded.
process.env.RATE_LIMIT_IN_TEST = 'true';
delete process.env.TRUST_PROXY;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, stopApi, apiUrl } from './helpers/integration.js';
import { PASSWORD, createRealUser } from './helpers/auth.js';
import AuditLog from '../src/models/AuditLog.js';

/** US-28 (#67) SEC-7: 100 requests/minute/IP globally; 10/minute/account on authentication endpoints. */

let user;
before(async () => {
  await startApi();
  user = await createRealUser('limited');
});
after(stopApi);

const post = (path, body, headers = {}) =>
  fetch(`${apiUrl()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('SEC-7 the 11th sign-in attempt in a minute for one account is answered 429 with Retry-After', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i += 1) statuses.push((await post('/api/auth/login', { email: user.email, password: 'Wrong-Password1!' })).status);

  // The first attempts are judged normally: wrong password (401), then the
  // existing five-failure account lockout (423) takes over. Neither is a 429.
  assert.deepEqual(statuses.slice(0, 4), [401, 401, 401, 401]);
  assert.ok(statuses.slice(0, 10).every((s) => s === 401 || s === 423), 'exactly ten are allowed through to the handler');
  assert.equal(statuses[10], 429);

  const blocked = await post('/api/auth/login', { email: user.email, password: PASSWORD });
  assert.equal(blocked.status, 429, 'even the correct password is refused while limited');
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.match((await blocked.json()).message, /Too many requests/);
});

test('SEC-7 the limit follows the account, not the capitalisation of the email, and not a spoofed X-Forwarded-For', async () => {
  const res = await post('/api/auth/login', { email: user.email.toUpperCase(), password: 'x' }, { 'X-Forwarded-For': '198.51.100.77' });
  assert.equal(res.status, 429);
});

test('SEC-7 one account being limited does not affect another account', async () => {
  const other = await createRealUser('unaffected');
  const res = await post('/api/auth/login', { email: other.email, password: PASSWORD });
  assert.equal(res.status, 200);
});

test('SEC-7 registration, verification, resend and password reset share the same per-account limit', async () => {
  for (const path of ['/api/auth/register', '/api/auth/verify-email', '/api/auth/resend-code', '/api/auth/password-reset/request', '/api/auth/password-reset/confirm']) {
    const email = `${path.split('/').pop()}-${Date.now()}@example.test`;
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await post(path, { email })).status);
    assert.equal(statuses[10], 429, path);
    assert.ok(statuses.slice(0, 10).every((s) => s !== 429), `${path}: first ten pass through to the handler`);
  }
});

test('SEC-7 the limit is recorded once per offender per window in the audit trail', async () => {
  const entries = await AuditLog.find({ action: 'rate_limit.exceeded' }).lean();
  assert.ok(entries.length >= 1);
  assert.ok(entries.length < 15, 'one record per window, not one per rejected request');
  assert.ok(entries.every((e) => e.category === 'security' && e.ip_address));
});

test('SEC-7 the global limit is 100 requests a minute per IP, and a spoofed X-Forwarded-For does not escape it', async () => {
  const statuses = [];
  // Distinct, forged forwarding headers on every request.
  for (let i = 0; i < 120; i += 1) {
    const res = await fetch(`${apiUrl()}/api/accounts`, { headers: { 'X-Forwarded-For': `203.0.113.${i}` } });
    statuses.push(res.status);
  }
  assert.ok(statuses.includes(429), 'a 429 appears');
  const firstBlocked = statuses.indexOf(429);
  assert.ok(firstBlocked > 0 && firstBlocked <= 100, `blocked from request ${firstBlocked + 1}`);
  assert.ok(statuses.slice(firstBlocked).every((s) => s === 429), 'and stays blocked');
});

test('SEC-7 the health probe is never rate limited', async () => {
  for (let i = 0; i < 10; i += 1) assert.equal((await fetch(`${apiUrl()}/api/health`)).status, 200);
});
