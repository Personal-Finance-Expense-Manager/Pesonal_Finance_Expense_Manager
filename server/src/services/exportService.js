import mongoose from 'mongoose';
import Account from '../models/Account.js';
import Attachment from '../models/Attachment.js';
import Budget from '../models/Budget.js';
import Category from '../models/Category.js';
import Goal from '../models/Goal.js';
import GoalContribution from '../models/GoalContribution.js';
import Notification from '../models/Notification.js';
import RecurringRule from '../models/RecurringRule.js';
import Reminder from '../models/Reminder.js';
import Tag from '../models/Tag.js';
import Transaction from '../models/Transaction.js';
import TransactionTag from '../models/TransactionTag.js';
import Transfer from '../models/Transfer.js';
import User from '../models/User.js';
import { formatDateOnly } from '../utils/period.js';
import { protectCell, toCsv } from '../utils/csv.js';

/**
 * Data export - US-24 (#58), SRS REQ-82 and REQ-87.
 */

// ---------------------------------------------------------------------------
// REQ-82: transactions as CSV, in a documented column order
// ---------------------------------------------------------------------------

/**
 * The documented column order (also in README "Import and export").
 * The import accepts exactly these headings without any mapping, so an export
 * can be imported back.
 */
export const CSV_COLUMNS = [
  'date', // ISO 8601 calendar date, YYYY-MM-DD
  'type', // income | expense | transfer
  'amount', // plain decimal, two places, no currency symbol or separators
  'currency', // ISO 4217 code of the account
  'account', // account name (the source account for a transfer)
  'to_account', // destination account name, transfers only
  'category', // category name, blank if uncategorised
  'payment_mode', // cash | card | upi | bank_transfer | wallet | other
  'note',
  'tags', // tag names separated by semicolons
];

/** Build the date filter for an optional YYYY-MM-DD range (dates already parsed). */
function dateRange(field, from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { [field]: range };
}

/** The caller's live transactions and transfers in the range, as CSV text. */
export async function exportTransactionsCsv(userId, { from = null, to = null } = {}) {
  const [transactions, transfers, accounts, categories] = await Promise.all([
    Transaction.find({ user_id: userId, is_deleted: { $ne: true }, ...dateRange('transaction_date', from, to) })
      .sort({ transaction_date: 1, _id: 1 })
      .lean(),
    Transfer.find({ user_id: userId, is_deleted: { $ne: true }, ...dateRange('transfer_date', from, to) })
      .sort({ transfer_date: 1, _id: 1 })
      .lean(),
    Account.find({ user_id: userId }).select('name currency').lean(),
    Category.find({ user_id: userId }).select('name').lean(),
  ]);

  const accountById = new Map(accounts.map((a) => [a._id.toString(), a]));
  const categoryById = new Map(categories.map((c) => [c._id.toString(), c.name]));

  const links = transactions.length
    ? await TransactionTag.find({ user_id: userId, transaction_id: { $in: transactions.map((t) => t._id) } }).lean()
    : [];
  const tags = links.length
    ? await Tag.find({ _id: { $in: links.map((l) => l.tag_id) } }).select('name').lean()
    : [];
  const tagName = new Map(tags.map((t) => [t._id.toString(), t.name]));
  const tagsByTransaction = new Map();

  for (const link of links) {
    const key = link.transaction_id.toString();
    const name = tagName.get(link.tag_id.toString());
    if (!name) continue;
    if (!tagsByTransaction.has(key)) tagsByTransaction.set(key, []);
    tagsByTransaction.get(key).push(name);
  }

  const rows = [
    ...transactions.map((t) => ({
      date: t.transaction_date,
      id: t._id.toString(),
      cells: [
        formatDateOnly(t.transaction_date),
        t.type,
        t.amount.toString(),
        t.currency || accountById.get(t.account_id?.toString())?.currency || 'INR',
        accountById.get(t.account_id?.toString())?.name || '',
        '',
        t.category_id ? categoryById.get(t.category_id.toString()) || '' : '',
        t.payment_mode || '',
        t.note || '',
        (tagsByTransaction.get(t._id.toString()) || []).join(';'),
      ],
    })),
    ...transfers.map((t) => ({
      date: t.transfer_date,
      id: t._id.toString(),
      cells: [
        formatDateOnly(t.transfer_date),
        'transfer',
        t.amount.toString(),
        accountById.get(t.from_account_id?.toString())?.currency || 'INR',
        accountById.get(t.from_account_id?.toString())?.name || '',
        accountById.get(t.to_account_id?.toString())?.name || '',
        '',
        '',
        t.note || '',
        '',
      ],
    })),
  ].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));

  const textColumns = new Set([4, 5, 6, 8, 9]);
  const body = rows.map((r) => r.cells.map((cell, i) => (textColumns.has(i) ? protectCell(cell) : cell)));

  return { csv: toCsv([CSV_COLUMNS, ...body]), count: rows.length };
}

// ---------------------------------------------------------------------------
// REQ-87: everything the user owns, as one JSON document
// ---------------------------------------------------------------------------

// User fields that are secrets or security state, never exported.
const PRIVATE_USER_FIELD = /password|hash|token|secret|attempt|locked|resend|verification/i;

/** Plain JSON values: ObjectId and Decimal128 become strings, dates ISO strings. */
function plain(value) {
  if (value == null) return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (value instanceof mongoose.Types.Decimal128) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return undefined;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === '__v' || key === 'user_id') continue;
      const converted = plain(inner);
      if (converted !== undefined) out[key === '_id' ? 'id' : key] = converted;
    }
    return out;
  }
  return value;
}

/** The sections of the export, in order: [name, model]. */
const SECTIONS = [
  ['accounts', Account],
  ['categories', Category],
  ['tags', Tag],
  ['transactions', Transaction],
  ['transaction_tags', TransactionTag],
  ['transfers', Transfer],
  ['attachments', Attachment],
  ['budgets', Budget],
  ['goals', Goal],
  ['goal_contributions', GoalContribution],
  ['recurring_rules', RecurringRule],
  ['reminders', Reminder],
  ['notifications', Notification],
];

export async function exportAllJson(userId, now = new Date()) {
  const user = await User.findById(userId).lean();

  const profile = {};
  for (const [key, value] of Object.entries(user || {})) {
    if (!PRIVATE_USER_FIELD.test(key)) profile[key] = value;
  }

  const results = await Promise.all(
    SECTIONS.map(([, model]) => model.find({ user_id: userId }).sort({ _id: 1 }).lean()),
  );

  const data = {};
  const counts = {};
  SECTIONS.forEach(([name], i) => {
    data[name] = plain(results[i]);
    counts[name] = results[i].length;
  });

  return {
    format: 'pfem-export',
    version: 1,
    exported_at: now.toISOString(),
    notes: [
      'Amounts are decimal strings with two places. Dates are ISO 8601.',
      'Receipt files are not included; attachments lists their names and sizes.',
    ],
    counts,
    profile: plain(profile),
    ...data,
  };
}
