import Decimal from 'decimal.js';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Tag from '../models/Tag.js';
import Transaction from '../models/Transaction.js';
import TransactionTag from '../models/TransactionTag.js';
import Transfer from '../models/Transfer.js';
import { ApiError } from '../utils/apiError.js';
import { validateTransactionInput } from '../validators/transaction.js';
import { loadTransferAccounts, presentTransfer } from './transferService.js';
import { recordAudit } from './auditService.js';
import { retentionCutoff, restorableUntil } from './recycleBinService.js';

/**
 * Edit, delete and restore a transaction - US-09 (#25), SRS REQ-28 and REQ-29.
 *
 * Balances, budget utilisation and report figures are never stored; they are
 * worked out from the transaction records every time they are read (BR-3,
 * balanceService, budgetService). So saving an edit, or flagging a record as
 * deleted or restored, is all it takes for every figure to be correct on the
 * next read, which is the "immediately on save" of REQ-28 and REQ-29.
 *
 * "Transaction" below means an income/expense (Transaction collection) or a
 * transfer (Transfer collection); both are addressed by the same id route.
 */

const TRANSACTION_NOT_FOUND = 'Transaction not found.';
const OBJECT_ID = /^[a-f\d]{24}$/i;

const notFound = () => new ApiError(404, TRANSACTION_NOT_FOUND);

// ---------------------------------------------------------------------------
// Tags (shared with POST /api/transactions)
// ---------------------------------------------------------------------------

/** Find or create the user's Tag for each name (case-insensitive) and return the ids. */
export async function resolveTagIds(userId, names) {
  const tagIds = [];

  for (const name of names) {
    let tag = await Tag.findOne({
      user_id: userId,
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    });

    if (!tag) {
      tag = await Tag.create({ user_id: userId, name });
    }

    tagIds.push(tag._id);
  }

  return tagIds;
}

