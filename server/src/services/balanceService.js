import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Account from '../models/Account.js';
import Transaction from '../models/Transaction.js';
import Transfer from '../models/Transfer.js';
import GoalContribution from '../models/GoalContribution.js';
import GoalWithdrawal from '../models/GoalWithdrawal.js';
import { formatDateOnly, today } from '../utils/period.js';

const ZERO = new Decimal(0);
const CARD_WARNING_PERCENT = 80;

const d = (value) => (
  value == null ? ZERO : new Decimal(value.toString())
);

/**
 * Current account balance.
 *
 * Asset accounts:
 * opening + income - expenses - transfers out + transfers in
 * - goal contributions + goal withdrawals
 *
 * Credit cards:
 * opening outstanding + expenses - income
 * + transfers out - transfers in
 */
export function computeBalance(account, sums = {}) {
  const opening = d(account.opening_balance);
  const income = d(sums.income);
  const expense = d(sums.expense);
  const transfersIn = d(sums.transfersIn);
  const transfersOut = d(sums.transfersOut);
  const goalContributions = d(sums.goalContributions);
  const goalWithdrawals = d(sums.goalWithdrawals);

  if (account.type === 'credit_card') {
    return opening
      .plus(expense)
      .minus(income)
      .plus(transfersOut)
      .minus(transfersIn);
  }

  return opening
    .plus(income)
    .minus(expense)
    .minus(transfersOut)
    .plus(transfersIn)
    .minus(goalContributions)
    .plus(goalWithdrawals);
}

/**
 * Next statement due date on or after onDay.
 */
export function nextDueDate(dueDay, onDay) {
  if (!dueDay) return null;

  const pick = (year, month) => {
    const lastDay = new Date(
      Date.UTC(year, month + 1, 0),
    ).getUTCDate();

    return new Date(
      Date.UTC(year, month, Math.min(dueDay, lastDay)),
    );
  };

  const y = onDay.getUTCFullYear();
  const m = onDay.getUTCMonth();

  const thisMonth = pick(y, m);

  return thisMonth.getTime() >= onDay.getTime()
    ? thisMonth
    : pick(y, m + 1);
}

/**
 * Credit card position and utilisation.
 */
export function cardPosition(outstanding, creditLimit, dueDay, onDay) {
  const owed = d(outstanding);
  const limit = d(creditLimit);
  const available = limit.minus(owed);

  const percent = limit.greaterThan(0)
    ? owed.dividedBy(limit).times(100)
    : ZERO;

  const due = nextDueDate(dueDay, onDay);

  return {
    outstanding: owed.toFixed(2),
    credit_limit: limit.toFixed(2),
    available_credit: (
      available.isNegative() ? ZERO : available
    ).toFixed(2),
    over_limit_by: (
      available.isNegative() ? available.negated() : ZERO
    ).toFixed(2),
    utilisation_percent: Number(
      percent.toDecimalPlaces(1).toString(),
    ),
    statement_due_day: dueDay ?? null,
    next_statement_due_date: due
      ? formatDateOnly(due)
      : null,
    high_utilisation_warning:
      limit.greaterThan(0) &&
      percent.greaterThan(CARD_WARNING_PERCENT),
  };
}

/**
 * Net worth = account assets + net savings goal balance
 * - credit card outstanding.
 */
