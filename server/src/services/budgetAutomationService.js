
import Decimal from 'decimal.js';
import Budget from '../models/Budget.js';
import User from '../models/User.js';
import {
  spentForBudget,
  findOverlappingBudget,
} from './budgetService.js';
import {
  today,
  monthlyPeriod,
  weeklyPeriod,
  customPeriod,
  periodLength,
} from '../utils/period.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function nextPeriod(budget, monthStartDay) {
  const end = budget.period_end;

  const nextStart = new Date(Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate() + 1,
  ));

  if (budget.period_type === 'monthly') {
    return monthlyPeriod(nextStart, monthStartDay);
  }

  if (budget.period_type === 'weekly') {
    return weeklyPeriod(nextStart);
  }

  if (budget.period_type === 'custom') {
    const days = periodLength({
      start: budget.period_start,
      end: budget.period_end,
    });

    const nextEnd = new Date(
      nextStart.getTime() + (days - 1) * DAY_MS,
    );

    return customPeriod(nextStart, nextEnd);
  }

  return null;
}

/**
 * US-15 / REQ-48 and REQ-49.
 * Generate the next budget once the previous period has ended.
 */
export async function processBudgetAutomation(onDay = today()) {
  const expiredBudgets = await Budget.find({
    period_end: { $lt: onDay },
    $or: [
      { rollover_enabled: true },
      { repeat_enabled: true },
    ],
  }).lean();

  let created = 0;
  let skipped = 0;

  for (const budget of expiredBudgets) {
    try {
      // The unique source reference makes this operation idempotent.
      const alreadyGenerated = await Budget.findOne({
        generated_from_budget_id: budget._id,
      }).lean();

      if (alreadyGenerated) {
        skipped += 1;
        continue;
      }

      const user = await User.findById(budget.user_id)
        .select('month_start_day')
        .lean();

      const next = nextPeriod(
        budget,
        user?.month_start_day || 1,
      );

      if (!next) {
        skipped += 1;
        continue;
      }

      const overlap = await findOverlappingBudget(
        budget.user_id,
        budget.category_id,
        next,
      );

      if (overlap) {
        skipped += 1;
        continue;
      }

      const originalAmount = new Decimal(
        budget.amount.toString(),
      );

      let nextAmount = originalAmount;

      if (budget.rollover_enabled) {
        const spent = await spentForBudget(budget);
        const unused = originalAmount.minus(spent);

        // Only positive unused funds are carried forward.
        const carryForward = Decimal.max(unused, 0);
        nextAmount = originalAmount.plus(carryForward);
      }

      await Budget.create({
        user_id: budget.user_id,
        category_id: budget.category_id,
        amount: nextAmount.toFixed(2),
        period_type: budget.period_type,
        period_start: next.start,
        period_end: next.end,
        rollover_enabled: budget.rollover_enabled,
        repeat_enabled: budget.repeat_enabled,
        generated_from_budget_id: budget._id,
      });

      created += 1;
    } catch (error) {
      // A duplicate-key error can happen if another server instance
      // generated the same budget at the same time.
      if (error.code === 11000) {
        skipped += 1;
        continue;
      }

      console.error(
        `[budget-automation] Failed for ${budget._id}:`,
        error.message,
      );
    }
  }

  return { created, skipped };
}
