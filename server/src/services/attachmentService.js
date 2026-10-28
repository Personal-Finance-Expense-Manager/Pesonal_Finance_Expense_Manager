import mongoose from 'mongoose';
import Attachment from '../models/Attachment.js';
import Transaction from '../models/Transaction.js';
import { ApiError } from '../utils/apiError.js';
import { signAttachment } from '../utils/signedUrl.js';
import {
  MAX_ATTACHMENTS_PER_TRANSACTION,
  validateAttachment,
} from '../validators/file.js';
import { deleteObject, saveObject } from './storageService.js';
import { recordAudit } from './auditService.js';

/**
 * Receipt attachments - US-23 (#57), SRS REQ-79, REQ-80, REQ-81.
 *
 * Every lookup is scoped to the signed-in user. Anything the caller does not
 * own gets the same 404 as something that does not exist, so ids belonging to
 * other users cannot be discovered (SAF-8, ST_41).
 */

const TRANSACTION_NOT_FOUND = 'Transaction not found.';
const ATTACHMENT_NOT_FOUND = 'Attachment not found.';

function isObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value) && /^[a-f\d]{24}$/i.test(value);
}

async function findOwnedTransaction(userId, transactionId, { includeDeleted = false } = {}) {
  if (!isObjectId(transactionId)) throw new ApiError(404, TRANSACTION_NOT_FOUND);

  const filter = { _id: transactionId, user_id: userId };
  if (!includeDeleted) filter.is_deleted = { $ne: true };

  const transaction = await Transaction.findOne(filter).select('_id').lean();
  if (!transaction) throw new ApiError(404, TRANSACTION_NOT_FOUND);
  return transaction;
}

/** Find one of the caller's attachments, or 404. */
export async function findOwnedAttachment(userId, attachmentId) {
  if (!isObjectId(attachmentId)) throw new ApiError(404, ATTACHMENT_NOT_FOUND);

  const attachment = await Attachment.findOne({ _id: attachmentId, user_id: userId });
  if (!attachment) throw new ApiError(404, ATTACHMENT_NOT_FOUND);
  return attachment;
}

/**
 * API shape of an attachment, with fresh signed URLs for viewing (inline,
 * used for the thumbnail) and downloading. `baseUrl` is the API origin.
 */
export function presentAttachment(attachment, baseUrl = '', now = Date.now()) {
  const id = attachment._id.toString();
  const { expires, signature } = signAttachment(id, attachment.user_id.toString(), now);
  const query = `expires=${expires}&signature=${encodeURIComponent(signature)}`;
  const contentUrl = `${baseUrl}/api/attachments/${id}/content?${query}`;

  return {
    id,
    transaction_id: attachment.transaction_id.toString(),
    file_name: attachment.file_name,
    mime_type: attachment.mime_type,
    size_bytes: attachment.size_bytes,
    uploaded_at: attachment.uploaded_at,
    is_image: attachment.mime_type.startsWith('image/'),
    view_url: contentUrl,
    download_url: `${contentUrl}&download=1`,
    url_expires_at: new Date(expires * 1000).toISOString(),
  };
}

/** The caller's attachments on one of their transactions, oldest first. */
export async function listAttachments(userId, transactionId) {
  await findOwnedTransaction(userId, transactionId, { includeDeleted: true });

  return Attachment.find({ user_id: userId, transaction_id: transactionId })
    .sort({ uploaded_at: 1, _id: 1 });
}

/** Number of attachments per transaction id (Map of id string -> count). */
export async function countAttachments(userId, transactionIds) {
  const counts = new Map();
  if (!transactionIds.length) return counts;

  const rows = await Attachment.aggregate([
    {
      $match: {
        user_id: new mongoose.Types.ObjectId(String(userId)),
        transaction_id: { $in: transactionIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
      },
    },
    { $group: { _id: '$transaction_id', count: { $sum: 1 } } },
  ]);

  for (const row of rows) counts.set(row._id.toString(), row.count);
  return counts;
}

/**
 * Attach a file to one of the caller's transactions.
 * Rejects unsupported types and oversized files (REQ-80) and a fourth file (REQ-79).
 */
export async function addAttachment(userId, transactionId, file, { ip } = {}) {
  await findOwnedTransaction(userId, transactionId);

  const checked = validateAttachment(file);
  if (!checked.data) throw new ApiError(checked.status, checked.message);

  const existing = await Attachment.countDocuments({ user_id: userId, transaction_id: transactionId });

  if (existing >= MAX_ATTACHMENTS_PER_TRANSACTION) {
    throw new ApiError(
      409,
      `A transaction can have at most ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments. Delete one to add another.`,
    );
  }

  const objectKey = await saveObject(file.buffer, checked.data.storedExtension);

  let attachment;

  try {
    attachment = await Attachment.create({
      user_id: userId,
      transaction_id: transactionId,
      object_key: objectKey,
      file_name: checked.data.fileName,
      mime_type: checked.data.mimeType,
      size_bytes: checked.data.sizeBytes,
    });
  } catch (error) {
    // Never leave a stored file without a record pointing at it.
    await deleteObject(objectKey).catch(() => {});
    throw error;
  }

  // Two uploads racing past the count check could both succeed. Keep the
  // earliest three and remove whatever came after them.
  const all = await Attachment.find({ user_id: userId, transaction_id: transactionId })
    .sort({ uploaded_at: 1, _id: 1 })
    .select('_id')
    .lean();

  if (all.slice(MAX_ATTACHMENTS_PER_TRANSACTION).some((a) => a._id.equals(attachment._id))) {
    await Attachment.deleteOne({ _id: attachment._id });
    await deleteObject(objectKey).catch(() => {});
    throw new ApiError(
      409,
      `A transaction can have at most ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments. Delete one to add another.`,
    );
  }

  await recordAudit({
    userId,
    entityType: 'attachment',
    entityId: attachment._id,
    action: 'upload',
    newValue: {
      transaction_id: transactionId,
      file_name: attachment.file_name,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
    },
    ip,
  });

  return attachment;
}

/** Delete one of the caller's attachments and its stored file (REQ-81). */
export async function removeAttachment(userId, attachmentId, { ip } = {}) {
  const attachment = await findOwnedAttachment(userId, attachmentId);

  // Record first, file second: a crash in between leaves an unreferenced
  // file, never a record whose file has gone.
  await Attachment.deleteOne({ _id: attachment._id, user_id: userId });
  await deleteObject(attachment.object_key).catch((error) => {
    console.error('[attachments] could not delete stored file:', error.message);
  });

  await recordAudit({
    userId,
    entityType: 'attachment',
    entityId: attachment._id,
    action: 'delete',
    oldValue: {
      transaction_id: attachment.transaction_id.toString(),
      file_name: attachment.file_name,
    },
    ip,
  });

  return { id: attachment._id.toString() };
}
