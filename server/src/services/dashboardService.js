import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Budget from '../models/Budget.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';
import User from '../models/User.js';
import { accountSummary } from './balanceService.js';
import { spentForBudget, summarise } from './budgetService.js';
import { formatDateOnly, monthlyPeriod, today } from '../utils/period.js';

/**
 * Dashboard - US-20 (#34), SRS 5.8: REQ-69.
 *
 * For the current budget period (the month that starts on the user's month
 * start day, BR-14) the dashboard shows total income, total expense, net
 * savings and consolidated net worth, all in the base currency.
 *
 * Counting rules:
 *   - deleted transactions are left out
 *   - transfers between own accounts are never income or expense (BR-2,
 *     REQ-24); they live in the Transfer collection, so they are not counted
 *   - transactions marked "excluded from budgets" still count here: they are
 *     only left out of budget utilisation (REQ-33, REQ-50)
 *   - the amount converted to the base currency is used when there is one
 */

const ZERO = new Decimal(0);
const amountField = { $ifNull: ['$converted_amount', '$amount'] };

/** Income, expense and net savings from aggregated rows. Pure; unit tested. */
export function periodTotals(rows) {
  let income = ZERO;
  let expense = ZERO;
  for (const row of rows) {
    const total = new Decimal(row.total.toString());
    if (row._id === 'income') income = income.plus(total);
    if (row._id === 'expense') expense = expense.plus(total);
  }
  return {
    total_income: income.toFixed(2),
    total_expense: expense.toFixed(2),
    net_savings: income.minus(expense).toFixed(2),
  };
}

/**
 * Largest spending categories with their share of total expense.
 * Shares are rounded to one decimal place. Pure; unit tested.
 */
export function topCategories(rows, names, totalExpense, limit = 5) {
  const total = new Decimal(totalExpense);
  return rows
    .map((row) => ({
      category_id: row._id ? row._id.toString() : null,
      name: row._id ? (names.get(row._id.toString()) ?? 'Deleted category') : 'Uncategorised',
      amount: new Decimal(row.total.toString()),
    }))
    .sort((a, b) => b.amount.comparedTo(a.amount))
    .slice(0, limit)
    .map((c) => ({
      ...c,
      amount: c.amount.toFixed(2),
      share_percent: total.isZero()
        ? 0
        : Number(c.amount.dividedBy(total).times(100).toDecimalPlaces(1).toString()),
    }));
}

/** Everything the dashboard shows for one user. */
export async function dashboard(userId, baseCurrencyHint) {
  const onDay = today();
  const user = await User.findById(userId).select('base_currency month_start_day').lean();
  const baseCurrency = baseCurrencyHint || user?.base_currency || 'INR';
  const period = monthlyPeriod(onDay, user?.month_start_day || 1);

  const match = {
    user_id: new mongoose.Types.ObjectId(userId.toString()),
    is_deleted: { $ne: true },
    transaction_date: { $gte: period.start, $lte: period.end },
  };

  const [typeRows, categoryRows, accounts, budgets] = await Promise.all([
    Transaction.aggregate([
      { $match: match },
      { $group: { _id: '$type', total: { $sum: amountField } } },
    ]),
    Transaction.aggregate([
      { $match: { ...match, type: 'expense' } },
      { $group: { _id: '$category_id', total: { $sum: amountField } } },
    ]),
    accountSummary(userId, baseCurrency),
    Budget.find({ user_id: userId, period_start: { $lte: onDay }, period_end: { $gte: onDay } }).lean(),
  ]);

  const totals = periodTotals(typeRows);

  const categoryIds = [
    ...categoryRows.map((r) => r._id),
    ...budgets.map((b) => b.category_id),
  ].filter(Boolean);
  const categories = await Category.find({ _id: { $in: categoryIds } }).select('name').lean();
  const names = new Map(categories.map((c) => [c._id.toString(), c.name]));

  const budgetSummaries = [];
  for (const budget of budgets) {
    const spent = await spentForBudget(budget);
    const u = summarise(budget.amount, spent, { start: budget.period_start, end: budget.period_end }, onDay);
    budgetSummaries.push({
      id: budget._id.toString(),
      name: budget.category_id ? (names.get(budget.category_id.toString()) ?? 'Deleted category') : 'Overall spending',
      budgeted: u.budgeted,
      spent: u.spent,
      percent_used: u.percent_used,
      status: u.status,
    });
  }

  return {
    currency: baseCurrency,
    period: {
      start: formatDateOnly(period.start),
      end: formatDateOnly(period.end),
    },
    ...totals,
    net_worth: accounts.net_worth.net_worth,
    net_worth_detail: accounts.net_worth,
    top_categories: topCategories(categoryRows, names, totals.total_expense),
    budgets: budgetSummaries,
  };
}
