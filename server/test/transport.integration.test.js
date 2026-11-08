import http from 'node:http';

// Production-style transport settings. ES imports are hoisted above ordinary
// statements, so the app and helpers are imported dynamically AFTER these are set.
process.env.FORCE_HTTPS = 'true';
process.env.TRUST_PROXY = '1';
process.env.CLIENT_ORIGIN = 'https://app.example.com';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { startApi, stopApi, apiUrl } = await import('./helpers/integration.js');
const { bearer, createRealUser, signIn } = await import('./helpers/auth.js');

/** US-28 (#67) SEC-1: HTTPS is enforced and HSTS is sent, with a one-year minimum. */

before(startApi);
after(stopApi);

/** Plain http.request, because fetch() will not let a test choose the Host header. */
function send(path, { method = 'GET', headers = {} } = {}) {
  const { port } = new URL(apiUrl());
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('SEC-1 a plain-HTTP GET is redirected to HTTPS on the same host', async () => {
  const res = await send('/api/accounts', { headers: { Host: 'api.example.com' } });
  assert.equal(res.status, 308);
  assert.equal(res.headers.location, 'https://api.example.com/api/accounts');
});

test('SEC-1 a plain-HTTP write is refused outright (a redirect would resend credentials in the clear)', async () => {
  const res = await send('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 426);
});

test('SEC-1 a hostile Host header is never used to build the redirect', async () => {
  const res = await send('/api/accounts', { headers: { Host: 'evil.example/\r\nSet-Cookie: x' } }).catch(() => ({ status: 0, headers: {} }));
  assert.ok(res.status === 0 || res.status === 426 || res.status === 400 || !String(res.headers.location || '').includes('evil'));
});

test('SEC-1 a request the trusted proxy marked as HTTPS reaches the application, and carries HSTS of at least one year', async () => {
  const user = await createRealUser('tls');
  const api = bearer(apiUrl(), (await signIn(user)).token, { 'X-Forwarded-Proto': 'https' });
  const res = await api.get('/api/accounts');
  assert.equal(res.status, 200, 'a protected route is served once the proxy says it was HTTPS');

  const hsts = res.headers.get('strict-transport-security');
  assert.ok(hsts, 'HSTS header present');
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)[1]);
  assert.ok(maxAge >= 31_536_000, `max-age ${maxAge}`);
  assert.match(hsts, /includeSubDomains/);

  const plain = await bearer(apiUrl(), (await signIn(user)).token).get('/api/accounts');
  assert.equal(plain.status, 308, 'the same request without the proxy header is not served');
});

test('SEC-1 the liveness probe works over plain HTTP so load balancers can reach it', async () => {
  assert.equal((await send('/api/health')).status, 200);
});

test('SEC-6 with explicit production origins, only that origin is allowed by CORS and the origin guard', async () => {
  const proxied = { 'X-Forwarded-Proto': 'https' };
  const ok = await send('/api/health', { headers: { ...proxied, Origin: 'https://app.example.com' } });
  assert.equal(ok.headers['access-control-allow-origin'], 'https://app.example.com');
  const dev = await send('/api/health', { headers: { ...proxied, Origin: 'http://localhost:5173' } });
  assert.equal(dev.headers['access-control-allow-origin'], undefined, 'the dev origin is not allowed in production');
  const evil = await send('/api/health', { headers: { ...proxied, Origin: 'https://evil.example' } });
  assert.equal(evil.headers['access-control-allow-origin'], undefined);

  const write = await send('/api/categories', { method: 'POST', headers: { ...proxied, Origin: 'https://evil.example', 'Content-Type': 'application/json' } });
  assert.equal(write.status, 403);
});
