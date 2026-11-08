import express from 'express';
import mongoose from 'mongoose';
import Attachment from '../models/Attachment.js';
import {
  addAttachment,
  findOwnedAttachment,
  listAttachments,
  presentAttachment,
  removeAttachment,
} from '../services/attachmentService.js';
import { readObject, isValidObjectKey } from '../services/storageService.js';
import User from '../models/User.js';
import { recordAudit } from '../services/auditService.js';
import { verifyAttachment } from '../utils/signedUrl.js';
import { sendApiError } from '../utils/apiError.js';
import {
  ATTACHMENT_RULES_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from '../validators/file.js';

/**
 * Receipt attachments - US-23 (#57), SRS REQ-79, REQ-80, REQ-81.
 *
 *   GET    /api/transactions/:id/attachments     list, with signed URLs   (signed in)
 *   POST   /api/transactions/:id/attachments     upload one file           (signed in)
 *   GET    /api/attachments/:id                  one, with fresh URLs      (signed in)
 *   DELETE /api/attachments/:id                  delete record and file    (signed in)
 *   GET    /api/attachments/:id/content          the file itself           (signed URL)
 *
 * The upload body is the raw file. The client sends the file's MIME type as
 * Content-Type and its name, URI-encoded, in X-File-Name. Sending the bytes
 * directly keeps the server free of a multipart parser.
 */

/** The API origin, so the signed URLs work from the client on another port. */
function apiOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// Read the raw file, refusing anything over 5 MB with the REQ-80 message.
const rawFile = express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES });

function readFile(req, res, next) {
  rawFile(req, res, (error) => {
    if (!error) return next();

    if (error.type === 'entity.too.large') {
      return res.status(413).json({
        message: `That file is larger than 5 MB. ${ATTACHMENT_RULES_MESSAGE}`,
      });
    }

    return next(error);
  });
}

// ---------------------------------------------------------------------------
// /api/transactions/:id/attachments  (mounted behind requireUser)
// ---------------------------------------------------------------------------

export const transactionAttachmentRoutes = express.Router({ mergeParams: true });

transactionAttachmentRoutes.get('/', async (req, res, next) => {
  try {
    const attachments = await listAttachments(req.user.id, req.params.id);
    const origin = apiOrigin(req);

    return res.json({
      data: attachments.map((attachment) => presentAttachment(attachment, origin)),
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

transactionAttachmentRoutes.post('/', readFile, async (req, res, next) => {
  try {
    const attachment = await addAttachment(
      req.user.id,
      req.params.id,
      {
        buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        fileName: req.get('X-File-Name'),
        mimeType: req.get('Content-Type'),
      },
      { ip: req.ip },
    );

    return res.status(201).json({
      message: 'Attachment added.',
      data: presentAttachment(attachment, apiOrigin(req)),
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// ---------------------------------------------------------------------------
// /api/attachments/:id/content  (NOT behind requireUser; the signature is the check)
// ---------------------------------------------------------------------------

export const attachmentFileRoutes = express.Router();

attachmentFileRoutes.get('/:id/content', async (req, res, next) => {
  try {
    const { id } = req.params;
    const refused = (reason, userId = null) => {
      // SEC-11: a refused file request is an authorization failure worth recording.
      void recordAudit({
        userId,
        category: 'authz',
        outcome: 'denied',
        action: 'attachment.access_denied',
        entityType: 'attachment',
        entityId: mongoose.isValidObjectId(id) ? id : null,
        ip: req.ip,
        metadata: { reason },
      });
      return res.status(403).json({
        message: 'This link has expired or is not valid. Open the attachment again from the transaction.',
      });
    };

    if (!mongoose.isValidObjectId(id)) return refused('invalid_id');

    const attachment = await Attachment.findById(id).lean();

    // A deleted attachment, or a URL for someone else's, gets the same answer
    // as a forged one: nothing about the file is revealed.
    if (!attachment || !isValidObjectKey(attachment.object_key)) return refused('not_found');

    const verdict = verifyAttachment(
      attachment._id.toString(),
      attachment.user_id.toString(),
      req.query.expires,
      req.query.signature,
    );

    if (verdict !== 'ok') return refused(verdict, attachment.user_id);

    // A signed link stops working the moment its owner is suspended or erased.
    const owner = await User.findById(attachment.user_id).select('status').lean();
    if (!owner || owner.status !== 'active') return refused('owner_inactive', attachment.user_id);

    let bytes;
    try {
      bytes = await readObject(attachment.object_key);
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ message: 'Attachment not found.' });
      throw error;
    }

    res.attachment(attachment.file_name);

    if (req.query.download !== '1') {
      res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
    }

    res.set({
      'Content-Type': attachment.mime_type,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // Whatever the file contains, the browser may not run it or let it reach the app.
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });

    return res.end(bytes);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// /api/attachments/:id  (mounted behind requireUser)
// ---------------------------------------------------------------------------

export const attachmentRoutes = express.Router();

attachmentRoutes.get('/:id', async (req, res, next) => {
  try {
    const attachment = await findOwnedAttachment(req.user.id, req.params.id);
    return res.json({ data: presentAttachment(attachment, apiOrigin(req)) });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

attachmentRoutes.delete('/:id', async (req, res, next) => {
  try {
    const data = await removeAttachment(req.user.id, req.params.id, { ip: req.ip });
    return res.json({ message: 'Attachment deleted.', data });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});
