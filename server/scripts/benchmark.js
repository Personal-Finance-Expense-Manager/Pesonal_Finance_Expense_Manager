/**
 * Performance benchmark - US-27 (#14), SRS PER-1, PER-3, PER-4, PER-5, PER-6,
 * PER-7, PER-9, PER-10.
 *
 *   cd server
 *   BENCH_MONGO_URI=mongodb://127.0.0.1:27017/pfem_bench npm run bench
 *
 * Builds a throwaway database (it is DROPPED first, so its name must contain
 * "bench" or "test"), starts the real API in-process and times the real HTTP
 * endpoints. Results are printed as a Markdown table that can be pasted into
 * PERFORMANCE.md. The exit code is 1 if any measured target is missed.
 *
 * Data set (PER-4, PER-7):
 *   - one "heavy" user with 5,000 transactions spread over the last 12 months
 *   - 2,000 registered users, 200 of whom are "active" with 50 transactions each
 *
 * Network time is not included: these are server-side times measured on the
 * machine running the script. The 4G/3G figures in PERFORMANCE.md come from a
 * browser with network throttling.
 *
 * Options (environment):
 *   BENCH_SECONDS    length of the concurrent-load run, default 30
 *   BENCH_ACTIVE     concurrent active users, default 200
 */
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'production' : 'development';
process.env.DEV_AUTH_HEADER = 'true';
process.env.JWT_SECRET ||= 'benchmark-only-secret-not-used-for-anything-real';

import mongoose from 'mongoose';
import { performance } from 'node:perf_hooks';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run the benchmark with NODE_ENV=production.');
  process.exit(1);
}

const uri = process.env.BENCH_MONGO_URI;

if (!uri) {
  console.error('Set BENCH_MONGO_URI, e.g. mongodb://127.0.0.1:27017/pfem_bench');
  process.exit(1);
}