export function netWorth(
  accountsWithBalances,
  baseCurrency,
  goalSavings = '0',
) {
  let assets = d(goalSavings);
  let liabilities = ZERO;

  const leftOut = [];

  for (const { account, balance } of accountsWithBalances) {
    if (account.currency !== baseCurrency) {
      leftOut.push({
        id: account._id.toString(),
        name: account.name,
        currency: account.currency,
      });
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

/**
 * Sum transactions, transfers, contributions and withdrawals per account.
 */
async function sumsByAccount(userId) {
  const user = new mongoose.Types.ObjectId(userId.toString());

  const [
    transactions,
    outgoing,
    incoming,
    contributions,
    withdrawals,
  ] = await Promise.all([
    Transaction.aggregate([
      {
        $match: {
          user_id: user,
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: {
            account: '$account_id',
            type: '$type',
          },
          total: { $sum: '$amount' },
        },
      },
    ]),

    Transfer.aggregate([
      {
        $match: {
          user_id: user,
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: '$from_account_id',
          total: { $sum: '$amount' },
        },
      },
    ]),

    Transfer.aggregate([
      {
        $match: {
          user_id: user,
          is_deleted: { $ne: true },
        },
      },
      {
        $group: {
          _id: '$to_account_id',
          total: { $sum: '$amount' },
        },
      },
    ]),

    GoalContribution.aggregate([
      {
        $match: { user_id: user },
      },
      {
        $group: {
          _id: '$source_account_id',
          total: { $sum: '$amount' },
        },
      },
    ]),

    GoalWithdrawal.aggregate([
      {
        $match: { user_id: user },
      },
      {
        $group: {
          _id: '$destination_account_id',
          total: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const sums = new Map();

  const get = (id) => {
    const key = id.toString();

    if (!sums.has(key)) {
      sums.set(key, {});
    }

    return sums.get(key);
  };

  for (const row of transactions) {
    get(row._id.account)[row._id.type] = row.total;
  }

  for (const row of outgoing) {
    get(row._id).transfersOut = row.total;
  }

  for (const row of incoming) {
    get(row._id).transfersIn = row.total;
  }

  for (const row of contributions) {
    get(row._id).goalContributions = row.total;
  }

  for (const row of withdrawals) {
    get(row._id).goalWithdrawals = row.total;
  }

  return sums;
}

/**
 * Calculate net savings in the user's base currency.
 * Net savings = contributions - withdrawals.
 */
async function savingsInBaseCurrency(userId, baseCurrency) {
  const user = new mongoose.Types.ObjectId(userId.toString());

  const [contributions, withdrawals] = await Promise.all([
    GoalContribution.aggregate([
      {
        $match: { user_id: user },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'source_account_id',
          foreignField: '_id',
          as: 'sourceAccount',
        },
      },
      {
        $unwind: '$sourceAccount',
      },
      {
        $match: {
          'sourceAccount.currency': baseCurrency,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]),

    GoalWithdrawal.aggregate([
      {
        $match: { user_id: user },
      },
      {
        $lookup: {
          from: 'accounts',
          localField: 'destination_account_id',
          foreignField: '_id',
          as: 'destinationAccount',
        },
      },
      {
        $unwind: '$destinationAccount',
      },
      {
        $match: {
          'destinationAccount.currency': baseCurrency,
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const contributed = d(contributions[0]?.total);
  const withdrawn = d(withdrawals[0]?.total);

  return contributed.minus(withdrawn).toFixed(2);
}

/**
 * Account balances, credit card positions and net worth.
 */
export async function accountSummary(
  userId,
  baseCurrency = 'INR',
  { includeArchived = true } = {},
) {
  const onDay = today();

  const [
    accounts,
    sums,
    goalSavings,
  ] = await Promise.all([
    Account.find({ user_id: userId }).lean(),
    sumsByAccount(userId),
    savingsInBaseCurrency(userId, baseCurrency),
  ]);

  const withBalances = accounts.map((account) => ({
    account,
    balance: computeBalance(
      account,
      sums.get(account._id.toString()),
    ),
  }));

  const balances = withBalances
    .filter(({ account }) => (
      includeArchived || !account.is_archived
    ))
    .map(({ account, balance }) => ({
      id: account._id.toString(),
      current_balance: balance.toFixed(2),
      card: account.type === 'credit_card'
        ? cardPosition(
          balance,
          account.credit_limit,
          account.statement_due_day,
          onDay,
        )
        : null,
    }));

  return {
    balances,
    net_worth: netWorth(
      withBalances,
      baseCurrency,
      goalSavings,
    ),
  };
}