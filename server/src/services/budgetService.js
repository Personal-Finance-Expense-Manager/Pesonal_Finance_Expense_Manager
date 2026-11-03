
import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import { amountForCategoriesStages } from './splitAttribution.js';
import Budget from '../models/Budget.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';
import { daysLeft, formatDateOnly } from '../utils/period.js';

/**
 * Budget utilisation (US-14, #35): REQ-44, REQ-45, REQ-50, REQ-51.
 * US-15 (#36): REQ-47, REQ-48, REQ-49.
 *
 * Utilisation is calculated from transactions every time it is requested.
 */

/** Find an overlapping budget for the same user and category. */
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
  const children = await Category.find({
    parent_category_id: categoryId,
  }).select('_id').lean();

  return [
    new mongoose.Types.ObjectId(categoryId),
    ...children.map((c) => c._id),
  ];
}

/**
 * Total spent against a budget.
 * Excludes deleted transactions, excluded transactions and transfers.
 */
export async function spentForBudget(budget) {
  const match = {
    user_id: new mongoose.Types.ObjectId(budget.user_id.toString()),
    type: 'expense',
    is_deleted: { $ne: true },
    is_excluded_from_budget: { $ne: true },
    transaction_date: {
      $gte: budget.period_start,
      $lte: budget.period_end,
    },
  };

  const categoryIds = budget.category_id
    ? await categoryWithChildren(budget.category_id.toString())
    : null;

  const [row] = await Transaction.aggregate([
    { $match: match },
    ...amountForCategoriesStages(categoryIds),
    { $group: { _id: null, total: { $sum: '$part_amount' } } },
  ]);

  return new Decimal(row ? row.total.toString() : '0');
}

/**
 * Turn a budget plus its spent amount into utilisation figures.
 */
export function summarise(amount, spent, period, onDay) {
  const budgeted = new Decimal(amount.toString());
  const used = new Decimal(spent.toString());
  const remaining = budgeted.minus(used);

  const percent = budgeted.isZero()
    ? new Decimal(0)
    : used.dividedBy(budgeted).times(100);

  return {
    budgeted: budgeted.toFixed(2),
    spent: used.toFixed(2),
    remaining: remaining.toFixed(2),
    percent_used: Number(percent.toDecimalPlaces(1).toString()),
    days_left: daysLeft(period, onDay),
    status: percent.greaterThanOrEqualTo(100)
      ? 'over'
      : percent.greaterThanOrEqualTo(80)
        ? 'warning'
        : 'ok',
  };
}

/** Shape a budget document plus utilisation for the client. */
export function present(budget, category, utilisation, onDay) {
  return {
    id: budget._id.toString(),
    category_id: budget.category_id
      ? budget.category_id.toString()
      : null,
    category_name: budget.category_id
      ? (category?.name ?? 'Deleted category')
      : 'Overall spending',
    period_type: budget.period_type,
    period_start: formatDateOnly(budget.period_start),
    period_end: formatDateOnly(budget.period_end),

    // US-15: expose budget automation settings to the frontend.
    rollover_enabled: budget.rollover_enabled ?? false,
    repeat_enabled: budget.repeat_enabled ?? false,

    is_active: budget.period_end.getTime() >= onDay.getTime(),
    ...utilisation,
  };
}
