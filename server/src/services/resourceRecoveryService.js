import mongoose from 'mongoose';
import Account from '../models/Account.js';
import Budget from '../models/Budget.js';
import Category from '../models/Category.js';
import Goal from '../models/Goal.js';
import Attachment from '../models/Attachment.js';
import Reminder from '../models/Reminder.js';
import RecurringRule from '../models/RecurringRule.js';
import Transaction from '../models/Transaction.js';
import { ApiError } from '../utils/apiError.js';
import { retentionCutoff, restorableUntil } from './recycleBinService.js';

export const RECOVERABLE = { accounts: Account, budgets: Budget, categories: Category,
  goals: Goal, attachments: Attachment, reminders: Reminder, 'recurring-rules': RecurringRule };
const deletedFilter = (resource) => resource === 'recurring-rules'
  ? { $or: [{ is_deleted: true }, { status: 'deleted' }] } : { is_deleted: true };

export async function softDeleteResource(document, now = new Date()) {
  document.is_deleted = true;
  document.deleted_at = now;
  await document.save();
}

export async function listDeletedResources(userId, now = new Date()) {
  const groups = await Promise.all(Object.entries(RECOVERABLE).map(async ([resource, Model]) => {
    const docs = await Model.find({ user_id: userId, ...deletedFilter(resource), deleted_at: { $gte: retentionCutoff(now) } }).withDeleted().lean();
    // Explicit allow-list: never return keys, financial notes, passwords or raw documents.
    return docs.map((doc) => ({ resource, id: String(doc._id), name: doc.name || doc.file_name || resource,
      deleted_at: doc.deleted_at, restorable_until: restorableUntil(doc.deleted_at) }));
  }));
  return groups.flat();
}

export async function restoreResource(userId, resource, id, now = new Date()) {
  const Model = Object.hasOwn(RECOVERABLE, resource) ? RECOVERABLE[resource] : null;
  if (!Model || !mongoose.isValidObjectId(id)) throw new ApiError(404, 'Recoverable resource not found.');
  const candidate = await Model.findOne({ _id: id, user_id: userId, ...deletedFilter(resource),
    deleted_at: { $gte: retentionCutoff(now) } }).withDeleted().lean();
  if (!candidate) throw new ApiError(404, 'Recoverable resource not found or its 30-day recovery window has expired.');
  for (const [field, Dependency] of [['account_id', Account], ['linked_account_id', Account], ['category_id', Category], ['parent_category_id', Category]]) {
    if (candidate[field] && !await Dependency.exists({ _id: candidate[field], user_id: userId })) {
      throw new ApiError(409, 'Restore the referenced account or category first.');
    }
  }
  if (resource === 'attachments') {
    if (!await Transaction.exists({ _id: candidate.transaction_id, user_id: userId, is_deleted: { $ne: true } })) {
      throw new ApiError(409, 'Restore the parent transaction first.');
    }
    if (await Attachment.countDocuments({ transaction_id: candidate.transaction_id, user_id: userId }) >= 3) {
      throw new ApiError(409, 'This transaction already has three attachments.');
    }
  }
  if (['accounts', 'categories'].includes(resource) && await Model.exists({ user_id: userId,
    name: candidate.name, ...(resource === 'categories' ? { type: candidate.type } : {}) }).collation({ locale: 'en', strength: 2 })) {
    throw new ApiError(409, 'An active item already uses that name. Rename it before restoring this item.');
  }
  if (resource === 'budgets' && await Budget.exists({ user_id: userId, category_id: candidate.category_id,
    period_start: candidate.period_start, period_end: candidate.period_end })) {
    throw new ApiError(409, 'An active budget already covers that category and period.');
  }
  const update = { is_deleted: false, deleted_at: null };
  // Recovered automation must be reviewed before generating payments again.
  if (resource === 'recurring-rules') update.status = 'paused';
  const doc = await Model.findOneAndUpdate({ _id: id, user_id: userId, ...deletedFilter(resource),
    deleted_at: { $gte: retentionCutoff(now) } }, { $set: update }, { new: true }).withDeleted();
  if (!doc) throw new ApiError(404, 'Recoverable resource not found or its 30-day recovery window has expired.');
  return { id: String(doc._id), resource };
}
