import mongoose from 'mongoose';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import RecurringRule from '../models/RecurringRule.js';
import Transaction from '../models/Transaction.js';
import { ApiError } from '../utils/apiError.js';
import { formatDateOnly, today as appToday } from '../utils/period.js';
import {
  firstIndexOnOrAfter,
  occurrenceDate,
  withinLimits,
} from '../utils/recurrence.js';
import {
  END_BEFORE_START_MESSAGE,
  validateRecurringRuleInput,
} from '../validators/recurringRule.js';
import { recordAudit } from './auditService.js';

/**
 * Recurring rule management - US-16 (#43), REQ-52, REQ-53, REQ-56.
 *
 * Generation itself lives in recurringGenerationService.js. Everything here is
 * scoped to the caller's own rules; a malformed id, an unknown id and another
 * user's rule all give the same 404.
 */

const NOT_FOUND = 'Recurring rule not found.';
const OBJECT_ID = /^[a-f\d]{24}$/i;
const day = (date) => (date ? formatDateOnly(date) : null);

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export function presentRule(rule, names = {}) {
  const live = rule.status === 'active' || rule.status === 'paused';
  return {
    id: String(rule._id),
    type: rule.type,
    amount: rule.amount.toString(),
    account_id: String(rule.account_id),
    account_name: names.account ?? null,
    category_id: rule.category_id ? String(rule.category_id) : null,
    category_name: names.category ?? null,
    frequency: rule.frequency,
    start_date: day(rule.start_date),
    end_date: day(rule.end_date),
    occurrence_count: rule.occurrence_count ?? null,
    next_due_date: live ? day(rule.next_due_date) : null,
    status: rule.status,
    payment_mode: rule.payment_mode,
    note: rule.note,
    occurrences_done: rule.occurrences_done,
    last_generated_date: day(rule.last_generated_date),
    created_at: rule.createdAt,
  };
}

async function namesFor(rules) {
  const accountIds = [...new Set(rules.map((r) => String(r.account_id)))];
  const categoryIds = [...new Set(rules.map((r) => r.category_id && String(r.category_id)).filter(Boolean))];
  const [accounts, categories] = await Promise.all([
    Account.find({ _id: { $in: accountIds } }).select('name').lean(),
    Category.find({ _id: { $in: categoryIds } }).select('name').lean(),
  ]);
  const a = new Map(accounts.map((x) => [String(x._id), x.name]));
  const c = new Map(categories.map((x) => [String(x._id), x.name]));
  return (rule) => ({
    account: a.get(String(rule.account_id)) ?? 'Unknown account',
    category: rule.category_id ? (c.get(String(rule.category_id)) ?? 'Deleted category') : null,
  });
}

// ---------------------------------------------------------------------------
// Lookup and ownership checks
// ---------------------------------------------------------------------------

async function findOwned(userId, id) {
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw new ApiError(404, NOT_FOUND);
  const rule = await RecurringRule.findOne({
    _id: id,
    user_id: userId,
    status: { $ne: 'deleted' },
  });
  if (!rule) throw new ApiError(404, NOT_FOUND);
  return rule;
}

async function checkAccountAndCategory(userId, { account_id, category_id }) {
  if (account_id) {
    const account = await Account.findOne({ _id: account_id, user_id: userId, is_archived: false });
    if (!account) throw new ApiError(404, 'Account not found or unavailable.');
  }
  if (category_id) {
    const category = await Category.findOne({ _id: category_id, user_id: userId });
    if (!category) throw new ApiError(400, 'Select a valid category.');
  }
}

/** True when the occurrence at the rule's next index is still allowed. */
function nextIsWithinLimits(rule) {
  return withinLimits({
    date: rule.next_due_date,
    endDate: rule.end_date,
    occurrenceCount: rule.occurrence_count,
    occurrencesDone: rule.occurrences_done,
  });
}

// ---------------------------------------------------------------------------
// Create / list / view
// ---------------------------------------------------------------------------

