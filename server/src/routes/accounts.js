import { Router } from 'express';
import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Account from '../models/Account.js';
import Transaction from '../models/Transaction.js';
import Transfer from '../models/Transfer.js';
import {
  validateNewAccount,
  validateAccountUpdate,
} from '../validators/account.js';

/**
 * Accounts and wallets - US-06 (#20), SRS 5.2, REQ-13 to REQ-18.
 *
 *   GET    /api/accounts              list (archived hidden unless ?includeArchived=true)
 *   POST   /api/accounts              create                       REQ-13, REQ-14, REQ-15
 *   GET    /api/accounts/:id          one account
 *   PATCH  /api/accounts/:id          edit name/type/currency/limit REQ-16
 *   POST   /api/accounts/:id/archive  archive                      REQ-17
 *   POST   /api/accounts/:id/restore  un-archive                   REQ-17
 *   DELETE /api/accounts/:id?confirm=true  delete if unused        REQ-18
 *
 * Every query is scoped to req.user.id, so one user can never see or change
 * another user's account; a foreign id simply returns 404.
 */
const router = Router();

// Names are unique per user regardless of letter case: "HDFC" and "hdfc"
// clash. Strength 2 = compare letters and accents but ignore case.
const NAME_COLLATION = { locale: 'en', strength: 2 };

const DUPLICATE_NAME_MESSAGE =
  'You already have an account with this name. Please choose a different name.';

function toMoney(value) {
  return value == null ? '0.00' : new Decimal(value.toString()).toFixed(2);
}

/** Shape an account document for the client. Decimal128 becomes a string. */
function present(account) {
  return {
    id: account._id.toString(),
    name: account.name,
    type: account.type,
    currency: account.currency,
    opening_balance: toMoney(account.opening_balance),
    credit_limit: toMoney(account.credit_limit),
    is_archived: Boolean(account.is_archived),
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

async function nameTaken(userId, name, exceptId) {
  const filter = { user_id: userId, name };
  if (exceptId) filter._id = { $ne: exceptId };
  const clash = await Account.findOne(filter).collation(NAME_COLLATION).lean();
  return Boolean(clash);
}

/** Load the caller's own account, or send 404 and return null. */
async function findOwnAccount(req, res) {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(404).json({ message: 'Account not found.' });
    return null;
  }

  const account = await Account.findOne({ _id: id, user_id: req.user.id });

  if (!account) {
    res.status(404).json({ message: 'Account not found.' });
    return null;
  }

  return account;
}

/** True if any income, expense or transfer uses this account. */
async function hasTransactions(userId, accountId) {
  // Soft-deleted transactions count too: they can still be restored (US-09).
  const [transaction, transfer] = await Promise.all([
    Transaction.exists({ user_id: userId, account_id: accountId }),
    Transfer.exists({
      user_id: userId,
      $or: [{ from_account_id: accountId }, { to_account_id: accountId }],
    }),
  ]);
  return Boolean(transaction || transfer);
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

// GET /api/accounts
router.get('/', async (req, res, next) => {
  try {
    const filter = { user_id: req.user.id };
    if (req.query.includeArchived !== 'true') filter.is_archived = false;

    const accounts = await Account.find(filter)
      .sort({ is_archived: 1, name: 1 })
      .collation(NAME_COLLATION)
      .lean();

    res.json({ accounts: accounts.map(present) });
  } catch (error) {
    next(error);
  }
});

// POST /api/accounts
router.post('/', async (req, res, next) => {
  try {
    const { data, errors } = validateNewAccount(req.body, req.user.baseCurrency);

    if (errors) {
      return res.status(400).json({ message: 'Please correct the highlighted fields.', errors });
    }

    if (await nameTaken(req.user.id, data.name)) {
      return res.status(409).json({
        message: DUPLICATE_NAME_MESSAGE,
        errors: { name: DUPLICATE_NAME_MESSAGE },
      });
    }

    const account = await Account.create({ ...data, user_id: req.user.id });
    return res.status(201).json({ message: 'Account created.', account: present(account) });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({
        message: DUPLICATE_NAME_MESSAGE,
        errors: { name: DUPLICATE_NAME_MESSAGE },
      });
    }
    return next(error);
  }
});

// GET /api/accounts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const account = await findOwnAccount(req, res);
    if (!account) return undefined;
    return res.json({ account: present(account) });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/accounts/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const account = await findOwnAccount(req, res);
    if (!account) return undefined;

    const { data, errors } = validateAccountUpdate(req.body, account.type);

    if (errors) {
      return res.status(400).json({ message: 'Please correct the highlighted fields.', errors });
    }

    if (data.name && await nameTaken(req.user.id, data.name, account._id)) {
      return res.status(409).json({
        message: DUPLICATE_NAME_MESSAGE,
        errors: { name: DUPLICATE_NAME_MESSAGE },
      });
    }

    account.set(data);
    await account.save();

    return res.json({ message: 'Account updated.', account: present(account) });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({
        message: DUPLICATE_NAME_MESSAGE,
        errors: { name: DUPLICATE_NAME_MESSAGE },
      });
    }
    return next(error);
  }
});

// POST /api/accounts/:id/archive
router.post('/:id/archive', async (req, res, next) => {
  try {
    const account = await findOwnAccount(req, res);
    if (!account) return undefined;

    account.is_archived = true;
    await account.save();

    return res.json({
      message: 'Account archived. It is hidden from new transactions but stays in your reports.',
      account: present(account),
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/accounts/:id/restore
router.post('/:id/restore', async (req, res, next) => {
  try {
    const account = await findOwnAccount(req, res);
    if (!account) return undefined;

    account.is_archived = false;
    await account.save();

    return res.json({ message: 'Account restored.', account: present(account) });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/accounts/:id?confirm=true
router.delete('/:id', async (req, res, next) => {
  try {
    const account = await findOwnAccount(req, res);
    if (!account) return undefined;

    // REQ-18: deletion needs an explicit confirmation.
    if (req.query.confirm !== 'true') {
      return res.status(400).json({
        message: 'Please confirm that you want to delete this account.',
        requiresConfirmation: true,
      });
    }

    // REQ-18: only an account with no transactions can be deleted; otherwise
    // the user is offered archiving instead.
    if (await hasTransactions(req.user.id, account._id)) {
      return res.status(409).json({
        message:
          'This account has transactions, so it cannot be deleted. ' +
          'You can archive it instead: it will be hidden from new entries ' +
          'but kept in your history and reports.',
        canArchive: true,
      });
    }

    await account.deleteOne();
    return res.json({ message: 'Account deleted.' });
  } catch (error) {
    return next(error);
  }
});

export default router;
