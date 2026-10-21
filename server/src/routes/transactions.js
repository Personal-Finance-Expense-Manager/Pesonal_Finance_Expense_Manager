import express from 'express';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import Account from '../models/Account.js';
import Tag from '../models/Tag.js';
import TransactionTag from '../models/TransactionTag.js';
import { validateTransactionInput } from '../validators/transaction.js';

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
        const tagIds = [];

        for (const name of data.tags) {
          let tag = await Tag.findOne({
            user_id: userId,
            name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
          });

          if (!tag) {
            tag = await Tag.create({
              user_id: userId,
              name,
            });
          }

          tagIds.push(tag._id);
        }

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
    next(error);
  }
});

export default router;
