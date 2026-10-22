import express from 'express';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import Account from '../models/Account.js';
import TransactionTag from '../models/TransactionTag.js';
import { validateTransactionInput } from '../validators/transaction.js';
import { createTransfer, presentTransfer } from '../services/transferService.js';
import {
  resolveTagIds,
  loadTagNames,
  presentTransaction,
  updateTransaction,
  deleteTransaction,
  restoreTransaction,
} from '../services/transactionService.js';
import { listRecycleBin, restorableUntil, RETENTION_DAYS } from '../services/recycleBinService.js';
import { sendApiError } from '../utils/apiError.js';

const router = express.Router();

// Create an income or expense transaction.
router.post('/', async (req, res, next) => {
  try {
    const result = validateTransactionInput(req.body);

    if (result.errors) {
      return res.status(400).json({
        message: 'Invalid transaction details.',
        errors: result.errors,
      });
    }

    const data = result.data;
    const userId = req.user.id;

    // REQ-24: a transfer is one linked record, not an income and an expense.
    if (data.type === 'transfer') {
      const transfer = await createTransfer(userId, data);

      return res.status(201).json({
        message: 'Transaction created successfully.',
        data: presentTransfer(transfer),
      });
    }

    const account = await Account.findOne({
      _id: data.account_id,
      user_id: userId,
      is_archived: false,
    });

    if (!account) {
      return res.status(404).json({
        message: 'Account not found or unavailable.',
      });
    }

    if (data.category_id) {
      const Category = mongoose.model('Category');
      const category = await Category.findOne({
        _id: data.category_id,
        user_id: userId,
      });

      if (!category) {
        return res.status(400).json({
          message: 'Select a valid category.',
        });
      }
    }

    const transaction = await Transaction.create({
      user_id: userId,
      account_id: data.account_id,
      category_id: data.category_id,
      type: data.type,
      amount: data.amount,
      currency: account.currency || 'INR',
      transaction_date: data.transaction_date,
      payment_mode: data.payment_mode,
      note: data.note,
    });

    try {
      if (data.tags.length) {
        const tagIds = await resolveTagIds(userId, data.tags);

        await TransactionTag.insertMany(
          tagIds.map((tagId) => ({
            user_id: userId,
            transaction_id: transaction._id,
            tag_id: tagId,
          })),
        );
      }
    } catch (error) {
      await Transaction.deleteOne({ _id: transaction._id, user_id: userId });
      throw error;
    }

    return res.status(201).json({
      message: 'Transaction created successfully.',
      data: {
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount.toString(),
        transaction_date: transaction.transaction_date,
        account_id: transaction.account_id,
        category_id: transaction.category_id,
        payment_mode: transaction.payment_mode,
        note: transaction.note,
        tags: data.tags,
      },
    });
  } catch (error) {
    sendApiError(res, next, error);
  }
});

// ---------------------------------------------------------------------------
// US-09 (#25): edit, delete and restore. REQ-28, REQ-29.
// ---------------------------------------------------------------------------

// List the caller's deleted transactions that can still be restored (REQ-29).
// Declared before the /:id routes so "recycle-bin" is never read as an id.
router.get('/recycle-bin', async (req, res, next) => {
  try {
    const { transactions, transfers } = await listRecycleBin(req.user.id);
    const tags = await loadTagNames(transactions.map((t) => t._id));

    const items = [
      ...transactions.map((t) => ({
        ...presentTransaction(t, tags.get(t._id.toString())),
        deleted_at: t.deleted_at,
        restorable_until: restorableUntil(t.deleted_at),
      })),
      ...transfers.map((t) => ({
        ...presentTransfer(t),
        deleted_at: t.deleted_at,
        restorable_until: restorableUntil(t.deleted_at),
      })),
    ].sort((a, b) => b.deleted_at - a.deleted_at);

    return res.json({ retention_days: RETENTION_DAYS, items });
  } catch (error) {
    next(error);
  }
});

// Edit any field of a transaction or transfer (REQ-28). Send only the fields to change.
router.patch('/:id', async (req, res, next) => {
  try {
    const data = await updateTransaction(req.user.id, req.params.id, req.body, { ip: req.ip });

    return res.json({ message: 'Transaction updated successfully.', data });
  } catch (error) {
    sendApiError(res, next, error);
  }
});

// Move a transaction or transfer to the recycle bin (REQ-29).
router.delete('/:id', async (req, res, next) => {
  try {
    const data = await deleteTransaction(req.user.id, req.params.id, { ip: req.ip });

    return res.json({
      message: `Transaction moved to the recycle bin. You can restore it within ${RETENTION_DAYS} days.`,
      data,
    });
  } catch (error) {
    sendApiError(res, next, error);
  }
});

// Restore a deleted transaction or transfer within 30 days (REQ-29).
router.post('/:id/restore', async (req, res, next) => {
  try {
    const data = await restoreTransaction(req.user.id, req.params.id, { ip: req.ip });

    return res.json({ message: 'Transaction restored successfully.', data });
  } catch (error) {
    sendApiError(res, next, error);
  }
});

export default router;