export async function createRule(userId, body, { ip, today = appToday() } = {}) {
  const result = validateRecurringRuleInput(body, { today });
  if (result.errors) throw new ApiError(400, 'Invalid recurring rule.', result.errors);
  const data = result.data;

  await checkAccountAndCategory(userId, data);

  const rule = await RecurringRule.create({
    user_id: userId,
    account_id: data.account_id,
    category_id: data.category_id ?? null,
    type: data.type,
    amount: data.amount,
    frequency: data.frequency,
    start_date: data.start_date,
    end_date: data.end_date ?? null,
    occurrence_count: data.occurrence_count ?? null,
    payment_mode: data.payment_mode ?? 'other',
    note: data.note ?? '',
    anchor_date: data.start_date,
    next_index: 0,
    next_due_date: data.start_date,
    status: 'active',
  });

  await recordAudit({
    userId, entityType: 'recurring_rule', entityId: rule._id, action: 'create',
    newValue: { frequency: rule.frequency, amount: rule.amount.toString() }, ip,
  });

  const names = await namesFor([rule]);
  return presentRule(rule, names(rule));
}

export async function listRules(userId, { status, page = 1, limit = 25 } = {}) {
  const filter = { user_id: new mongoose.Types.ObjectId(String(userId)) };
  if (status && status !== 'all') {
    if (!['active', 'paused', 'completed'].includes(status)) {
      throw new ApiError(400, 'Invalid status filter.');
    }
    filter.status = status;
  } else {
    filter.status = { $ne: 'deleted' };
  }

  const [rules, total] = await Promise.all([
    RecurringRule.find(filter)
      .sort({ status: 1, next_due_date: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RecurringRule.countDocuments(filter),
  ]);

  const names = await namesFor(rules);
  return {
    data: rules.map((rule) => presentRule(rule, names(rule))),
    pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getRule(userId, id) {
  const rule = await findOwned(userId, id);
  const names = await namesFor([rule]);

  // The most recent transactions this rule generated (REQ-54).
  const generated = await Transaction.find({
    user_id: userId,
    recurring_rule_id: rule._id,
    is_deleted: { $ne: true },
  })
    .sort({ recurring_scheduled_date: -1 })
    .limit(10)
    .lean();

  return {
    ...presentRule(rule, names(rule)),
    generated_transactions: generated.map((t) => ({
      id: String(t._id),
      amount: t.amount.toString(),
      transaction_date: day(t.transaction_date),
      scheduled_date: day(t.recurring_scheduled_date),
    })),
  };
}

// ---------------------------------------------------------------------------
// Edit (REQ-56: affects future occurrences only)
// ---------------------------------------------------------------------------

export async function updateRule(userId, id, body, { ip, today = appToday() } = {}) {
  const rule = await findOwned(userId, id);

  if (rule.status === 'completed') {
    throw new ApiError(409, 'A completed rule cannot be edited. Create a new rule instead.');
  }

  // A form sends every field back; an unchanged start date is not "new".
  const input = { ...(body && typeof body === 'object' ? body : {}) };
  if (input.start_date && input.start_date === day(rule.start_date)) delete input.start_date;

  const result = validateRecurringRuleInput(input, { allowPartial: true, today });
  if (result.errors) throw new ApiError(400, 'Invalid recurring rule.', result.errors);
  const data = result.data;
  const errors = {};

  await checkAccountAndCategory(userId, {
    account_id: data.account_id && data.account_id !== String(rule.account_id) ? data.account_id : null,
    category_id: data.category_id && data.category_id !== String(rule.category_id) ? data.category_id : null,
  });

  const start = data.start_date ?? rule.start_date;
  const end = 'end_date' in data ? data.end_date : rule.end_date;
  const count = 'occurrence_count' in data ? data.occurrence_count : rule.occurrence_count;

  if (end && end.getTime() < start.getTime()) errors.end_date = END_BEFORE_START_MESSAGE;
  if (end && count) errors.occurrence_count = 'Choose either an end date or an occurrence count, not both.';
  if (count && count <= rule.occurrences_done && 'occurrence_count' in data) {
    errors.occurrence_count =
      `${rule.occurrences_done} occurrence(s) have already been processed; enter a larger count.`;
  }
  if (data.start_date && rule.occurrences_done > 0) {
    errors.start_date = 'The start date cannot be changed after transactions have been generated.';
  }
  if (Object.keys(errors).length) throw new ApiError(400, 'Invalid recurring rule.', errors);

  const before = presentRule(rule);

  for (const key of ['type', 'amount', 'account_id', 'category_id', 'payment_mode', 'note']) {
    if (key in data) rule[key] = data[key];
  }
  if ('end_date' in data) rule.end_date = data.end_date;
  if ('occurrence_count' in data) rule.occurrence_count = data.occurrence_count;

  if (data.start_date) {
    // No occurrence has run yet, so the whole schedule can move.
    rule.start_date = data.start_date;
    rule.anchor_date = data.start_date;
    rule.next_index = 0;
    rule.next_due_date = data.start_date;
  }

  if (data.frequency && data.frequency !== rule.frequency) {
    // Re-anchor on the next due date: past occurrences are untouched and the
    // new frequency counts from here.
    rule.frequency = data.frequency;
    rule.anchor_date = rule.next_due_date;
    rule.next_index = 0;
  }

  if (!nextIsWithinLimits(rule)) rule.status = 'completed';

  await rule.save();

  await recordAudit({
    userId, entityType: 'recurring_rule', entityId: rule._id, action: 'update',
    oldValue: before, newValue: presentRule(rule), ip,
  });

  const names = await namesFor([rule]);
  return presentRule(rule, names(rule));
}

// ---------------------------------------------------------------------------
// Pause / resume / delete
// ---------------------------------------------------------------------------

export async function pauseRule(userId, id, { ip, now = new Date() } = {}) {
  const rule = await findOwned(userId, id);

  const paused = await RecurringRule.findOneAndUpdate(
    { _id: rule._id, user_id: userId, status: 'active' },
    { $set: { status: 'paused', paused_at: now } },
    { new: true },
  );
  if (!paused) throw new ApiError(409, 'Only an active rule can be paused.');

  await recordAudit({
    userId, entityType: 'recurring_rule', entityId: rule._id, action: 'pause',
    oldValue: { status: 'active' }, newValue: { status: 'paused' }, ip,
  });

  const names = await namesFor([paused]);
  return presentRule(paused, names(paused));
}

/**
 * Resume a paused rule. The next occurrence is the first one on or after
 * today, so the paused period is never back-filled (REQ-56).
 */
export async function resumeRule(userId, id, { ip, today = appToday() } = {}) {
  const rule = await findOwned(userId, id);
  if (rule.status !== 'paused') throw new ApiError(409, 'Only a paused rule can be resumed.');

  const index = Math.max(
    rule.next_index,
    firstIndexOnOrAfter(rule.anchor_date, rule.frequency, today),
  );
  const nextDate = occurrenceDate(rule.anchor_date, rule.frequency, index);

  const stillRuns = withinLimits({
    date: nextDate,
    endDate: rule.end_date,
    occurrenceCount: rule.occurrence_count,
    occurrencesDone: rule.occurrences_done,
  });

  const resumed = await RecurringRule.findOneAndUpdate(
    { _id: rule._id, user_id: userId, status: 'paused' },
    {
      $set: {
        status: stillRuns ? 'active' : 'completed',
        paused_at: null,
        next_index: index,
        next_due_date: nextDate,
      },
    },
    { new: true },
  );
  if (!resumed) throw new ApiError(409, 'Only a paused rule can be resumed.');

  await recordAudit({
    userId, entityType: 'recurring_rule', entityId: rule._id, action: 'resume',
    oldValue: { status: 'paused' }, newValue: { status: resumed.status, next_due_date: day(nextDate) }, ip,
  });

  const names = await namesFor([resumed]);
  return presentRule(resumed, names(resumed));
}

/** Soft delete: the rule disappears, the transactions it generated stay. */
export async function deleteRule(userId, id, { ip, now = new Date() } = {}) {
  const rule = await findOwned(userId, id);

  const result = await RecurringRule.updateOne(
    { _id: rule._id, user_id: userId, status: { $ne: 'deleted' } },
    { $set: { status: 'deleted', is_deleted: true, deleted_at: now } },
  );
  if (result.modifiedCount !== 1) throw new ApiError(404, NOT_FOUND);

  await recordAudit({
    userId, entityType: 'recurring_rule', entityId: rule._id, action: 'delete',
    oldValue: { status: rule.status }, newValue: { status: 'deleted' }, ip,
  });

  return { id: String(rule._id) };
}
