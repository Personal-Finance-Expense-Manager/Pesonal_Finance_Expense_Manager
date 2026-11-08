import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * US-28 (#67) SEC-4: every page identifies the caller with the session JWT
 * (Authorization: Bearer) and nothing else. The Sprint 1 "demo user id" /
 * X-User-Id mechanism must not exist in the client.
 */
const src = path.resolve(import.meta.dirname, '../src');
const files = fs.readdirSync(src).filter((f) => /\.(js|jsx)$/.test(f));
const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');

// A minimal localStorage, so auth.js can be exercised without a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { authHeaders, clearSession, getToken, isSignedIn, saveSession } = await import('../src/auth.js');

beforeEach(() => store.clear());

// ---------------------------------------------------------------------------
// The shared helper
// ---------------------------------------------------------------------------

test('SEC-4 with no session there are no credentials at all', () => {
  assert.deepEqual(authHeaders(), {});
  assert.equal(isSignedIn(), false);
});

test('SEC-4 a signed-in session sends the token as a Bearer header', () => {
  saveSession('abc.def.ghi', { name: 'A' });
  assert.equal(isSignedIn(), true);
  assert.deepEqual(authHeaders(), { Authorization: 'Bearer abc.def.ghi' });
  clearSession();
  assert.deepEqual(authHeaders(), {});
  assert.equal(getToken(), '');
});

test('SEC-4 a pasted or stored user id is never turned into an identity', () => {
  // The old mechanism read this key and any argument; neither may matter now.
  store.set('pfem_dev_user_id', '64b000000000000000000001');
  assert.deepEqual(authHeaders(), {});
  assert.deepEqual(authHeaders('64b000000000000000000001'), {});

  saveSession('tok', null);
  const headers = authHeaders('64b000000000000000000001');
  assert.deepEqual(headers, { Authorization: 'Bearer tok' });
  assert.ok(!('X-User-Id' in headers));
});

// ---------------------------------------------------------------------------
// The source tree
// ---------------------------------------------------------------------------

test('SEC-4 no client file mentions the demo-user mechanism', () => {
  const forbidden = [
    /DEV_USER_KEY/, /pfem_dev_user_id/i, /X-User-Id/i, /demo user/i, /development user/i,
    /userIdDraft/, /saveUserId/, /handleUserIdChange/, /setUserId\b/, /seed:dev/,
  ];
  const offenders = [];
  for (const file of files) {
    const text = read(file);
    for (const pattern of forbidden) if (pattern.test(text)) offenders.push(`${file}: ${pattern}`);
  }
  assert.deepEqual(offenders, []);
});

test('SEC-4 the only browser-storage keys are the session, the user summary and the activity clock', () => {
  const allowed = new Set(['pfem_token', 'pfem_user', 'pfem_last_activity', 'pfem_notice']);
  const found = new Set();
  for (const file of files) {
    for (const m of read(file).matchAll(/['"`](pfem_[a-z_]+)['"`]/g)) found.add(m[1]);
  }
  // Other features may keep their own, unrelated, keys (the offline queue).
  const identity = [...found].filter((k) => /user|token|auth|id$/.test(k) && !allowed.has(k));
  assert.deepEqual(identity, [], 'no other identity-bearing key is stored');
});

test('SEC-4 no helper takes a user id any more', () => {
  const offenders = [];
  for (const file of files) {
    const text = read(file);
    if (/\b(authHeaders|makeApi)\s*\(\s*\w/.test(text)) offenders.push(`${file}: passes an argument to authHeaders/makeApi`);
    if (/function\s+(authHeaders|makeApi)\s*\(\s*\w/.test(text)) offenders.push(`${file}: declares a user-id parameter`);
    if (/\buserId\b/.test(text)) offenders.push(`${file}: refers to userId`);
  }
  assert.deepEqual(offenders, []);
});

test('SEC-4 every file that calls the API sends the session token', () => {
  // Files that call fetch() must use the shared helper (or makeApi, which does),
  // or set the Bearer header themselves. App.jsx and the session code also call
  // public endpoints (sign-in, registration) and so add the header only where needed.
  const viaHelper = (t) => /\bauthHeaders\s*\(/.test(t) || /\bmakeApi\s*\(/.test(t) || /Authorization\s*[:=]\s*`Bearer/.test(t);
  const offenders = files.filter((f) => /\bfetch\s*\(/.test(read(f)) && !viaHelper(read(f)));
  assert.deepEqual(offenders, [], 'these call fetch() without sending the session token');
});

test('SEC-4 every feature page shows a sign-in prompt when nobody is signed in', () => {
  const pages = files.filter((f) => /Page\.jsx$/.test(f));
  assert.ok(pages.length >= 14, `found ${pages.length} pages`);
  const withoutPrompt = pages.filter((f) => {
    const t = read(f);
    return !/SignInRequired|SignedOutPage|Sign in first/.test(t);
  });
  assert.deepEqual(withoutPrompt, []);
});

test('SEC-1 no page hard-codes the API address (it must follow VITE_API_URL)', () => {
  const offenders = [];
  for (const file of files) {
    for (const line of read(file).split('\n')) {
      if (/localhost:5000/.test(line) && !/VITE_API_URL/.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});