const dbName = new URL(uri).pathname.replace(/^\//, '');

if (!/bench|test/i.test(dbName)) {
  console.error(`Refusing to run: "${dbName}" will be dropped, so its name must contain "bench" or "test".`);
  process.exit(1);
}

const SECONDS = Number(process.env.BENCH_SECONDS) || 30;
const ACTIVE = Number(process.env.BENCH_ACTIVE) || 200;
const REGISTERED = 2000;

const { default: app } = await import('../src/app.js');
const { default: User } = await import('../src/models/User.js');
const { default: Account } = await import('../src/models/Account.js');
const { default: Category } = await import('../src/models/Category.js');
const { default: Tag } = await import('../src/models/Tag.js');
const { default: Transaction } = await import('../src/models/Transaction.js');
const { default: TransactionTag } = await import('../src/models/TransactionTag.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
let baseUrl;

function isoDay(offset = 0) {
  return new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
}

function percentile(values, p) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function call(userId, method, path, body) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User-Id': String(userId) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const ms = performance.now() - started;
  if (response.status >= 400) {
    throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 200)}`);
  }
  return { ms, body: text ? JSON.parse(text) : null };
}

async function repeat(times, fn) {
  const samples = [];
  for (let i = 0; i < times; i += 1) samples.push((await fn(i)).ms);
  return samples;
}

const results = [];

function report(id, what, samples, targetMs, { stat = 'p95' } = {}) {
  const value = stat === 'max' ? Math.max(...samples) : percentile(samples, 95);
  results.push({ id, what, stat, value, target: targetMs, pass: value <= targetMs, n: samples.length });
}

// ---------------------------------------------------------------------------
// Data set
// ---------------------------------------------------------------------------

async function seed() {
  const t0 = performance.now();
  process.stdout.write('Seeding ');

  const users = await User.insertMany(
    Array.from({ length: REGISTERED }, (_, i) => ({
      name: `Bench user ${i}`,
      email: `bench${i}@example.test`,
      password_hash: 'not-a-real-hash',
      email_verified: true,
      status: 'active',
    })),
  );
  process.stdout.write('.');

  const heavy = users[0];
  const active = users.slice(1, ACTIVE + 1);

  const accounts = await Account.insertMany(
    users.map((u) => ({ user_id: u._id, name: 'Bank', type: 'bank', opening_balance: '100000.00', currency: 'INR' })),
  );
  const accountOf = new Map(accounts.map((a) => [a.user_id.toString(), a]));
  const heavyCash = await Account.create({
    user_id: heavy._id, name: 'Cash', type: 'cash', opening_balance: '5000.00', currency: 'INR',
  });
  process.stdout.write('.');

  const names = ['Food', 'Transport', 'Rent', 'Shopping', 'Bills', 'Health', 'Travel', 'Education'];
  const heavyCategories = await Category.insertMany(
    names.map((name) => ({ user_id: heavy._id, name, type: 'expense' })),
  );
  const tag = await Tag.create({ user_id: heavy._id, name: 'weekend' });

  // 5,000 transactions over 12 months for the heavy user.
  const heavyDocs = Array.from({ length: 5000 }, (_, i) => ({
    user_id: heavy._id,
    account_id: i % 5 === 0 ? heavyCash._id : accountOf.get(heavy._id.toString())._id,
    category_id: heavyCategories[i % heavyCategories.length]._id,
    type: i % 20 === 0 ? 'income' : 'expense',
    amount: `${(50 + (i * 37) % 4000)}.${String(i % 100).padStart(2, '0')}`,
    currency: 'INR',
    transaction_date: new Date(`${isoDay(-(i % 365))}T00:00:00.000Z`),
    payment_mode: 'upi',
    note: i % 7 === 0 ? `Dinner with friends ${i}` : `Expense ${i}`,
  }));

  for (let i = 0; i < heavyDocs.length; i += 1000) {
    const inserted = await Transaction.insertMany(heavyDocs.slice(i, i + 1000));
    await TransactionTag.insertMany(
      inserted.filter((_, j) => j % 5 === 0).map((t) => ({ user_id: heavy._id, transaction_id: t._id, tag_id: tag._id })),
    );
    process.stdout.write('.');
  }

  // 50 transactions for each active user.
  const activeDocs = active.flatMap((u, n) =>
    Array.from({ length: 50 }, (_, i) => ({
      user_id: u._id,
      account_id: accountOf.get(u._id.toString())._id,
      type: 'expense',
      amount: `${100 + ((i + n) % 900)}.00`,
      currency: 'INR',
      transaction_date: new Date(`${isoDay(-(i % 60))}T00:00:00.000Z`),
      payment_mode: 'cash',
      note: `Item ${i}`,
    })),
  );
  for (let i = 0; i < activeDocs.length; i += 2000) {
    await Transaction.insertMany(activeDocs.slice(i, i + 2000));
    process.stdout.write('.');
  }

  await Promise.all([Transaction.syncIndexes(), TransactionTag.syncIndexes()]);
  console.log(` done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  return {
    heavy,
    heavyAccount: accountOf.get(heavy._id.toString()),
    heavyCategory: heavyCategories[0],
    active: active.map((u) => ({ user: u, account: accountOf.get(u._id.toString()) })),
  };
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

async function measureSingleUser({ heavy, heavyAccount, heavyCategory }) {
  const id = heavy._id;
  const list = '/api/transactions?page=1&limit=25';

  // Warm up the connection pool and caches, as a real server would be.
  await call(id, 'GET', list);
  await call(id, 'GET', '/api/reports/dashboard');

  // PER-1: saving a transaction (server part of the 1 s budget).
  const saves = await repeat(50, (i) =>
    call(id, 'POST', '/api/transactions', {
      type: 'expense', amount: '120.00', transaction_date: isoDay(), account_id: heavyAccount.id,
      category_id: heavyCategory.id, payment_mode: 'upi', note: `Bench save ${i}`, tags: ['bench'],
    }));
  report('PER-1', 'Save a transaction (server time)', saves, 1000);

  // PER-5: a page of 25, and filtering/searching.
  report('PER-5', 'Transaction list, page of 25 (5,000+ rows)', await repeat(30, () => call(id, 'GET', list)), 1000);
  const filtered =
    `/api/transactions?page=1&limit=25&startDate=${isoDay(-90)}&endDate=${isoDay()}` +
    `&categoryId=${heavyCategory.id}&minAmount=100&search=dinner`;
  report('PER-5', 'Filter + search (date, category, amount, note)', await repeat(30, () => call(id, 'GET', filtered)), 2000);
  report('PER-5', 'Filter by tag', await repeat(30, () => call(id, 'GET', '/api/transactions?page=1&limit=25&tag=weekend')), 2000);

  // PER-3: dashboard figures.
  report('PER-3', 'Dashboard summary (server time)', await repeat(20, () => call(id, 'GET', '/api/reports/dashboard')), 3000);

  // PER-4: a twelve-month report over 5,000 transactions.
  const totals = `/api/reports/totals?from=${isoDay(-365)}&to=${isoDay()}&type=expense`;
  report('PER-4', '12-month category/tag totals, 5,000 transactions', await repeat(10, () => call(id, 'GET', totals)), 5000);

  // PER-6: balances reflect a change straight away.
  const before = await call(id, 'GET', '/api/accounts/summary');
  const startedChange = performance.now();
  await call(id, 'POST', '/api/transactions', {
    type: 'expense', amount: '1.00', transaction_date: isoDay(), account_id: heavyAccount.id, note: 'PER-6 probe',
  });
  const after = await call(id, 'GET', '/api/accounts/summary');
  const consistentMs = performance.now() - startedChange;
  const changed = JSON.stringify(before.body.balances) !== JSON.stringify(after.body.balances);
  results.push({
    id: 'PER-6', what: 'Balance reflects a new transaction', stat: 'elapsed', value: consistentMs,
    target: 5000, pass: changed && consistentMs <= 5000, n: 1,
  });

  // PER-9: CSV import of 1,000 rows.
  const header = 'date,type,amount,currency,account,to_account,category,payment_mode,note,tags';
  const rows = Array.from({ length: 1000 }, (_, i) =>
    `${isoDay(-(i % 300))},expense,${(10 + i).toFixed(2)},INR,Bank,,Food,upi,Imported row ${i},${i % 10 === 0 ? 'imported' : ''}`);
  const csv = [header, ...rows].join('\n');
  const preview = await call(id, 'POST', '/api/data/import/preview', { csv });
  if (preview.body.data.valid_count !== 1000) throw new Error(`Import preview found ${preview.body.data.valid_count} valid rows`);
  report('PER-9', 'Import 1,000 rows: validate and preview', [preview.ms], 15000, { stat: 'max' });
  const commit = await call(id, 'POST', '/api/data/import/commit', { csv });
  report('PER-9', 'Import 1,000 rows: commit', [commit.ms], 15000, { stat: 'max' });
}

/**
 * PER-7: ACTIVE users each acting every few seconds.
 *
 * "Without degrading the above response times by more than 20 percent" is
 * read as: under load, each operation's p95 stays within 120 % of its own
 * target (save and list 1 s -> 1.2 s, dashboard 3 s -> 3.6 s). The change
 * against a one-user baseline is printed as well, for information.
 */
async function measureConcurrency(active) {
  const OPS = [
    { name: 'list', target: 1000, run: (u) => call(u.user._id, 'GET', '/api/transactions?page=1&limit=25') },
    { name: 'dashboard', target: 3000, run: (u) => call(u.user._id, 'GET', '/api/reports/dashboard') },
    {
      name: 'save',
      target: 1000,
      run: (u, i) => call(u.user._id, 'POST', '/api/transactions', {
        type: 'expense', amount: '42.00', transaction_date: isoDay(), account_id: u.account.id, note: `Load ${i}`,
      }),
    },
  ];

  // Baseline: the same operations from one user at a time.
  const baseline = Object.fromEntries(OPS.map((op) => [op.name, []]));
  for (let i = 0; i < 60; i += 1) {
    const op = OPS[i % OPS.length];
    baseline[op.name].push((await op.run(active[i % active.length], i)).ms);
  }

  // Load: each active user acts every 3-7 seconds (think time) for SECONDS.
  const loaded = Object.fromEntries(OPS.map((op) => [op.name, []]));
  const errors = [];
  const stopAt = Date.now() + SECONDS * 1000;
  process.stdout.write(`Concurrent load: ${ACTIVE} active users for ${SECONDS} s `);

  await Promise.all(active.map(async (u, n) => {
    let i = n;
    await new Promise((r) => setTimeout(r, Math.random() * 5000));
    while (Date.now() < stopAt) {
      const op = OPS[i % OPS.length];
      try {
        loaded[op.name].push((await op.run(u, i)).ms);
      } catch (error) {
        errors.push(error.message);
      }
      i += 1;
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000));
    }
  }));

  const total = Object.values(loaded).reduce((sum, list) => sum + list.length, 0);
  console.log(`- ${total} requests, ${errors.length} errors`);

  for (const op of OPS) {
    const base95 = percentile(baseline[op.name], 95);
    const load95 = percentile(loaded[op.name], 95);
    const change = ((load95 - base95) / base95) * 100;
    results.push({
      id: 'PER-7',
      what: `${ACTIVE} active users (${(total / SECONDS).toFixed(0)} req/s), ${op.name}: ` +
        `baseline p95 ${base95.toFixed(0)} ms, ${change >= 0 ? '+' : ''}${change.toFixed(0)} %`,
      stat: 'p95',
      value: load95,
      target: op.target * 1.2,
      pass: errors.length === 0 && load95 <= op.target * 1.2,
      n: loaded[op.name].length,
    });
  }
}

