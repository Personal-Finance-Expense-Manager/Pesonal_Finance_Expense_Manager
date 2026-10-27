import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Session from '../src/models/Session.js';

/**
 * US-25 (#61), REQ-93: every API request is authenticated on the server, and
 * the signed-in session - not a client-supplied id - decides who the caller is.
 *
 * These are the checks that were failing before this story: a real token did
 * not reach any feature route, so the application could not run without the
 * development header.
 */

let server;
let base;
let user;
let token;

function url(path) {
  return base + path;
}

async function call(path, { method = 'GET', token: t, headers = {}, body } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (t) h.Authorization = `Bearer ${t}`;
  const res = await fetch(url(path), {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

before(async () => {
  // Use the dedicated test database, like the other integration tests, so a
  // run never touches development data.
  const uri = process.env.TEST_MONGO_URI;

  if (!uri) {
    throw new Error(
      'TEST_MONGO_URI is not set. Example: TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run test:integration'
    );
  }

  await mongoose.connect(uri);

  await User.deleteMany({ email: /^authint/ });

  user = await User.create({
    name: 'Auth Integration',
    email: `authint${Date.now()}@pfem.local`,
    password_hash: 'x'.repeat(60),
    email_verified: true,
    status: 'active',
    role: 'user',
  });

  const jti = `test-${Date.now()}`;
  const expires = new Date(Date.now() + 3600_000);

  await Session.create({
    user_id: user._id,
    jti,
    expires_at: expires,
    revoked_at: null,
  });

  token = jwt.sign(
    { sub: user._id.toString(), jti },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await Session.deleteMany({ user_id: user?._id });
  await User.deleteMany({ _id: user?._id });
  await mongoose.disconnect();
});

const FEATURE_ROUTES = [
  '/accounts',
  '/categories',
  '/transactions',
  '/tags',
  '/budgets',
  '/reports/dashboard',
];

for (const route of FEATURE_ROUTES) {
  test(`REQ-93 a signed-in token authenticates GET ${route}`, async () => {
    const { status } = await call(route, { token });
    assert.equal(status, 200, `${route} rejected a valid session token`);
  });

  test(`SEC-4 GET ${route} refuses a request with no credentials`, async () => {
    const { status } = await call(route, { headers: { 'X-User-Id': '' } });
    assert.equal(status, 401);
  });

  test(`SEC-4 GET ${route} refuses a forged token`, async () => {
    const forged = jwt.sign(
      { sub: user._id.toString(), jti: 'nope' },
      'a'.repeat(40),
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const { status } = await call(route, { token: forged });
    assert.equal(status, 401);
  });
}

test('REQ-93 a revoked session is refused even with a valid signature', async () => {
  const jti = `revoked-${Date.now()}`;
  await Session.create({
    user_id: user._id,
    jti,
    expires_at: new Date(Date.now() + 3600_000),
    revoked_at: new Date(),
  });
  const revoked = jwt.sign(
    { sub: user._id.toString(), jti },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
  const { status } = await call('/accounts', { token: revoked });
  assert.equal(status, 401);
});

test('REQ-93 a suspended account cannot use a valid token', async () => {
  await User.updateOne({ _id: user._id }, { $set: { status: 'suspended' } });
  const { status } = await call('/accounts', { token });
  assert.equal(status, 401);
  await User.updateOne({ _id: user._id }, { $set: { status: 'active' } });
});

test('REQ-93 the token takes precedence over any X-User-Id header', async () => {
  const other = await User.create({
    name: 'Other Person',
    email: `authint-other${Date.now()}@pfem.local`,
    password_hash: 'y'.repeat(60),
    email_verified: true,
    status: 'active',
  });

  // The caller presents a valid token AND claims to be somebody else.
  const { status, body } = await call('/accounts', {
    token,
    headers: { 'X-User-Id': other._id.toString() },
  });

  assert.equal(status, 200);
  // Any account returned must belong to the token holder, never to "other".
  for (const account of body.accounts || []) {
    assert.notEqual(account.user_id, other._id.toString());
  }

  await User.deleteOne({ _id: other._id });
});

test('REQ-93 a new user defaults to the user role, not admin', async () => {
  const fresh = await User.create({
    name: 'Role Default',
    email: `authint-role${Date.now()}@pfem.local`,
    password_hash: 'z'.repeat(60),
  });
  assert.equal(fresh.role, 'user');
  await User.deleteOne({ _id: fresh._id });
});
