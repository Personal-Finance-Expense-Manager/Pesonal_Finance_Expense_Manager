import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';
import Account from '../models/Account.js';

/**
 * Spending charts - US-21 (#50), SRS 5.8: REQ-70, REQ-71, REQ-72.
 *
 * Counting rules are the ones used by the dashboard (US-20) and the totals
 * (US-13), so no two screens can disagree:
 *   - deleted transactions are left out
 *   - transfers between own accounts are never income or expense (BR-2) and
 *     live in their own collection, so they cannot appear here
 *   - transactions excluded from budgets still count: that flag changes budget
 *     utilisation only (REQ-33, REQ-50)
 *   - the base-currency amount is used wherever one was stored (BR-13)
 *
 * Nothing is cached. Every request recomputes from the transactions, so a
 * chart can never lag behind an add, edit or delete.
 */

const ZERO = new Decimal(0);
const amountField = { $ifNull: ['$converted_amount', '$amount'] };

/**
 * Apportion percentages that are required to add up to exactly 100.
 *
 * REQ-70 requires the breakdown's percentages to sum to 100. Rounding each
 * share on its own does not give that: three equal thirds each round to 33.3
 * and sum to 99.9, and other splits overshoot to 100.1. The largest-remainder
 * method rounds everything down first, then hands the leftover tenths to the
 * rows with the largest discarded remainder, so the published figures always
 * total exactly 100 while each one stays within a tenth of its true value.
 *
 * Takes and returns plain numbers of tenths of a percent so it is pure and can
 * be unit tested on its own.
 */