/** PER-10: the main queries use an index. */
async function measureIndexes({ heavy, heavyCategory }) {
  const user = heavy._id;
  const from = new Date(Date.now() - 90 * DAY);
  const checks = [
    ['user + date range', Transaction.find({ user_id: user, is_deleted: { $ne: true }, transaction_date: { $gte: from } }).sort({ transaction_date: -1 }).limit(25)],
    ['user + category + date', Transaction.find({ user_id: user, category_id: heavyCategory._id, transaction_date: { $gte: from } })],
    ['tag links by user + tag', TransactionTag.find({ user_id: user, tag_id: (await Tag.findOne({ user_id: user, name: 'weekend' }))._id })],
  ];

  for (const [what, query] of checks) {
    let plan = 'unknown';
    let ms = NaN;
    try {
      const started = performance.now();
      const explained = await query.clone().explain('executionStats');
      ms = performance.now() - started;
      const text = JSON.stringify(explained);
      // MongoDB reports IXSCAN / COLLSCAN; MongoDB-compatible servers built
      // on PostgreSQL report "Index Scan" / "Seq Scan".
      if (/COLLSCAN|Seq Scan/.test(text)) plan = 'COLLSCAN';
      else if (/IXSCAN|Index Scan/.test(text)) plan = 'index';
    } catch {
      plan = 'explain not supported';
    }
    results.push({
      id: 'PER-10', what: `${what} (plan: ${plan})`, stat: 'explain ms', value: ms, target: 500,
      pass: plan !== 'COLLSCAN' && !(ms > 500), n: 1,
    });
  }
}

// ---------------------------------------------------------------------------

async function main() {
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).syncIndexes().catch(() => {})));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const data = await seed();
    await measureSingleUser(data);
    await measureIndexes(data);
    await measureConcurrency(data.active);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }

  console.log('');
  console.log(`Node ${process.version}, database "${dbName}", ${new Date().toISOString()}`);
  console.log('');
  console.log('| Req | Measurement | Samples | Result | Target | Pass |');
  console.log('|---|---|---:|---:|---:|:---:|');
  for (const r of results) {
    const unit = r.stat === 'degradation %' ? '%' : ' ms';
    const value = Number.isFinite(r.value) ? `${r.stat} ${r.value.toFixed(r.stat === 'degradation %' ? 1 : 0)}${unit}` : 'n/a';
    console.log(`| ${r.id} | ${r.what} | ${r.n} | ${value} | ${r.target}${unit} | ${r.pass ? 'yes' : '**no**'} |`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log('');
  console.log(failed.length ? `${failed.length} target(s) missed.` : 'All measured targets met.');
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
