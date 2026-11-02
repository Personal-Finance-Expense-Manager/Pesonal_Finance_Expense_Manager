/**
 * REQ-78: a report covering twelve months and five thousand transactions must
 * be generated within five seconds.
 *
 * Builds the stated load in a throwaway database, measures the report the API
 * actually serves, and fails loudly if the target is missed.
 *
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_bench npm run bench:report
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Account from '../src/models/Account.js';
import Category from '../src/models/Category.js';
import Transaction from '../src/models/Transaction.js';
import User from '../src/models/User.js';
import { reportForPeriod } from '../src/services/reportService.js';
import { reportToPdf } from '../src/services/reportPdfService.js';

const TARGET_MS = 5000;
const TRANSACTIONS = 5000;

const uri = process.env.TEST_MONGO_URI;

if (!uri || !/test|bench/i.test(new URL(uri).pathname)) {
  console.error(
    'Set TEST_MONGO_URI to a database whose name contains "test" or "bench".\n' +
      'Example: TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_bench npm run bench:report'
  );
  process.exit(1);
}

await mongoose.connect(uri);

const email = `bench-report-${Date.now()}@pfem.local`;
const user = await User.create({
  name: 'Benchmark',
  email,
  password_hash: 'x'.repeat(60),
  email_verified: true,
  status: 'active',
});

// Twelve months ending today.
const to = new Date();
const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));

const categoryNames = [
  'Food', 'Groceries', 'Transport', 'Rent', 'Utilities',
  'Health', 'Shopping', 'Entertainment', 'Education', 'Other',
];

const categories = await Category.insertMany(
  categoryNames.map((name) => ({
    user_id: user._id,
    name,
    type: 'expense',
    is_default: true,
  }))
);

const account = await Account.create({
  user_id: user._id,
  name: 'Benchmark Bank',
  type: 'bank',
  currency: 'INR',
  opening_balance: mongoose.Types.Decimal128.fromString('0.00'),
});

const spanMs = to.getTime() - from.getTime();
const docs = [];

for (let i = 0; i < TRANSACTIONS; i += 1) {
  docs.push({
    user_id: user._id,
    account_id: account._id,
    category_id: categories[i % categories.length]._id,
    type: 'expense',
    amount: mongoose.Types.Decimal128.fromString(((i % 900) + 10).toFixed(2)),
    currency: 'INR',
    transaction_date: new Date(from.getTime() + Math.floor((i / TRANSACTIONS) * spanMs)),
    payment_mode: 'upi',
  });
}

await Transaction.insertMany(docs, { ordered: false, throwOnValidationError: true });

const inserted = await Transaction.countDocuments({ user_id: user._id });

if (inserted !== TRANSACTIONS) {
  console.error(`Only ${inserted} of ${TRANSACTIONS} transactions were stored; the measurement would be meaningless.`);
  process.exit(1);
}

const compare = {
  from: new Date(Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth(), 1)),
  to: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 0)),
};

async function measure(label, run) {
  // One untimed pass so the figure is steady-state, not first-call warm-up.
  await run();

  const started = process.hrtime.bigint();
  const result = await run();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  const verdict = ms <= TARGET_MS ? 'PASS' : 'FAIL';
  console.log(`  ${verdict}  ${label.padEnd(34)} ${ms.toFixed(0)} ms  (target ${TARGET_MS} ms)`);

  return { ms, result, ok: ms <= TARGET_MS };
}

console.log(`\nREQ-78 - ${TRANSACTIONS} transactions over 12 months\n`);

const plain = await measure('report, no comparison', () =>
  reportForPeriod(user._id.toString(), { from, to })
);

const compared = await measure('report, with comparison', () =>
  reportForPeriod(user._id.toString(), { from, to, compare })
);

const pdf = await measure('report rendered as PDF', async () => {
  const report = await reportForPeriod(user._id.toString(), { from, to });
  return reportToPdf(report, { userName: 'Benchmark' });
});

console.log(
  `\n  ${plain.result.transaction_count} transactions counted, ` +
    `${plain.result.by_category.length} categories, ` +
    `total ${plain.result.total_expense}`
);
console.log(`  PDF ${(pdf.result.length / 1024).toFixed(1)} KB\n`);

await Transaction.deleteMany({ user_id: user._id });
await Category.deleteMany({ user_id: user._id });
await Account.deleteMany({ user_id: user._id });
await User.deleteOne({ _id: user._id });
await mongoose.disconnect();

const failed = [plain, compared, pdf].filter((m) => !m.ok);

if (failed.length > 0) {
  console.error(`REQ-78 missed on ${failed.length} measurement(s).`);
  process.exit(1);
}

console.log('REQ-78 met.\n');
