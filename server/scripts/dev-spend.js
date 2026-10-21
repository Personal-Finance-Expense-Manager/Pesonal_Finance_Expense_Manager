/**
 * Add demo spending for the demo user, for local testing of budgets (US-14)
 * before the transaction screens (US-08) are merged.
 *
 *   cd server
 *   npm run dev:spend -- Food 500                 an expense in Food today
 *   npm run dev:spend -- Food 500 --excluded      marked "excluded from budgets"
 *   npm run dev:spend -- Food 500 --date 2026-10-05
 *   npm run dev:spend -- --transfer 2000          a transfer between own accounts
 *
 * After adding, it re-checks the user's budgets the same way the transaction
 * routes will (evaluateBudgetsForUser), so 80% / 100% alerts are raised here.
 * Refuses to run with NODE_ENV=production.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Account from '../src/models/Account.js';
import Category from '../src/models/Category.js';
import Transaction from '../src/models/Transaction.js';
import Transfer from '../src/models/Transfer.js';
import { evaluateBudgetsForUser } from '../src/services/budgetEvaluator.js';
import { parseAmount } from '../src/validators/account.js';
import { parseDateOnly, today, formatDateOnly } from '../src/utils/period.js';

const DEMO_EMAIL = 'demo@pfem.local';

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: npm run dev:spend -- <Category> <amount> [--excluded] [--date YYYY-MM-DD]');
  console.error('       npm run dev:spend -- --transfer <amount>');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') usage('Refusing to run in production.');
if (!process.env.MONGO_URI) usage('MONGO_URI is not set. Copy server/.env.example to server/.env first.');

const args = process.argv.slice(2);
const isTransfer = args.includes('--transfer');
const excluded = args.includes('--excluded');
const dateIndex = args.indexOf('--date');
const dateArg = dateIndex >= 0 ? args[dateIndex + 1] : null;
const positional = args.filter((a, i) => !a.startsWith('--') && !(dateIndex >= 0 && i === dateIndex + 1));

const [categoryName, rawAmount] = isTransfer ? [null, positional[0]] : positional;
if (!isTransfer && !categoryName) usage('Give a category name, for example Food.');

const amount = parseAmount(rawAmount, 'Amount');
if (amount.error || Number(amount.value) <= 0) usage(amount.error || 'Amount must be greater than zero.');

const date = dateArg ? parseDateOnly(dateArg) : today();
if (!date) usage('Date must be YYYY-MM-DD.');

async function ensureAccount(user, name, type) {
  let account = await Account.findOne({ user_id: user._id, name });
  if (!account) {
    account = await Account.create({
      user_id: user._id, name, type, opening_balance: '0.00', currency: user.base_currency || 'INR',
    });
    console.log(`Created account "${name}" for demo spending.`);
  }
  return account;
}

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });

  const user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) usage('No demo user yet. Run: npm run seed:dev');

  const bank = await ensureAccount(user, 'Demo Bank', 'bank');

  if (isTransfer) {
    const wallet = await ensureAccount(user, 'Demo Wallet', 'wallet');
    await Transfer.create({
      user_id: user._id,
      from_account_id: bank._id,
      to_account_id: wallet._id,
      amount: amount.value,
      transfer_date: date,
      note: 'dev:spend demo transfer',
    });
    console.log(`Transferred ${amount.value} from Demo Bank to Demo Wallet on ${formatDateOnly(date)}.`);
  } else {
    const category = await Category.findOne({
      type: 'expense',
      name: new RegExp(`^${categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      $or: [{ user_id: user._id }, { user_id: null }],
    });
    if (!category) usage(`No expense category called "${categoryName}". Run npm run seed:dev for demo categories.`);

    await Transaction.create({
      user_id: user._id,
      account_id: bank._id,
      category_id: category._id,
      type: 'expense',
      amount: amount.value,
      currency: user.base_currency || 'INR',
      transaction_date: date,
      payment_mode: 'upi',
      note: 'dev:spend demo expense',
      is_excluded_from_budget: excluded,
    });
    console.log(
      `Added ${amount.value} expense in ${category.name} on ${formatDateOnly(date)}` +
      `${excluded ? ' (excluded from budgets)' : ''}.`,
    );
  }

  const alerts = await evaluateBudgetsForUser(user._id);
  for (const alert of alerts) console.log(`ALERT: ${alert.title} - ${alert.body}`);
  if (!alerts.length) console.log('No new budget alerts.');
} catch (error) {
  console.error(`Could not add demo spending: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
