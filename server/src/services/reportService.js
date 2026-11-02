import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';

/**
 * Period reports - US-22 (#51), SRS 5.8: REQ-73 to REQ-78.
 *
 * Builds on the charts of US-21 (#50) and keeps the same counting rules as the
 * dashboard (US-20) and the totals (US-13), so no two screens disagree:
 *   - deleted transactions are left out
 *   - transfers between own accounts are never income or expense (BR-2)
 *   - transactions excluded from budgets still count: that flag changes budget
 *     utilisation only (REQ-33, REQ-50)
 *   - the base-currency amount is used wherever one was stored (BR-13)
 *
 * Nothing is cached. Every request recomputes, so a report cannot lag behind
 * an add, edit or delete.
 */

const ZERO = new Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;
const amountField = { $ifNull: ['$converted_amount', '$amount'] };

/**
 * Whole days in an inclusive date range. A single day is one day, not zero,
 * so the average daily spend of a one-day period is that day's spending.
 */
export function daysInPeriod(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

/**
 * The difference between two amounts, in money and as a percentage - REQ-75.
 *
 * The percentage is of the earlier figure, so it reads as "spending rose by
 * 20% against last month". Growth from nothing has no meaningful percentage:
 * `percent` is null in that case rather than infinity, and the caller shows
 * the money difference on its own.
 *
 * `direction` is 'up', 'down' or 'same', so increases and decreases are
 * distinguished without the client re-deriving it from the sign.
 */
export function difference(current, previous) {
  const now = new Decimal(current);
  const before = new Decimal(previous);
  const delta = now.minus(before);

  let percent = null;

  if (!before.isZero()) {
    percent = Number(delta.dividedBy(before.abs()).times(100).toDecimalPlaces(1).toString());
  }

  return {
    amount: delta.toFixed(2),
    percent,
    direction: delta.isZero() ? 'same' : delta.isPositive() ? 'up' : 'down',
  };
}

/**
 * Average daily spend and the projected period total - REQ-76.
 *
 * The projection is the average so far times the length of the period. While
 * the period is still running, "so far" means up to `asOf`, because dividing
 * by days that have not happened would understate the average and project a
 * total that only falls as the period goes on.
 *
 * A period entirely in the past is already complete: the projection is then
 * the actual total, and `is_complete` says so.
 */
export function projectTotal(total, from, to, asOf) {
  const spent = new Decimal(total);
  const totalDays = daysInPeriod(from, to);

  const lastCountedDay = asOf < to ? asOf : to;
  const elapsedDays = Math.min(
    Math.max(daysInPeriod(from, lastCountedDay), 1),
    totalDays
  );

  const isComplete = asOf >= to;
  const averagePerDay = spent.dividedBy(elapsedDays);

  return {
    total_days: totalDays,
    elapsed_days: elapsedDays,
    is_complete: isComplete,
    average_daily_spend: averagePerDay.toDecimalPlaces(2).toFixed(2),
    projected_total: isComplete
      ? spent.toFixed(2)
      : averagePerDay.times(totalDays).toDecimalPlaces(2).toFixed(2),
  };
}

/** Expense totals per category for one range, as a Map keyed by category id. */
async function expensesByCategory(uid, from, to) {
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

  const byId = new Map();
  let total = ZERO;
  let count = 0;

  for (const row of rows) {
    const key = row._id ? row._id.toString() : 'none';
    const amount = new Decimal(row.total.toString());
    byId.set(key, { amount, count: row.count, id: row._id || null });
    total = total.plus(amount);
    count += row.count;
  }

  return { byId, total, count };
}

/** Income and expense totals for one range. */
async function totalsFor(uid, from, to) {
  const rows = await Transaction.aggregate([
    {
      $match: {
        user_id: uid,
        type: { $in: ['income', 'expense'] },
        is_deleted: { $ne: true },
        transaction_date: { $gte: from, $lte: to },
      },
    },
    { $group: { _id: '$type', total: { $sum: amountField }, count: { $sum: 1 } } },
  ]);

  const found = new Map(rows.map((r) => [r._id, r]));
  const income = new Decimal((found.get('income')?.total ?? 0).toString());
  const expense = new Decimal((found.get('expense')?.total ?? 0).toString());

  return {
    total_income: income.toFixed(2),
    total_expense: expense.toFixed(2),
    net: income.minus(expense).toFixed(2),
    transaction_count:
      (found.get('income')?.count ?? 0) + (found.get('expense')?.count ?? 0),
  };
}

/**
 * A report for any date range, optionally compared with a second range.
 *
 * REQ-73 - every figure is computed for exactly the range given.
 * REQ-75 - when `compare` is supplied, the totals and every category carry
 *          their difference in money and percent, with a direction.
 * REQ-76 - the average daily spend and the projected period total.
 */
export async function reportForPeriod(userId, { from, to, compare = null, asOf = new Date() }) {
  const uid = new mongoose.Types.ObjectId(userId);

  const [totals, current] = await Promise.all([
    totalsFor(uid, from, to),
    expensesByCategory(uid, from, to),
  ]);

  const previous = compare ? await expensesByCategory(uid, compare.from, compare.to) : null;
  const previousTotals = compare ? await totalsFor(uid, compare.from, compare.to) : null;

  // Every category that appears in either period, so one that stopped being
  // used still shows as a fall rather than vanishing from the comparison.
  const keys = new Set([...current.byId.keys(), ...(previous ? previous.byId.keys() : [])]);

  const ids = [...keys].filter((k) => k !== 'none').map((k) => new mongoose.Types.ObjectId(k));
  const categories = await Category.find({ _id: { $in: ids } }).select('name').lean();
  const names = new Map(categories.map((c) => [c._id.toString(), c.name]));

  const rows = [...keys]
    .map((key) => {
      const now = current.byId.get(key);
      const before = previous ? previous.byId.get(key) : null;
      const amount = now ? now.amount : ZERO;

      const row = {
        id: key === 'none' ? null : key,
        name: key === 'none' ? 'Uncategorised' : (names.get(key) ?? 'Deleted'),
        amount: amount.toFixed(2),
        transaction_count: now ? now.count : 0,
        share_percent: current.total.isZero()
          ? 0
          : Number(amount.dividedBy(current.total).times(100).toDecimalPlaces(1).toString()),
      };

      if (previous) {
        const previousAmount = before ? before.amount : ZERO;
        row.previous_amount = previousAmount.toFixed(2);
        row.change = difference(amount.toString(), previousAmount.toString());
      }

      return row;
    })
    .sort((a, b) => new Decimal(b.amount).comparedTo(new Decimal(a.amount)));

  const report = {
    from,
    to,
    ...totals,
    by_category: rows,
    projection: projectTotal(current.total.toString(), from, to, asOf),
  };

  if (compare) {
    report.compare = {
      from: compare.from,
      to: compare.to,
      ...previousTotals,
      change: {
        total_expense: difference(totals.total_expense, previousTotals.total_expense),
        total_income: difference(totals.total_income, previousTotals.total_income),
        net: difference(totals.net, previousTotals.net),
      },
    };
  }

  return report;
}

/**
 * The report as CSV - REQ-77.
 *
 * The rows are the ones on screen and carry the same figures, so an export can
 * never disagree with what was displayed.
 */
export function reportToCsvRows(report) {
  const comparing = Boolean(report.compare);

  const header = comparing
    ? ['category', 'amount', 'share_percent', 'transaction_count', 'previous_amount', 'change_amount', 'change_percent', 'direction']
    : ['category', 'amount', 'share_percent', 'transaction_count'];

  const rows = report.by_category.map((row) =>
    comparing
      ? [
          row.name,
          row.amount,
          row.share_percent,
          row.transaction_count,
          row.previous_amount,
          row.change.amount,
          row.change.percent === null ? '' : row.change.percent,
          row.change.direction,
        ]
      : [row.name, row.amount, row.share_percent, row.transaction_count]
  );

  return [header, ...rows];
}
