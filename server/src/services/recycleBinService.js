import Transaction from '../models/Transaction.js';
import Transfer from '../models/Transfer.js';
import TransactionTag from '../models/TransactionTag.js';
import Attachment from '../models/Attachment.js';
import { recordAudit } from './auditService.js';
import { deleteObject } from './storageService.js';

/**
 * The recycle bin - US-09 (#25), SRS REQ-29, BR-12.
 *
 * Deleting a transaction or transfer only sets is_deleted / deleted_at. A
 * deleted record is left out of balances, budgets and totals straight away,
 * can be restored for 30 days, and is then purged for good.
 */

export const RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Records deleted before this moment are past the restore window. */
export function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

/** Last moment a record deleted at `deletedAt` can be restored. */
export function restorableUntil(deletedAt) {
  return new Date(deletedAt.getTime() + RETENTION_DAYS * DAY_MS);
}

/** The caller's deleted records that can still be restored, newest deletion first. */
export async function listRecycleBin(userId, now = new Date()) {
  const filter = {
    user_id: userId,
    is_deleted: true,
    deleted_at: { $gte: retentionCutoff(now) },
  };

  const [transactions, transfers] = await Promise.all([
    Transaction.find(filter).sort({ deleted_at: -1 }),
    Transfer.find(filter).sort({ deleted_at: -1 }),
  ]);

  return { transactions, transfers };
}

/**
 * Permanently remove everything deleted more than 30 days ago, together with
 * its tag links and attachment records, so nothing is left orphaned (BR-12).
 *
 * Children are removed before the parent, so a crash part-way leaves the
 * parent still in the bin and the next run finishes the job.
 *
 * Each attachment's stored receipt file is deleted too (US-23). The records go
 * first and the files after, so a crash part-way leaves an unreferenced file
 * rather than a record pointing at a file that has gone.
 */
export async function purgeExpired(now = new Date()) {
  const expired = { is_deleted: true, deleted_at: { $lt: retentionCutoff(now) } };

  const [transactions, transfers] = await Promise.all([
    Transaction.find(expired).select('_id user_id').lean(),
    Transfer.find(expired).select('_id user_id').lean(),
  ]);

  const transactionIds = transactions.map((t) => t._id);
  const transferIds = transfers.map((t) => t._id);
  let attachments = 0;

  if (transactionIds.length) {
    await TransactionTag.deleteMany({ transaction_id: { $in: transactionIds } });
    const files = await Attachment.find({ transaction_id: { $in: transactionIds } })
      .select('object_key')
      .lean();
    const removed = await Attachment.deleteMany({ transaction_id: { $in: transactionIds } });
    attachments = removed.deletedCount;
    await Transaction.deleteMany({ _id: { $in: transactionIds }, ...expired });

    for (const file of files) {
      await deleteObject(file.object_key).catch((error) => {
        console.error('[purge] could not delete stored file:', error.message);
      });
    }
  }

  if (transferIds.length) {
    await Transfer.deleteMany({ _id: { $in: transferIds }, ...expired });
  }

  await recordAudit([
    ...transactions.map((t) => ({
      userId: t.user_id, entityType: 'transaction', entityId: t._id, action: 'purge',
    })),
    ...transfers.map((t) => ({
      userId: t.user_id, entityType: 'transfer', entityId: t._id, action: 'purge',
    })),
  ]);

  return { transactions: transactionIds.length, transfers: transferIds.length, attachments };
}
