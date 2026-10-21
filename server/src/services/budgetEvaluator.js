import Budget from '../models/Budget.js';
import Category from '../models/Category.js';
import Notification from '../models/Notification.js';
import { spentForBudget, summarise } from './budgetService.js';
import { today } from '../utils/period.js';

/**
 * Budget alerts (US-14, #35): REQ-46, BR-6.
 *
 * A warning is raised when spending reaches 80% of a budget and an
 * over-budget alert when it reaches 100%, each at most once per budget per
 * period. A budget document covers exactly one period, so "already sent" is
 * recorded on the budget itself (warning_alert_sent_at,
 * over_budget_alert_sent_at).
 *
 * evaluateBudgetsForUser(userId) is the hook for the transaction routes
 * (US-08 / US-09): call it after a transaction is added, edited, deleted or
 * imported. It is also run whenever budgets are listed.
 */

/**
 * Decide which alerts to raise. Pure function; unit tested.
 *
 * If spending jumps straight past 100%, only the over-budget alert is sent;
 * the 80% warning is marked as handled so it never arrives late.
 */
export function decideAlerts(percentUsed, warningSent, overSent) {
  const result = { sendWarning: false, sendOver: false, markWarning: false, markOver: false };

  if (percentUsed >= 100) {
    if (!overSent) {
      result.sendOver = true;
      result.markOver = true;
    }
    if (!warningSent) result.markWarning = true;
  } else if (percentUsed >= 80 && !warningSent) {
    result.sendWarning = true;
    result.markWarning = true;
  }

  return result;
}

function label(budget, categoryName) {
  return budget.category_id ? `${categoryName} budget` : 'Overall budget';
}

/**
 * Check one budget and raise any alerts that are due.
 * Returns the notifications created (usually none).
 */
export async function evaluateBudget(budget, utilisation, categoryName) {
  const decision = decideAlerts(
    utilisation.percent_used,
    Boolean(budget.warning_alert_sent_at),
    Boolean(budget.over_budget_alert_sent_at),
  );

  if (!decision.markWarning && !decision.markOver) return [];

  // Claim the alert atomically: only the request that flips the field from
  // null sends the notification, so two quick transactions cannot both send it.
  const now = new Date();
  const created = [];
  const name = label(budget, categoryName);

  if (decision.markOver) {
    const claimed = await Budget.updateOne(
      { _id: budget._id, over_budget_alert_sent_at: null },
      { $set: { over_budget_alert_sent_at: now } },
    );
    if (claimed.modifiedCount === 1 && decision.sendOver) {
      created.push(await Notification.create({
        user_id: budget.user_id,
        type: 'budget_over',
        title: `${name} exceeded`,
        body: `You have spent ${utilisation.spent} of your ${utilisation.budgeted} ${name.toLowerCase()} ` +
          `(${utilisation.percent_used}%).`,
      }));
    }
  }

  if (decision.markWarning) {
    const claimed = await Budget.updateOne(
      { _id: budget._id, warning_alert_sent_at: null },
      { $set: { warning_alert_sent_at: now } },
    );
    if (claimed.modifiedCount === 1 && decision.sendWarning) {
      created.push(await Notification.create({
        user_id: budget.user_id,
        type: 'budget_warning',
        title: `${name} is at ${utilisation.percent_used}%`,
        body: `You have spent ${utilisation.spent} of your ${utilisation.budgeted} ${name.toLowerCase()}. ` +
          `${utilisation.remaining} is left for the next ${utilisation.days_left} day(s).`,
      }));
    }
  }

  return created;
}

/** Re-check every active budget of a user. Safe to call as often as needed. */
export async function evaluateBudgetsForUser(userId) {
  const onDay = today();
  const budgets = await Budget.find({ user_id: userId, period_end: { $gte: onDay } }).lean();
  const created = [];

  for (const budget of budgets) {
    const category = budget.category_id
      ? await Category.findById(budget.category_id).select('name').lean()
      : null;
    const spent = await spentForBudget(budget);
    const utilisation = summarise(budget.amount, spent, {
      start: budget.period_start,
      end: budget.period_end,
    }, onDay);
    created.push(...await evaluateBudget(budget, utilisation, category?.name));
  }

  return created;
}
