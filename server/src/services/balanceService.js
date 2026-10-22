import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Account from '../models/Account.js';
import Transaction from '../models/Transaction.js';
import Transfer from '../models/Transfer.js';
import { formatDateOnly, today } from '../utils/period.js';

/**
 * Account balances, net worth and credit card position - US-07 (#21),
 * SRS 5.2: REQ-19, REQ-20, REQ-21; BR-2, BR-3, DR-5.
 *
 * Balances are never stored (BR-3). They are worked out from the opening
 * balance and the transactions every time they are asked for, so the next
 * read after any transaction change already shows the new figure (REQ-19,
 * "within two seconds").
 */

const ZERO = new Decimal(0);
const CARD_WARNING_PERCENT = 80;

const d = (value) => (value == null ? ZERO : new Decimal(value.toString()));

/**
 * Current balance of one account. Pure function; unit tested.
 *
 * Asset accounts (cash, bank, wallet):
 *   opening + income - expenses - transfers out + transfers in
 *
 * Credit cards hold an *outstanding amount* (money owed), so the signs flip:
 *   opening outstanding + expenses - income (payments, refunds)
 *   + transfers out (cash withdrawn) - transfers in (bill payments)
 *
 * @param sums { income, expense, transfersIn, transfersOut } for the account
 */
export function computeBalance(account, sums = {}) {
  const opening = d(account.opening_balance);
  const income = d(sums.income);
  const expense = d(sums.expense);
  const transfersIn = d(sums.transfersIn);
  const transfersOut = d(sums.transfersOut);

  if (account.type === 'credit_card') {
    return opening.plus(expense).minus(income).plus(transfersOut).minus(transfersIn);
  }
  return opening.plus(income).minus(expense).minus(transfersOut).plus(transfersIn);
}

/**
 * Next statement due date on or after `onDay` for a due day of the month.
 * In shorter months a due day of 29-31 falls on the month's last day.
 */
export function nextDueDate(dueDay, onDay) {
  if (!dueDay) return null;
  const pick = (year, month) => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(dueDay, lastDay)));
  };
  const y = onDay.getUTCFullYear();
  const m = onDay.getUTCMonth();
  const thisMonth = pick(y, m);
  return thisMonth.getTime() >= onDay.getTime() ? thisMonth : pick(y, m + 1);
}

/**
 * Credit card position (REQ-21). Pure function; unit tested.
 * The warning is shown when the outstanding amount *exceeds* 80% of the limit.
 */
export function cardPosition(outstanding, creditLimit, dueDay, onDay) {
  const owed = d(outstanding);
  const limit = d(creditLimit);
  const available = limit.minus(owed);
  const percent = limit.greaterThan(0) ? owed.dividedBy(limit).times(100) : ZERO;
  const due = nextDueDate(dueDay, onDay);

  return {
    outstanding: owed.toFixed(2),
    credit_limit: limit.toFixed(2),
    available_credit: (available.isNegative() ? ZERO : available).toFixed(2),
    over_limit_by: (available.isNegative() ? available.negated() : ZERO).toFixed(2),
    utilisation_percent: Number(percent.toDecimalPlaces(1).toString()),
    statement_due_day: dueDay ?? null,
    next_statement_due_date: due ? formatDateOnly(due) : null,
    high_utilisation_warning: limit.greaterThan(0) && percent.greaterThan(CARD_WARNING_PERCENT),
  };
}

/**
 * Net worth (REQ-20, DR-5): asset balances minus credit card outstanding, in
 * the user's base currency. Accounts in another currency cannot be added
 * without an exchange rate, so they are left out and listed separately.
 * Archived accounts still count: they hold real money, they are only hidden
 * from new transactions. Pure function; unit tested.
 */
export function netWorth(accountsWithBalances, baseCurrency) {
  let assets = ZERO;
  let liabilities = ZERO;
  const leftOut = [];

  for (const { account, balance } of accountsWithBalances) {
    if (account.currency !== baseCurrency) {
      leftOut.push({ id: account._id.toString(), name: account.name, currency: account.currency });
    } else if (account.type === 'credit_card') {
      liabilities = liabilities.plus(balance);
    } else {
      assets = assets.plus(balance);
    }
  }

  return {
    currency: baseCurrency,
    total_assets: assets.toFixed(2),
    total_liabilities: liabilities.toFixed(2),
    net_worth: assets.minus(liabilities).toFixed(2),
    accounts_not_included: leftOut,
  };
}

/** Sum of transactions and transfers per account for one user. */
async function sumsByAccount(userId) {
  const user = new mongoose.Types.ObjectId(userId.toString());

  const [transactions, outgoing, incoming] = await Promise.all([
    Transaction.aggregate([
      { $match: { user_id: user, is_deleted: { $ne: true } } },
      { $group: { _id: { account: '$account_id', type: '$type' }, total: { $sum: '$amount' } } },
    ]),
    Transfer.aggregate([
      { $match: { user_id: user, is_deleted: { $ne: true } } },
      { $group: { _id: '$from_account_id', total: { $sum: '$amount' } } },
    ]),
    Transfer.aggregate([
      { $match: { user_id: user, is_deleted: { $ne: true } } },
      { $group: { _id: '$to_account_id', total: { $sum: '$amount' } } },
    ]),
  ]);

  const sums = new Map();
  const get = (id) => {
    const key = id.toString();
    if (!sums.has(key)) sums.set(key, {});
    return sums.get(key);
  };

  for (const row of transactions) get(row._id.account)[row._id.type] = row.total;
  for (const row of outgoing) get(row._id).transfersOut = row.total;
  for (const row of incoming) get(row._id).transfersIn = row.total;

  return sums;
}

/**
 * Everything US-07 shows, for one user: each account's current balance,
 * card positions and net worth. Used by GET /api/accounts and
 * GET /api/accounts/summary, and by the dashboard (US-20).
 */
export async function accountSummary(userId, baseCurrency = 'INR', { includeArchived = true } = {}) {
  const onDay = today();
  const [accounts, sums] = await Promise.all([
    Account.find({ user_id: userId }).lean(),
    sumsByAccount(userId),
  ]);

  const withBalances = accounts.map((account) => ({
    account,
    balance: computeBalance(account, sums.get(account._id.toString())),
  }));

  const balances = withBalances
    .filter(({ account }) => includeArchived || !account.is_archived)
    .map(({ account, balance }) => ({
      id: account._id.toString(),
      current_balance: balance.toFixed(2),
      card: account.type === 'credit_card'
        ? cardPosition(balance, account.credit_limit, account.statement_due_day, onDay)
        : null,
    }));

  return { balances, net_worth: netWorth(withBalances, baseCurrency) };
}
