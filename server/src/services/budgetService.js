import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Budget from '../models/Budget.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';
import { daysLeft, formatDateOnly } from '../utils/period.js';

/**
 * Budget utilisation (US-14, #35): REQ-44, REQ-45, REQ-50, REQ-51.
 *
 * Utilisation is calculated from the transactions every time it is asked
 * for, never cached. That is how REQ-51 ("refresh within five seconds of a
 * transaction change") is met: the next read already reflects the change.
 */

/** Find a budget for the same user and category whose period overlaps (REQ-44). */
export function findOverlappingBudget(userId, categoryId, period) {
  return Budget.findOne({
    user_id: userId,
    category_id: categoryId ?? null,
    period_start: { $lte: period.end },
    period_end: { $gte: period.start },
  }).lean();
}

/** The category id plus the ids of its sub-categories. */
async function categoryWithChildren(categoryId) {
  const children = await Category.find({ parent_category_id: categoryId }).select('_id').lean();
  return [new mongoose.Types.ObjectId(categoryId), ...children.map((c) => c._id)];
}

/**
 * Total spent against a budget.
 *
 * Counts expenses in the period for the budget's category (or every category
 * for an overall budget). Leaves out (REQ-50):
 *   - transactions marked "excluded from budgets"
 *   - transfers between the user's own accounts, which are stored in the
 *     Transfer collection and so are never expenses here
 *   - deleted transactions
 * Uses the amount converted to the base currency when there is one.
 */
export async function spentForBudget(budget) {
  const match = {
    user_id: new mongoose.Types.ObjectId(budget.user_id.toString()),
    type: 'expense',
    is_deleted: { $ne: true },
    is_excluded_from_budget: { $ne: true },
    transaction_date: { $gte: budget.period_start, $lte: budget.period_end },
  };

  if (budget.category_id) {
    match.category_id = { $in: await categoryWithChildren(budget.category_id.toString()) };
  }

  const [row] = await Transaction.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$converted_amount', '$amount'] } } } },
  ]);

  return new Decimal(row ? row.total.toString() : '0');
}

/**
 * Turn a budget plus its spent amount into the figures REQ-45 asks for.
 * Pure function; unit tested.
 */
export function summarise(amount, spent, period, onDay) {
  const budgeted = new Decimal(amount.toString());
  const used = new Decimal(spent.toString());
  const remaining = budgeted.minus(used);
  const percent = budgeted.isZero() ? new Decimal(0) : used.dividedBy(budgeted).times(100);

  return {
    budgeted: budgeted.toFixed(2),
    spent: used.toFixed(2),
    remaining: remaining.toFixed(2),
    percent_used: Number(percent.toDecimalPlaces(1).toString()),
    days_left: daysLeft(period, onDay),
    status: percent.greaterThanOrEqualTo(100)
      ? 'over'
      : percent.greaterThanOrEqualTo(80) ? 'warning' : 'ok',
  };
}

/** Shape a budget document plus utilisation for the client. */
export function present(budget, category, utilisation, onDay) {
  return {
    id: budget._id.toString(),
    category_id: budget.category_id ? budget.category_id.toString() : null,
    category_name: budget.category_id ? (category?.name ?? 'Deleted category') : 'Overall spending',
    period_type: budget.period_type,
    period_start: formatDateOnly(budget.period_start),
    period_end: formatDateOnly(budget.period_end),
    is_active: budget.period_end.getTime() >= onDay.getTime(),
    ...utilisation,
  };
}
