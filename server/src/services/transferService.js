import Account from '../models/Account.js';
import Transfer from '../models/Transfer.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Transfers between a user's own accounts - US-08 (#24, REQ-24), reused by
 * US-09 (#25) for edit and delete.
 *
 * A transfer is ONE Transfer document that debits one account and credits the
 * other, so the two sides can never exist apart (DR-1) and net worth cannot
 * change (BR-2). Balances are derived from it (BR-3), so there is nothing to
 * keep in step.
 */

const ACCOUNT_UNAVAILABLE = 'Account not found or unavailable.';

/**
 * Load both accounts of a transfer. They must belong to the user and hold the
 * same currency (a transfer has no exchange rate, so mixing currencies would
 * give wrong balances). The accounts in `mustBeActive` must also not be
 * archived; an edit only needs that of an account it newly picks.
 */
export async function loadTransferAccounts(
  userId,
  fromId,
  toId,
  { mustBeActive = [fromId, toId] } = {},
) {
  const accounts = await Account.find({
    _id: { $in: [fromId, toId] },
    user_id: userId,
  }).lean();

  const unavailable =
    accounts.length !== 2 ||
    accounts.some(
      (account) =>
        account.is_archived &&
        mustBeActive.map(String).includes(account._id.toString()),
    );

  if (unavailable) {
    throw new ApiError(404, ACCOUNT_UNAVAILABLE);
  }

  if (accounts[0].currency !== accounts[1].currency) {
    throw new ApiError(400, 'Invalid transaction details.', {
      to_account_id:
        'Transfers between accounts in different currencies are not supported.',
    });
  }

  return accounts;
}

export async function createTransfer(userId, data) {
  await loadTransferAccounts(userId, data.from_account_id, data.to_account_id);

  return Transfer.create({
    user_id: userId,
    from_account_id: data.from_account_id,
    to_account_id: data.to_account_id,
    amount: data.amount,
    transfer_date: data.transaction_date,
    note: data.note,
  });
}

/** API shape for a transfer; mirrors the transaction response of POST /api/transactions. */
export function presentTransfer(transfer) {
  return {
    id: transfer._id,
    type: 'transfer',
    amount: transfer.amount.toString(),
    transaction_date: transfer.transfer_date,
    from_account_id: transfer.from_account_id,
    to_account_id: transfer.to_account_id,
    note: transfer.note,
  };
}