/** Tag names per transaction id (Map of id string -> names). */
export async function loadTagNames(transactionIds) {
  const names = new Map(transactionIds.map((id) => [id.toString(), []]));
  if (!transactionIds.length) return names;

  const links = await TransactionTag.find({ transaction_id: { $in: transactionIds } }).lean();
  const tags = await Tag.find({ _id: { $in: links.map((l) => l.tag_id) } }).lean();
  const nameById = new Map(tags.map((t) => [t._id.toString(), t.name]));

  for (const link of links) {
    const name = nameById.get(link.tag_id.toString());
    if (name) names.get(link.transaction_id.toString())?.push(name);
  }

  return names;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** API shape for an income/expense; the same fields POST /api/transactions returns. */
export function presentTransaction(transaction, tags = []) {
  return {
    id: transaction._id,
    type: transaction.type,
    amount: transaction.amount.toString(),
    transaction_date: transaction.transaction_date,
    account_id: transaction.account_id,
    category_id: transaction.category_id,
    payment_mode: transaction.payment_mode,
    note: transaction.note,
    tags,
  };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Find one of the caller's own records. Malformed ids, unknown ids and other
 * users' records all give the same 404, so a caller cannot probe for the
 * existence of someone else's transaction.
 *
 * @param deleted  true to look in the recycle bin, false for live records
 */
async function findOwned(id, userId, { deleted = false } = {}) {
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw notFound();

  const filter = {
    _id: id,
    user_id: userId,
    is_deleted: deleted ? true : { $ne: true },
  };

  const transaction = await Transaction.findOne(filter);
  if (transaction) return { kind: 'transaction', doc: transaction };

  const transfer = await Transfer.findOne(filter);
  if (transfer) return { kind: 'transfer', doc: transfer };

  throw notFound();
}

// ---------------------------------------------------------------------------
// Edit (REQ-28)
// ---------------------------------------------------------------------------

export async function updateTransaction(userId, id, body, { ip } = {}) {
  const { kind, doc } = await findOwned(id, userId);

  const result = validateTransactionInput(body, {
    allowPartial: true,
    currentType: kind === 'transfer' ? 'transfer' : doc.type,
  });

  if (result.errors) {
    throw new ApiError(400, 'Invalid transaction details.', result.errors);
  }

  const data = result.data;

  // A transfer is a different kind of record (two accounts, no category), so
  // it cannot be turned into income or expense, nor the reverse.
  if (data.type && (data.type === 'transfer') !== (kind === 'transfer')) {
    throw new ApiError(400, 'Invalid transaction details.', {
      type: 'A transfer cannot be changed into income or expense, or the reverse. Delete it and record a new one.',
    });
  }

  return kind === 'transfer'
    ? editTransfer(userId, doc, data, ip)
    : editTransaction(userId, doc, data, ip);
}

async function editTransaction(userId, doc, data, ip) {
  const oldTagMap = await loadTagNames([doc._id]);
  const oldTags = oldTagMap.get(doc._id.toString());
  const before = snapshotTransaction(doc, oldTags);

  if (data.account_id && data.account_id !== doc.account_id.toString()) {
    const account = await Account.findOne({
      _id: data.account_id,
      user_id: userId,
      is_archived: false,
    });

    if (!account) throw new ApiError(404, 'Account not found or unavailable.');

    doc.account_id = account._id;

    if (account.currency !== doc.currency) {
      doc.currency = account.currency;
      doc.converted_amount = null;
      doc.exchange_rate = null;
    }
  }

  if ('category_id' in data) {
    if (data.category_id) {
      const category = await Category.findOne({ _id: data.category_id, user_id: userId });
      if (!category) throw new ApiError(400, 'Select a valid category.');
    }
    doc.category_id = data.category_id;
  }

  for (const key of ['type', 'transaction_date', 'payment_mode', 'note']) {
    if (key in data) doc[key] = data[key];
  }

  if ('amount' in data) {
    doc.amount = data.amount;
    // A stored conversion is only valid for the amount it was made from.
    doc.converted_amount = recomputeConverted(data.amount, doc.exchange_rate);
  }

  await doc.validate();

  // Replace tags first: if that fails nothing else has changed yet.
  let tags = oldTags;
  if ('tags' in data) {
    await replaceTags(userId, doc._id, data.tags, oldTags);
    tags = data.tags;
  }

  await doc.save();

  const after = snapshotTransaction(doc, tags);
  await auditChange(userId, 'transaction', doc._id, 'update', before, after, ip);

  return presentTransaction(doc, tags);
}

async function editTransfer(userId, doc, data, ip) {
  const before = snapshotTransfer(doc);

  const fromId = data.from_account_id ?? doc.from_account_id.toString();
  const toId = data.to_account_id ?? doc.to_account_id.toString();

  if (fromId === toId) {
    throw new ApiError(400, 'Invalid transaction details.', {
      to_account_id: 'Source and destination accounts must be different.',
    });
  }

  const changed = [];
  if (fromId !== doc.from_account_id.toString()) changed.push(fromId);
  if (toId !== doc.to_account_id.toString()) changed.push(toId);

  if (changed.length) {
    await loadTransferAccounts(userId, fromId, toId, { mustBeActive: changed });
  }

  doc.from_account_id = fromId;
  doc.to_account_id = toId;
  if ('amount' in data) doc.amount = data.amount;
  if ('transaction_date' in data) doc.transfer_date = data.transaction_date;
  if ('note' in data) doc.note = data.note;

  await doc.save();

  await auditChange(userId, 'transfer', doc._id, 'update', before, snapshotTransfer(doc), ip);

  return presentTransfer(doc);
}

/**
 * Swap a transaction's tags. If anything fails part-way the old links are put
 * back, so a failed edit never loses the tags it started with.
 */
async function replaceTags(userId, transactionId, names, oldNames) {
  const tagIds = await resolveTagIds(userId, names);
  const oldLinks = await TransactionTag.find({ transaction_id: transactionId }).lean();

  try {
    await TransactionTag.deleteMany({ transaction_id: transactionId });
    if (tagIds.length) {
      await TransactionTag.insertMany(
        tagIds.map((tagId) => ({ user_id: userId, transaction_id: transactionId, tag_id: tagId })),
      );
    }
  } catch (error) {
    await TransactionTag.deleteMany({ transaction_id: transactionId });
    if (oldLinks.length) await TransactionTag.insertMany(oldLinks);
    throw error;
  }
}

function recomputeConverted(amount, exchangeRate) {
  if (!exchangeRate) return null;
  const converted = new Decimal(amount).times(exchangeRate.toString()).toDecimalPlaces(2);
  return converted.greaterThan(0) ? converted.toFixed(2) : null;
}

// ---------------------------------------------------------------------------
// Delete and restore (REQ-29)
// ---------------------------------------------------------------------------

/**
 * Move a transaction or transfer to the recycle bin. Its receipt attachments
 * and tags are kept, so a restore brings back the whole record. A transfer is
 * one document, so both of its accounts change together or not at all (DR-1).
 */
export async function deleteTransaction(userId, id, { ip, now = new Date() } = {}) {
  const { kind, doc } = await findOwned(id, userId);
  const Model = kind === 'transfer' ? Transfer : Transaction;

  // Conditional update: two simultaneous deletes cannot both succeed.
  const result = await Model.updateOne(
    { _id: doc._id, user_id: userId, is_deleted: { $ne: true } },
    { $set: { is_deleted: true, deleted_at: now } },
  );

  if (result.modifiedCount !== 1) throw notFound();

  await recordAudit({
    userId,
    entityType: kind,
    entityId: doc._id,
    action: 'soft_delete',
    oldValue: { is_deleted: false },
    newValue: { is_deleted: true, deleted_at: now },
    ip,
  });

  return {
    id: doc._id,
    type: kind === 'transfer' ? 'transfer' : doc.type,
    deleted_at: now,
    restorable_until: restorableUntil(now),
  };
}

/** Bring a deleted transaction or transfer back, if it is still inside the 30-day window. */
export async function restoreTransaction(userId, id, { ip, now = new Date() } = {}) {
  const { kind, doc } = await findOwned(id, userId, { deleted: true });
  const Model = kind === 'transfer' ? Transfer : Transaction;

  if (doc.deleted_at < retentionCutoff(now)) {
    throw new ApiError(
      410,
      'The 30-day restore period has ended, so this transaction can no longer be restored.',
    );
  }

  const result = await Model.updateOne(
    { _id: doc._id, user_id: userId, is_deleted: true, deleted_at: { $gte: retentionCutoff(now) } },
    { $set: { is_deleted: false, deleted_at: null } },
  );

  if (result.modifiedCount !== 1) throw notFound();

  await recordAudit({
    userId,
    entityType: kind,
    entityId: doc._id,
    action: 'restore',
    oldValue: { is_deleted: true, deleted_at: doc.deleted_at },
    newValue: { is_deleted: false },
    ip,
  });

  doc.is_deleted = false;
  doc.deleted_at = null;

  if (kind === 'transfer') return presentTransfer(doc);

  const tags = (await loadTagNames([doc._id])).get(doc._id.toString());
  return presentTransaction(doc, tags);
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

function snapshotTransaction(doc, tags) {
  return {
    type: doc.type,
    amount: doc.amount.toString(),
    transaction_date: doc.transaction_date.toISOString().slice(0, 10),
    account_id: doc.account_id.toString(),
    category_id: doc.category_id ? doc.category_id.toString() : null,
    payment_mode: doc.payment_mode,
    note: doc.note,
    tags: [...tags],
  };
}

function snapshotTransfer(doc) {
  return {
    amount: doc.amount.toString(),
    transaction_date: doc.transfer_date.toISOString().slice(0, 10),
    from_account_id: doc.from_account_id.toString(),
    to_account_id: doc.to_account_id.toString(),
    note: doc.note,
  };
}

/** Audit only what actually changed: the old and new value of each changed field. */
async function auditChange(userId, entityType, entityId, action, before, after, ip) {
  const oldValue = {};
  const newValue = {};

  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      oldValue[key] = before[key];
      newValue[key] = after[key];
    }
  }

  if (!Object.keys(newValue).length) return;

  await recordAudit({ userId, entityType, entityId, action, oldValue, newValue, ip });
}

