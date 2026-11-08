import Decimal from 'decimal.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import FinancialOperation from '../models/FinancialOperation.js';
import Goal from '../models/Goal.js';
import GoalContribution from '../models/GoalContribution.js';
import GoalWithdrawal from '../models/GoalWithdrawal.js';
import Transaction from '../models/Transaction.js';
import Transfer from '../models/Transfer.js';
import TransactionTag from '../models/TransactionTag.js';
import { ApiError } from '../utils/apiError.js';

const scope = new AsyncLocalStorage();
const unavailable = () => new ApiError(503, 'Financial data is unavailable while an interrupted operation requires reconciliation. Do not retry the financial write.');
export const currentFinancialOperation = () => scope.getStore();

export async function saveOperationIntent(fields) {
  const operation = scope.getStore();
  if (!operation) throw new Error('Financial writes require a recovery journal.');
  Object.assign(operation, fields);
  await operation.save(); // acknowledgement before the first associated write
  return operation;
}

/** Offline-only reconciliation, or compensation owned by the executing request.
 * Idempotent even if a previous cleanup lost its acknowledgement. No ACID claim:
 * stop every API/scheduler instance before calling this on someone else's operation. */
export async function reconcileFinancialOperation(operation) {
  if (operation.kind === 'goal' && operation.goal_id) {
    if (operation.state !== 'committed') {
      const Model = operation.record_model === 'GoalContribution' ? GoalContribution : GoalWithdrawal;
      await Model.deleteOne({ _id: operation.record_id, user_id: operation.user_id, goal_id: operation.goal_id });
      const delta = mongoose.Types.Decimal128.fromString(new Decimal(operation.delta).negated().toFixed(2));
      await Goal.updateOne({ _id: operation.goal_id, user_id: operation.user_id,
        safety_operation_id: operation._id }, [
        { $set: { saved_amount: { $add: ['$saved_amount', delta] }, safety_operation_id: null } },
        { $set: { status: { $cond: [{ $gte: ['$saved_amount', '$target_amount'] }, 'completed', 'active'] } } },
      ]).withDeleted();
    } else {
      await Goal.updateOne({ _id: operation.goal_id, user_id: operation.user_id, safety_operation_id: operation._id },
        { $set: { safety_operation_id: null } }).withDeleted();
    }
  }
  if (operation.kind === 'import' && operation.state !== 'committed') {
    const results = await Promise.allSettled([
      (operation.links?.length || operation.transactions?.length) ? TransactionTag.deleteMany({ user_id: operation.user_id, $or: [
        { _id: { $in: operation.links || [] } }, { transaction_id: { $in: operation.transactions || [] } },
      ] }) : null,
      operation.transactions?.length ? Transaction.deleteMany({ user_id: operation.user_id, _id: { $in: operation.transactions } }) : null,
      operation.transfers?.length ? Transfer.deleteMany({ user_id: operation.user_id, _id: { $in: operation.transfers } }) : null,
    ]);
    if (results.some((result) => result.status === 'rejected')) throw unavailable();
  }
  await FinancialOperation.deleteOne({ _id: operation._id, user_id: operation.user_id });
}

export async function withFinancialOperation(userId, kind, action) {
  let operation;
  try { operation = await FinancialOperation.create({ user_id: userId, kind }); }
  catch { throw unavailable(); }
  return scope.run(operation, async () => {
    try {
      const result = await action();
      operation.state = 'committed';
      await operation.save();
      await reconcileFinancialOperation(operation);
      return result;
    } catch (error) {
      // A failed commit acknowledgement is ambiguous. Re-read the durable decision.
      let committed = operation.state === 'committed';
      try {
        const durable = await FinancialOperation.findById(operation._id);
        committed = durable?.state === 'committed';
        if (durable) await reconcileFinancialOperation(durable);
      } catch { throw unavailable(); }
      if (committed) throw new ApiError(503, 'The financial operation committed, but its response could not be completed. Refresh your data; do not repeat the write.');
      throw error;
    }
  });
}

export async function financialAvailability(req, res, next) {
  if (!req.user?.id || /^\/(auth|app-lock|health)(\/|$)/.test(req.path)) return next();
  try {
    if (await FinancialOperation.exists({ user_id: req.user.id })) {
      return res.status(503).json({ message: unavailable().message, code: 'FINANCIAL_RECONCILIATION_REQUIRED' });
    }
    return next();
  } catch { return res.status(503).json({ message: 'Financial data is unavailable.' }); }
}
