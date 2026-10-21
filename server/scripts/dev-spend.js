/**
 * Add demo money movements for the demo user, for local testing of budgets
 * (US-14) and balances (US-07) before the transaction screens (US-08) are
 * merged.
 *
 *   cd server
 *   npm run dev:spend -- Food 500                 an expense in Food today (Demo Bank)
 *   npm run dev:spend -- Food 500 --excluded      marked "excluded from budgets"
 *   npm run dev:spend -- Food 500 --date 2026-10-05
 *   npm run dev:spend -- Food 500 --account "ICICI Card"   spend from a named account
 *   npm run dev:spend -- --income 25000 --account "HDFC Savings"
 *   npm run dev:spend -- --transfer 2000          Demo Bank -> Demo Wallet
 *   npm run dev:spend -- --transfer 5000 --account "HDFC Savings" --to "ICICI Card"
 *
 * --account and --to name one of the demo user's existing accounts. Without
 * them, "Demo Bank" (and "Demo Wallet" for transfers) are created and used.
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
  console.error('Usage: npm run dev:spend -- <Category> <amount> [--account "Name"] [--excluded] [--date YYYY-MM-DD]');
  console.error('       npm run dev:spend -- --income <amount> [--account "Name"] [--date YYYY-MM-DD]');
  console.error('       npm run dev:spend -- --transfer <amount> [--account "From"] [--to "To"]');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') usage('Refusing to run in production.');
if (!process.env.MONGO_URI) usage('MONGO_URI is not set. Copy server/.env.example to server/.env first.');

const args = process.argv.slice(2);
const isTransfer = args.includes('--transfer');
const isIncome = args.includes('--income');
const excluded = args.includes('--excluded');

// Options that take a value: --date, --account, --to
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const valueIndexes = new Set(['--date', '--account', '--to']
  .map((flag) => args.indexOf(flag))
  .filter((i) => i >= 0)
  .map((i) => i + 1));
const positional = args.filter((a, i) => !a.startsWith('--') && !valueIndexes.has(i));

const dateArg = valueOf('--date');
const accountArg = valueOf('--account');
const toArg = valueOf('--to');

const [categoryName, rawAmount] = isTransfer || isIncome ? [null, positional[0]] : positional;
if (!isTransfer && !isIncome && !categoryName) usage('Give a category name, for example Food.');

const amount = parseAmount(rawAmount, 'Amount');
if (amount.error || Number(amount.value) <= 0) usage(amount.error || 'Amount must be greater than zero.');

const date = dateArg ? parseDateOnly(dateArg) : today();
if (!date) usage('Date must be YYYY-MM-DD.');

async function namedAccount(user, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const account = await Account.findOne({ user_id: user._id, name: new RegExp(`^${escaped}$`, 'i') });
  if (!account) usage(`No account called "${name}" for the demo user. Create it on the Accounts page first.`);
  return account;
}

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

  const bank = accountArg ? await namedAccount(user, accountArg) : await ensureAccount(user, 'Demo Bank', 'bank');

  if (isTransfer) {
    const target = toArg ? await namedAccount(user, toArg) : await ensureAccount(user, 'Demo Wallet', 'wallet');
    if (target._id.equals(bank._id)) usage('A transfer needs two different accounts.');
    await Transfer.create({
      user_id: user._id,
      from_account_id: bank._id,
      to_account_id: target._id,
      amount: amount.value,
      transfer_date: date,
      note: 'dev:spend demo transfer',
    });
    console.log(`Transferred ${amount.value} from ${bank.name} to ${target.name} on ${formatDateOnly(date)}.`);
  } else if (isIncome) {
    await Transaction.create({
      user_id: user._id,
      account_id: bank._id,
      type: 'income',
      amount: amount.value,
      currency: bank.currency,
      transaction_date: date,
      payment_mode: 'bank_transfer',
      note: 'dev:spend demo income',
    });
    console.log(`Added ${amount.value} income to ${bank.name} on ${formatDateOnly(date)}.`);
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
      currency: bank.currency,
      transaction_date: date,
      payment_mode: bank.type === 'credit_card' ? 'card' : 'upi',
      note: 'dev:spend demo expense',
      is_excluded_from_budget: excluded,
    });
    console.log(
      `Added ${amount.value} expense in ${category.name} from ${bank.name} on ${formatDateOnly(date)}` +
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
