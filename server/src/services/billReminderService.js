import { softDeleteResource } from './resourceRecoveryService.js';
import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Reminder from '../models/Reminder.js';
import Transaction from '../models/Transaction.js';
import { ApiError } from '../utils/apiError.js';
import { formatDateOnly, parseDateOnly, today as appToday } from '../utils/period.js';
import { parseAmount } from '../validators/transaction.js';
import { validateBillReminderInput } from '../validators/billReminder.js';
import { recordAudit } from './auditService.js';
import { createTransactionRecord, presentTransaction } from './transactionService.js';

/**
 * Bill reminders - US-17 (#44), REQ-57, REQ-58, REQ-59.
 *
 * Every function is scoped to the caller's own reminders; a malformed id, an
 * unknown id and another user's reminder all give the same 404.
 */

const NOT_FOUND = 'Bill reminder not found.';
const OBJECT_ID = /^[a-f\d]{24}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLAIM_STALE_MS = 60 * 1000;

const day = (d) => (d ? formatDateOnly(d) : null);

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** The status the user sees: a pending bill past its due date IS overdue (REQ-59). */
export function effectiveStatus(reminder, onDay = appToday()) {
  if (reminder.status === 'paid') return 'paid';
  if (reminder.status === 'overdue') return 'overdue';
  if (reminder.status === 'pending' && reminder.due_date.getTime() < onDay.getTime()) return 'overdue';
  return reminder.status;
}

export function notifyDate(reminder) {
  return new Date(reminder.due_date.getTime() - reminder.notify_days_before * DAY_MS);
}

