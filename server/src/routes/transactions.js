import express from 'express';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import Account from '../models/Account.js';
import Tag from '../models/Tag.js';
import TransactionTag from '../models/TransactionTag.js';
import { validateTransactionInput } from '../validators/transaction.js';

const router = express.Router();

// Escape user-provided text before using it in a regular expression.
const escapeRegex = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Browse, filter, search and paginate the current user's transactions.
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Aggregation pipelines do not automatically cast string IDs to ObjectIds.
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(401).json({
        message: 'Please sign in to continue.',
      });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const {
      page: pageParam = '1',
      limit: limitParam = '25',
      startDate,
      endDate,
      accountId,
      categoryId,
      type,
      tag,
      minAmount,
      maxAmount,
      search,
    } = req.query;

    const page = Number(pageParam);
    const limit = Number(limitParam);

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      return res.status(400).json({
        message: 'Page must be positive and limit must be between 1 and 100.',
      });
    }

    const query = {
      user_id: userObjectId,
      is_deleted: false,
    };

    const validDate = (value) => {
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
      ) {
        return false;
      }

      const parsed = new Date(`${value}T00:00:00.000Z`);

      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().startsWith(value)
      );
    };

    if (startDate && !validDate(startDate)) {
      return res.status(400).json({
        message: 'Invalid start date.',
      });
    }

    if (endDate && !validDate(endDate)) {
      return res.status(400).json({
        message: 'Invalid end date.',
      });
    }

    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({
        message: 'Start date cannot be after end date.',
      });
    }

    if (startDate || endDate) {
      query.transaction_date = {};

      if (startDate) {
        query.transaction_date.$gte =
          new Date(`${startDate}T00:00:00.000Z`);
      }

      if (endDate) {
        const exclusiveEnd =
          new Date(`${endDate}T00:00:00.000Z`);

        exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);

        query.transaction_date.$lt = exclusiveEnd;
      }
    }

    if (accountId) {
      if (!mongoose.isValidObjectId(accountId)) {
        return res.status(400).json({
          message: 'Invalid account ID.',
        });
      }

      query.account_id = new mongoose.Types.ObjectId(accountId);
    }

    if (categoryId) {
      if (!mongoose.isValidObjectId(categoryId)) {
        return res.status(400).json({
          message: 'Invalid category ID.',
        });
      }

      query.category_id = new mongoose.Types.ObjectId(categoryId);
    }

    if (type) {
      if (!['income', 'expense'].includes(type)) {
        return res.status(400).json({
          message: 'Invalid transaction type.',
        });
      }

      query.type = type;
    }

    const moneyPattern = /^\d+(?:\.\d{1,2})?$/;

    if (
      minAmount !== undefined &&
      (!moneyPattern.test(minAmount) ||
        !Number.isFinite(Number(minAmount)))
    ) {
      return res.status(400).json({
        message: 'Invalid minimum amount.',
      });
    }

    if (
      maxAmount !== undefined &&
      (!moneyPattern.test(maxAmount) ||
        !Number.isFinite(Number(maxAmount)))
    ) {
      return res.status(400).json({
        message: 'Invalid maximum amount.',
      });
    }

    if (
      minAmount !== undefined &&
      maxAmount !== undefined &&
      Number(minAmount) > Number(maxAmount)
    ) {
      return res.status(400).json({
        message: 'Minimum amount cannot exceed maximum amount.',
      });
    }

    if (minAmount !== undefined || maxAmount !== undefined) {
      query.amount = {};

      if (minAmount !== undefined) {
        query.amount.$gte =
          mongoose.Types.Decimal128.fromString(minAmount);
      }

      if (maxAmount !== undefined) {
        query.amount.$lte =
          mongoose.Types.Decimal128.fromString(maxAmount);
      }
    }

    if (search !== undefined) {
      if (typeof search !== 'string' || search.length > 200) {
        return res.status(400).json({
          message: 'Invalid search text.',
        });
      }

      if (search.trim()) {
        query.note = {
          $regex: escapeRegex(search.trim()),
          $options: 'i',
        };
      }
    }

    if (tag !== undefined && tag.trim()) {
      if (tag.length > 50) {
        return res.status(400).json({
          message: 'Tag name is too long.',
        });
      }

      const matchedTag = await Tag.findOne({
        user_id: userObjectId,
        name: {
          $regex: `^${escapeRegex(tag.trim())}$`,
          $options: 'i',
        },
      }).select('_id');

      const links = matchedTag
        ? await TransactionTag.find({
            user_id: userObjectId,
            tag_id: matchedTag._id,
          })
            .select('transaction_id')
            .lean()
        : [];

      query._id = {
        $in: links.map((link) => link.transaction_id),
      };
    }

    const [transactions, totalItems, totals] = await Promise.all([
      Transaction.find(query)
        .sort({ transaction_date: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('account_id', 'name currency')
        .populate('category_id', 'name')
        .lean(),

      Transaction.countDocuments(query),

      // Use an ObjectId in the shared query so aggregation matches
      // the same user as the transaction list and count queries.
      Transaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            amount: {
              $sum: '$amount',
            },
          },
        },
      ]),
    ]);

    const transactionIds = transactions.map((item) => item._id);

    const tagLinks = transactionIds.length
      ? await TransactionTag.find({
          user_id: userObjectId,
          transaction_id: {
            $in: transactionIds,
          },
        })
          .populate('tag_id', 'name')
          .lean()
      : [];

    const tagsByTransaction = new Map();

    for (const link of tagLinks) {
      const transactionKey = String(link.transaction_id);

      if (!tagsByTransaction.has(transactionKey)) {
        tagsByTransaction.set(transactionKey, []);
      }

      if (link.tag_id?.name) {
        tagsByTransaction
          .get(transactionKey)
          .push(link.tag_id.name);
      }
    }

    return res.status(200).json({
      data: transactions.map((item) => ({
        id: String(item._id),
        type: item.type,
        amount: item.amount.toString(),
        currency: item.currency,
        transaction_date: item.transaction_date,
        note: item.note,
        account_id: item.account_id?._id
          ? String(item.account_id._id)
          : null,
        account_name: item.account_id?.name || 'Unknown account',
        category_id: item.category_id?._id
          ? String(item.category_id._id)
          : null,
        category_name: item.category_id?.name || 'Uncategorized',
        tags: tagsByTransaction.get(String(item._id)) || [],
      })),

      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },

      totalAmount: totals[0]?.amount?.toString() || '0.00',
    });
  } catch (error) {
    next(error);
  }
});

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
            name: {
              $regex: `^${escapeRegex(name)}$`,
              $options: 'i',
            },
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
      await Transaction.deleteOne({
        _id: transaction._id,
        user_id: userId,
      });

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