import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, stopApi, apiUrl, createUser } from './helpers/integration.js';
import { bearer, createRealUser, signIn } from './helpers/auth.js';

/**
 * US-28 (#67) SEC-4 / SEC-12. The web client no longer uses the development
 * X-User-Id header, but the server keeps it for its own test suites and local
 * scripts. These tests prove that bypass stays development-only, off unless
 * switched on, and cannot be used in production.
 */

let user;
before(async () => {
  await startApi();
  user = await createUser('devheader');
});
after(stopApi);

const withEnv = async (env, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

const asHeaderUser = () => fetch(`${apiUrl()}/api/accounts`, { headers: { 'X-User-Id': String(user._id) } });

test('SEC-4 the development header works only when explicitly switched on (and not in production)', async () => {
  await withEnv({ DEV_AUTH_HEADER: 'true', NODE_ENV: 'test' }, async () => {
    assert.equal((await asHeaderUser()).status, 200, 'on in development: the server suites rely on it');
  });
});

test('SEC-4 with the switch off (the default) the header identifies nobody', async () => {
  for (const value of [undefined, 'false', '', '1', 'TRUE', 'yes']) {
    await withEnv({ DEV_AUTH_HEADER: value, NODE_ENV: 'test' }, async () => {
      assert.equal((await asHeaderUser()).status, 401, `DEV_AUTH_HEADER=${value}`);
    });
  }
});

test('SEC-4 in production the header is ignored even if the switch is on', async () => {
  await withEnv({ DEV_AUTH_HEADER: 'true', NODE_ENV: 'production', FORCE_HTTPS: 'false' }, async () => {
    const res = await asHeaderUser();
    assert.equal(res.status, 401);
    assert.match((await res.json()).message, /sign in/i);
  });
});

test('SEC-4 a real session token keeps working in production, and wins over the header', async () => {
  const real = await createRealUser('prodreal');
  const { token } = await signIn(real);
  await withEnv({ DEV_AUTH_HEADER: 'true', NODE_ENV: 'production', FORCE_HTTPS: 'false' }, async () => {
    assert.equal((await bearer(apiUrl(), token).get('/api/accounts')).status, 200);
    // Both sent: the token decides who the caller is, never the header.
    const res = await fetch(`${apiUrl()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}`, 'X-User-Id': String(user._id) } });
    assert.equal((await res.json()).data.id, String(real._id));
  });
});

test('SEC-4 the header cannot reach administration, whatever the environment', async () => {
  await withEnv({ DEV_AUTH_HEADER: 'true', NODE_ENV: 'test' }, async () => {
    const res = await fetch(`${apiUrl()}/api/admin/users`, { headers: { 'X-User-Id': String(user._id) } });
    assert.equal(res.status, 403);
  });
});

test('SEC-4 an invalid, unknown or non-active header user is refused', async () => {
  await withEnv({ DEV_AUTH_HEADER: 'true', NODE_ENV: 'test' }, async () => {
    for (const id of ['not-an-id', '64b000000000000000000000', '']) {
      const res = await fetch(`${apiUrl()}/api/accounts`, { headers: { 'X-User-Id': id } });
      assert.equal(res.status, 401, id);
    }
  });
});

test('SEC-12 production start-up refuses to run with the development switches on', async () => {
  const { environmentProblems } = await import('../src/config/security.js');
  const base = {
    NODE_ENV: 'production', MONGO_URI: 'mongodb://db/x', JWT_SECRET: 'a'.repeat(7) + 'Zq9'.repeat(10),
    EMAIL_VERIFICATION_SECRET: 'b'.repeat(7) + 'Xk4'.repeat(10), ENCRYPTION_KEY: '1f'.repeat(32), BLIND_INDEX_KEY: '2e'.repeat(32),
    BACKUP_ENCRYPTION_KEY: '3d'.repeat(32), ATTACHMENT_URL_SECRET: 'c'.repeat(7) + 'Lm2'.repeat(10), APP_LOCK_SECRET: 'd'.repeat(7) + 'Pn8'.repeat(10),
    CLIENT_ORIGIN: 'https://app.example.com', TRUST_PROXY: '1',
  };
  assert.deepEqual(environmentProblems(base), []);
  assert.ok(environmentProblems({ ...base, DEV_AUTH_HEADER: 'true' }).some((p) => /DEV_AUTH_HEADER/.test(p)));
});