export function presentReminder(reminder, onDay = appToday()) {
  return {
    id: String(reminder._id),
    name: reminder.name,
    amount: reminder.amount ? reminder.amount.toString() : null,
    due_date: day(reminder.due_date),
    notify_days_before: reminder.notify_days_before,
    notify_date: day(notifyDate(reminder)),
    status: effectiveStatus(reminder, onDay),
    days_until_due: Math.round((reminder.due_date.getTime() - onDay.getTime()) / DAY_MS),
    account_id: reminder.account_id ? String(reminder.account_id) : null,
    category_id: reminder.category_id ? String(reminder.category_id) : null,
    linked_transaction_id: reminder.linked_transaction_id ? String(reminder.linked_transaction_id) : null,
    paid_at: reminder.paid_at ?? null,
    created_at: reminder.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Lookup and checks
// ---------------------------------------------------------------------------

async function findOwned(userId, id) {
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw new ApiError(404, NOT_FOUND);
  const reminder = await Reminder.findOne({ _id: id, user_id: userId });
  if (!reminder) throw new ApiError(404, NOT_FOUND);
  return reminder;
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

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createReminder(userId, body, { ip, today = appToday() } = {}) {
  const result = validateBillReminderInput(body);
  if (result.errors) throw new ApiError(400, 'Invalid bill reminder.', result.errors);
  const data = result.data;

  await checkAccountAndCategory(userId, data);

  const reminder = await Reminder.create({
    user_id: userId,
    name: data.name,
    amount: data.amount,
    due_date: data.due_date,
    notify_days_before: data.notify_days_before,
    account_id: data.account_id ?? null,
    category_id: data.category_id ?? null,
    status: data.due_date.getTime() < today.getTime() ? 'overdue' : 'pending',
  });

  await recordAudit({
    userId, entityType: 'bill_reminder', entityId: reminder._id, action: 'create',
    newValue: { name: reminder.name, due_date: day(reminder.due_date) }, ip,
  });

  return presentReminder(reminder, today);
}

export async function listReminders(userId, { status, page = 1, limit = 25, today = appToday() } = {}) {
  const filter = { user_id: new mongoose.Types.ObjectId(String(userId)) };

  if (status && status !== 'all') {
    if (status === 'overdue') {
      filter.$or = [{ status: 'overdue' }, { status: 'pending', due_date: { $lt: today } }];
    } else if (status === 'pending') {
      filter.status = 'pending';
      filter.due_date = { $gte: today };
    } else if (status === 'paid') {
      filter.status = 'paid';
    } else {
      throw new ApiError(400, 'Invalid status filter.');
    }
  }

  const [items, total] = await Promise.all([
    Reminder.find(filter)
      .sort({ due_date: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Reminder.countDocuments(filter),
  ]);

  return {
    data: items.map((r) => presentReminder(r, today)),
    pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getReminder(userId, id) {
  return presentReminder(await findOwned(userId, id));
}

export async function updateReminder(userId, id, body, { ip, today = appToday() } = {}) {
  const reminder = await findOwned(userId, id);
  if (reminder.status === 'paid') throw new ApiError(409, 'A paid bill cannot be edited.');

  const result = validateBillReminderInput(body, { allowPartial: true });
  if (result.errors) throw new ApiError(400, 'Invalid bill reminder.', result.errors);
  const data = result.data;

  await checkAccountAndCategory(userId, {
    account_id: data.account_id && data.account_id !== String(reminder.account_id) ? data.account_id : null,
    category_id: data.category_id && data.category_id !== String(reminder.category_id) ? data.category_id : null,
  });

  const before = presentReminder(reminder, today);
  for (const key of ['name', 'amount', 'due_date', 'notify_days_before', 'account_id', 'category_id']) {
    if (key in data) reminder[key] = data[key];
  }

  // Moving the due date moves the bill in or out of overdue.
  reminder.status = reminder.due_date.getTime() < today.getTime() ? 'overdue' : 'pending';

  await reminder.save();
  await recordAudit({
    userId, entityType: 'bill_reminder', entityId: reminder._id, action: 'update',
    oldValue: before, newValue: presentReminder(reminder, today), ip,
  });

  return presentReminder(reminder, today);
}

export async function deleteReminder(userId, id, { ip } = {}) {
  const reminder = await findOwned(userId, id);
  await softDeleteResource(reminder);

  // A paid bill's expense stays: it is real money that left an account.
  await recordAudit({
    userId, entityType: 'bill_reminder', entityId: reminder._id, action: 'delete',
    oldValue: { name: reminder.name, status: reminder.status }, ip,
  });
  return { id: String(reminder._id) };
}

// ---------------------------------------------------------------------------
// Mark as paid (REQ-58)
// ---------------------------------------------------------------------------

function parsePayBody(body, today) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const errors = {};
  const out = {};

  for (const key of Object.keys(input)) {
    if (!['account_id', 'category_id', 'amount', 'paid_date'].includes(key)) {
      errors[key] = 'This field cannot be set.';
    }
  }

  for (const key of ['account_id', 'category_id']) {
    const v = input[key];
    if (v !== undefined && v !== null && v !== '') {
      if (typeof v !== 'string' || !OBJECT_ID.test(v)) {
        errors[key] = key === 'account_id' ? 'Select a valid account.' : 'Select a valid category.';
      } else out[key] = v;
    }
  }

  if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
    const amount = parseAmount(input.amount);
    if (amount === null) errors.amount = 'Enter an amount greater than 0 with up to 2 decimal places.';
    else out.amount = amount;
  }

  if (input.paid_date !== undefined && input.paid_date !== null && input.paid_date !== '') {
    const paid = parseDateOnly(input.paid_date);
    if (!paid) errors.paid_date = 'Enter a valid date in YYYY-MM-DD format.';
    else if (paid.getTime() > today.getTime() + DAY_MS) {
      errors.paid_date = 'Payment date cannot be more than one day in the future.';
    } else out.paid_date = paid;
  }

  if (Object.keys(errors).length) throw new ApiError(400, 'Invalid payment details.', errors);
  return out;
}

async function finalisePaid(reminder, transaction, now) {
  await Reminder.updateOne(
    { _id: reminder._id, status: { $in: ['pending', 'overdue'] } },
    { $set: { status: 'paid', paid_at: now, linked_transaction_id: transaction._id } },
  );
  return Reminder.findById(reminder._id);
}

/**
 * Pay a bill: one expense, linked, with the reminder moved to PAID.
 *
 * Safe against repeats and races without multi-document transactions:
 *  1. the reminder is claimed with a single conditional update, so only one
 *     request gets past it;
 *  2. the expense carries a unique index on linked_reminder_id, so even a
 *     retry after a crash cannot create a second one;
 *  3. if a previous attempt created the expense but died before marking the
 *     reminder, this request adopts that expense and finishes the job.
 */
export async function markPaid(userId, id, body, { ip, now = new Date(), today = appToday() } = {}) {
  const reminder = await findOwned(userId, id);
  if (reminder.status === 'paid') throw new ApiError(409, 'This bill has already been paid.');

  const pay = parsePayBody(body, today);
  const accountId = pay.account_id || (reminder.account_id && String(reminder.account_id));
  if (!accountId) {
    throw new ApiError(400, 'Invalid payment details.', {
      account_id: 'Select the account this bill was paid from.',
    });
  }
  const categoryId = 'category_id' in pay ? pay.category_id : (reminder.category_id && String(reminder.category_id)) || null;
  const amount = pay.amount || reminder.amount?.toString();
  if (!amount) {
    throw new ApiError(400, 'Invalid payment details.', { amount: 'Enter the amount that was paid.' });
  }

  // 1. Claim.
  let claimed = await Reminder.findOneAndUpdate(
    { _id: reminder._id, user_id: userId, status: { $in: ['pending', 'overdue'] }, payment_claimed_at: null },
    { $set: { payment_claimed_at: now } },
    { new: true },
  );

  if (!claimed) {
    const current = await Reminder.findOne({ _id: reminder._id, user_id: userId });
    if (!current) throw new ApiError(404, NOT_FOUND);
    if (current.status === 'paid') throw new ApiError(409, 'This bill has already been paid.');

    // Claimed but not paid: either another request is mid-way (leave it
    // alone), or that request died. Only a stale claim is taken over.
    if (now.getTime() - current.payment_claimed_at.getTime() < CLAIM_STALE_MS) {
      throw new ApiError(409, 'This bill payment is already being processed.');
    }

    // The dead request may have got as far as creating the expense: adopt it.
    const existing = await Transaction.findOne({ linked_reminder_id: current._id });
    if (existing) {
      const done = await finalisePaid(current, existing, now);
      return { reminder: presentReminder(done, today), transaction: presentTransaction(existing, []) };
    }
    claimed = await Reminder.findOneAndUpdate(
      { _id: current._id, status: { $in: ['pending', 'overdue'] }, payment_claimed_at: current.payment_claimed_at },
      { $set: { payment_claimed_at: now } },
      { new: true },
    );
    if (!claimed) throw new ApiError(409, 'This bill payment is already being processed.');
  }

  // 2. Create the expense through the shared transaction logic.
  let transaction;
  try {
    ({ transaction } = await createTransactionRecord(
      userId,
      {
        type: 'expense',
        amount: new Decimal(amount).toFixed(2),
        account_id: accountId,
        category_id: categoryId,
        payment_mode: 'other',
        note: `Bill: ${reminder.name}`.slice(0, 200),
        transaction_date: pay.paid_date || today,
        tags: [],
        splits: [],
      },
      { linked_reminder_id: reminder._id },
    ));
  } catch (error) {
    if (error?.code === 11000) {
      transaction = await Transaction.findOne({ linked_reminder_id: reminder._id });
    }
    if (!transaction) {
      // Nothing was created: release the claim so the user can try again.
      await Reminder.updateOne(
        { _id: reminder._id, status: { $in: ['pending', 'overdue'] } },
        { $set: { payment_claimed_at: null } },
      );
      throw error;
    }
  }

  // 3. Mark paid.
  const done = await finalisePaid(reminder, transaction, now);

  await recordAudit({
    userId, entityType: 'bill_reminder', entityId: reminder._id, action: 'mark_paid',
    oldValue: { status: reminder.status },
    newValue: { status: 'paid', transaction_id: String(transaction._id) }, ip,
  });

  return { reminder: presentReminder(done, today), transaction: presentTransaction(transaction, []) };
}

// ---------------------------------------------------------------------------
// Dashboard (REQ-59)
// ---------------------------------------------------------------------------

/** Unpaid bills past their due date, oldest first, for the dashboard. */
export async function overdueBills(userId, onDay = appToday(), { limit = 20 } = {}) {
  const match = {
    user_id: new mongoose.Types.ObjectId(String(userId)),
    $or: [{ status: 'overdue' }, { status: 'pending', due_date: { $lt: onDay } }],
  };

  const [items, all] = await Promise.all([
    Reminder.find(match).sort({ due_date: 1 }).limit(limit).lean(),
    Reminder.find(match).select('amount').lean(),
  ]);

  const total = all.reduce(
    (sum, r) => (r.amount ? sum.plus(r.amount.toString()) : sum),
    new Decimal(0),
  );

  return {
    count: all.length,
    total: total.toFixed(2),
    items: items.map((r) => {
      const p = presentReminder(r, onDay);
      return {
        id: p.id, name: p.name, amount: p.amount, due_date: p.due_date,
        days_overdue: Math.max(0, -p.days_until_due),
      };
    }),
  };
}