export function apportionPercentages(amounts, grandTotal) {
  const total = new Decimal(grandTotal);

  // With nothing to divide, every share is zero rather than NaN.
  if (total.isZero() || amounts.length === 0) {
    return amounts.map(() => 0);
  }

  // Work in tenths of a percent, so 1000 tenths is the whole.
  const exact = amounts.map((amount) =>
    new Decimal(amount).dividedBy(total).times(1000)
  );

  const floors = exact.map((value) => Math.floor(value.toNumber()));
  const used = floors.reduce((sum, value) => sum + value, 0);
  let remaining = 1000 - used;

  // Hand out the leftover tenths, largest discarded remainder first. A tie
  // goes to the earlier row, which is the larger amount because the caller
  // sorts descending - so the biggest slice absorbs the rounding.
  const order = exact
    .map((value, index) => ({
      index,
      remainder: value.minus(floors[index]).toNumber(),
    }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const result = [...floors];

  for (const entry of order) {
    if (remaining <= 0) break;
    result[entry.index] += 1;
    remaining -= 1;
  }

  return result.map((tenths) => Number((tenths / 10).toFixed(1)));
}

/**
 * The months a trend covers, oldest first, as {year, month} pairs.
 *
 * `months` is 6 or 12 (REQ-71) and `endDate` is the last month to include.
 * Pure, so the month arithmetic across a year boundary is unit tested.
 */
export function trendMonths(endDate, months) {
  const result = [];
  const year = endDate.getUTCFullYear();
  const month = endDate.getUTCMonth();

  for (let back = months - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(year, month - back, 1));
    result.push({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
      start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
      end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
    });
  }

  return result;
}

/**
 * Category-wise expense breakdown for the period - REQ-70.
 *
 * Returns the slices for the donut and the rows for the table beside it; they
 * are the same figures, so the chart and the table can never disagree.
 */
async function categoryBreakdown(uid, from, to) {
  const rows = await Transaction.aggregate([
    {
      $match: {
        user_id: uid,
        type: 'expense',
        is_deleted: { $ne: true },
        transaction_date: { $gte: from, $lte: to },
      },
    },
    { $group: { _id: '$category_id', total: { $sum: amountField }, count: { $sum: 1 } } },
  ]);

  const grandTotal = rows
    .reduce((acc, row) => acc.plus(new Decimal(row.total.toString())), ZERO)
    .toFixed(2);

  const categories = await Category.find({
    _id: { $in: rows.map((r) => r._id).filter(Boolean) },
  })
    .select('name colour')
    .lean();

  const names = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const colours = new Map(categories.map((c) => [c._id.toString(), c.colour]));

  const sorted = rows
    .map((row) => ({
      id: row._id ? row._id.toString() : null,
      name: row._id ? (names.get(row._id.toString()) ?? 'Deleted') : 'Uncategorised',
      colour: row._id ? (colours.get(row._id.toString()) ?? null) : null,
      amount: new Decimal(row.total.toString()),
      transaction_count: row.count,
    }))
    .sort((a, b) => b.amount.comparedTo(a.amount));

  const shares = apportionPercentages(
    sorted.map((row) => row.amount.toString()),
    grandTotal
  );

  return {
    grand_total: grandTotal,
    transaction_count: sorted.reduce((sum, row) => sum + row.transaction_count, 0),
    slices: sorted.map((row, index) => ({
      id: row.id,
      name: row.name,
      colour: row.colour,
      amount: row.amount.toFixed(2),
      transaction_count: row.transaction_count,
      share_percent: shares[index],
    })),
  };
}

/**
 * Income against expense for the last six or twelve months - REQ-71.
 *
 * Every month in the window is returned, including months with nothing in
 * them, so the chart has an unbroken axis rather than a gap.
 */
async function incomeExpenseTrend(uid, endDate, months) {
  const window = trendMonths(endDate, months);
  const from = window[0].start;
  const to = window[window.length - 1].end;

  const rows = await Transaction.aggregate([
    {
      $match: {
        user_id: uid,
        type: { $in: ['income', 'expense'] },
        is_deleted: { $ne: true },
        transaction_date: { $gte: from, $lte: to },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: '$transaction_date' },
          month: { $month: '$transaction_date' },
          type: '$type',
        },
        total: { $sum: amountField },
      },
    },
  ]);

  const byKey = new Map();
  for (const row of rows) {
    const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`;
    const entry = byKey.get(key) || { income: ZERO, expense: ZERO };
    entry[row._id.type] = new Decimal(row.total.toString());
    byKey.set(key, entry);
  }

  return window.map((month) => {
    const entry = byKey.get(month.key) || { income: ZERO, expense: ZERO };
    const income = new Decimal(entry.income);
    const expense = new Decimal(entry.expense);

    return {
      key: month.key,
      label: month.label,
      income: income.toFixed(2),
      expense: expense.toFixed(2),
      net: income.minus(expense).toFixed(2),
    };
  });
}

/**
 * The five largest expenses of the period - REQ-72.
 *
 * The account and category are resolved so the list reads without a second
 * request from the client.
 */
async function largestTransactions(uid, from, to, limit = 5) {
  const rows = await Transaction.aggregate([
    {
      $match: {
        user_id: uid,
        type: 'expense',
        is_deleted: { $ne: true },
        transaction_date: { $gte: from, $lte: to },
      },
    },
    { $project: { amount: amountField, transaction_date: 1, note: 1, category_id: 1, account_id: 1 } },
    { $sort: { amount: -1, transaction_date: -1 } },
    { $limit: limit },
  ]);

  const categories = await Category.find({
    _id: { $in: rows.map((r) => r.category_id).filter(Boolean) },
  })
    .select('name')
    .lean();

  const accounts = await Account.find({
    _id: { $in: rows.map((r) => r.account_id).filter(Boolean) },
  })
    .select('name')
    .lean();

  const categoryNames = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const accountNames = new Map(accounts.map((a) => [a._id.toString(), a.name]));

  return rows.map((row) => ({
    id: row._id.toString(),
    amount: new Decimal(row.amount.toString()).toFixed(2),
    transaction_date: row.transaction_date,
    note: row.note || '',
    category_name: row.category_id
      ? (categoryNames.get(row.category_id.toString()) ?? 'Deleted')
      : 'Uncategorised',
    account_name: row.account_id
      ? (accountNames.get(row.account_id.toString()) ?? 'Deleted')
      : '',
  }));
}

/**
 * Everything US-21 draws, for one user over one period.
 *
 * `months` selects the trend window and must be 6 or 12 (REQ-71). The caller
 * validates it; this function trusts what it is given.
 */
export async function chartsForPeriod(userId, { from, to, months = 6 }) {
  const uid = new mongoose.Types.ObjectId(userId);

  const [breakdown, trend, largest] = await Promise.all([
    categoryBreakdown(uid, from, to),
    incomeExpenseTrend(uid, to, months),
    largestTransactions(uid, from, to),
  ]);

  return {
    from,
    to,
    trend_months: months,
    by_category: breakdown.slices,
    grand_total: breakdown.grand_total,
    transaction_count: breakdown.transaction_count,
    // REQ-72: the five largest categories are the head of the same ordered
    // breakdown, so the panel and the chart cannot disagree.
    top_categories: breakdown.slices.slice(0, 5),
    largest_transactions: largest,
    trend,
  };
}
