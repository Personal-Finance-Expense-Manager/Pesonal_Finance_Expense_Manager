/**
 * Shared set-up for the API integration tests (run with `npm run test:integration`).
 *
 * These tests drive the real Express app against a real MongoDB, so they need
 * TEST_MONGO_URI. The helper DROPS that database, so it refuses to run unless
 * the database name contains "test" - it must never be pointed at a dev or
 * production database.
 *
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run test:integration
 */
process.env.NODE_ENV = 'test';
process.env.DEV_AUTH_HEADER = 'true'; // interim X-User-Id auth (middleware/currentUser.js)

import mongoose from 'mongoose';

const uri = process.env.TEST_MONGO_URI;

if (!uri) {
  throw new Error(
    'TEST_MONGO_URI is not set. Example: ' +
      'TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run test:integration',
  );
}

const dbName = new URL(uri).pathname.replace(/^\//, '');

if (!/test/i.test(dbName)) {
  throw new Error(
    `Refusing to run: database "${dbName}" does not look like a test database ` +
      '(its name must contain "test") and these tests drop it.',
  );
}

const { default: app } = await import('../../src/app.js');
const { default: User } = await import('../../src/models/User.js');
const { default: Account } = await import('../../src/models/Account.js');
const { default: Category } = await import('../../src/models/Category.js');

let server;
let baseUrl;

export async function startApi() {
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

export async function stopApi() {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
}

let counter = 0;

export async function createUser(label = 'user') {
  counter += 1;
  return User.create({
    name: `${label} ${counter}`,
    email: `${label}${counter}@example.test`,
    password_hash: 'not-a-real-hash',
    email_verified: true,
    status: 'active',
  });
}

export function createAccount(user, overrides = {}) {
  counter += 1;
  return Account.create({
    user_id: user._id,
    name: `Account ${counter}`,
    type: 'bank',
    opening_balance: '1000.00',
    currency: 'INR',
    ...overrides,
  });
}

export function createCategory(user, overrides = {}) {
  counter += 1;
  return Category.create({
    user_id: user._id,
    name: `Category ${counter}`,
    type: 'expense',
    ...overrides,
  });
}

/** Today in the app time zone, shifted by `offsetDays`, as YYYY-MM-DD. */
export function isoDay(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

/** A small HTTP client that signs requests as `user` (null = no sign-in). */
export function apiAs(user) {
  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (user) headers['X-User-Id'] = user._id.toString();

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, body: json };
  }

  /** Send a non-JSON body (e.g. a file) and keep the raw response bytes too. */
  async function raw(method, path, { body, headers = {} } = {}) {
    const all = { ...headers };
    if (user) all['X-User-Id'] = user._id.toString();
    const response = await fetch(`${baseUrl}${path}`, { method, headers: all, body });
    return readRaw(response);
  }

  return {
    raw,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
    patch: (path, body) => request('PATCH', path, body ?? {}),
    delete: (path) => request('DELETE', path),
  };
}

async function readRaw(response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  let json = null;
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    try {
      json = JSON.parse(buffer.toString('utf8'));
    } catch {
      json = null;
    }
  }
  return { status: response.status, headers: response.headers, buffer, body: json };
}

/** Fetch an absolute URL with no sign-in at all (signed URLs, US-23). */
export async function fetchUrl(url) {
  return readRaw(await fetch(url));
}

/** Current balances (strings) by account id, read through the real accounts API. */
export async function balancesOf(user) {
  const { body } = await apiAs(user).get('/api/accounts/summary');
  return Object.fromEntries(body.balances.map((b) => [b.id, b.current_balance]));
}

export async function netWorthOf(user) {
  const { body } = await apiAs(user).get('/api/accounts/summary');
  return body.net_worth.net_worth;
}

/** Record a transaction through the real API and return its response data. */
export async function record(user, body) {
  const res = await apiAs(user).post('/api/transactions', {
    transaction_date: isoDay(),
    ...body,
  });
  if (res.status !== 201) {
    throw new Error(`Could not record transaction: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

/** Create an overall monthly budget and return a function that reads its "spent" figure. */
export async function overallBudget(user, amount = '100000') {
  const api = apiAs(user);
  const res = await api.post('/api/budgets', { period_type: 'monthly', amount });
  if (res.status !== 201) throw new Error(`Could not create budget: ${JSON.stringify(res.body)}`);
  return async () => {
    const list = await api.get('/api/budgets');
    return list.body.budgets[0].spent;
  };
}
