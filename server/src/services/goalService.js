import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import Goal from '../models/Goal.js';
import GoalContribution from '../models/GoalContribution.js';
import GoalWithdrawal from '../models/GoalWithdrawal.js';
import Account from '../models/Account.js';
import { accountSummary } from './balanceService.js';
import { ApiError } from '../utils/apiError.js';
import { today, formatDateOnly } from '../utils/period.js';

const ZERO = new Decimal(0);
const OBJECT_ID = /^[a-f\d]{24}$/i;

function money(value) {
  return new Decimal(value?.toString() ?? '0').toFixed(2);
}

function presentGoal(goal, contributions = [], withdrawals = []) {
  const target = new Decimal(goal.target_amount.toString());
  const saved = new Decimal(goal.saved_amount.toString());
  const remaining = Decimal.max(ZERO, target.minus(saved));
  const currentDay = today();

  const targetDay = goal.target_date
    ? new Date(Date.UTC(
      goal.target_date.getUTCFullYear(),
      goal.target_date.getUTCMonth(),
      goal.target_date.getUTCDate(),
    ))
    : null;

  const daysRemaining = targetDay
    ? Math.max(0, Math.ceil((targetDay - currentDay) / 86400000))
    : null;

  const monthsRemaining = daysRemaining === null
    ? null
    : Math.max(1, Math.ceil(daysRemaining / 30));

  const progress = target.greaterThan(0)
    ? saved.dividedBy(target).times(100)
    : ZERO;

  return {
    id: goal._id.toString(),
    name: goal.name,
    target_amount: target.toFixed(2),
    saved_amount: saved.toFixed(2),
    remaining_amount: remaining.toFixed(2),
    progress_percent: Math.min(100, Number(progress.toFixed(2))),
    target_date: goal.target_date ? formatDateOnly(goal.target_date) : null,
    days_remaining: daysRemaining,
    monthly_savings_required: monthsRemaining
      ? remaining.dividedBy(monthsRemaining)
        .toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2)
      : null,
    linked_account_id: goal.linked_account_id?.toString() ?? null,
    status: goal.status,
    contributions: contributions.map((item) => ({
      id: item._id.toString(),
      amount: money(item.amount),
      source_account_id: item.source_account_id.toString(),
      contribution_date: item.contribution_date,
    })),
    withdrawals: withdrawals.map((item) => ({
      id: item._id.toString(),
      amount: money(item.amount),
      destination_account_id: item.destination_account_id.toString(),
      withdrawal_date: item.withdrawal_date,
    })),
    created_at: goal.createdAt,
    updated_at: goal.updatedAt,
  };
}

async function findOwnedGoal(userId, goalId) {
  if (typeof goalId !== 'string' || !OBJECT_ID.test(goalId)) {
    throw new ApiError(404, 'Savings goal not found.');
  }

  const goal = await Goal.findOne({ _id: goalId, user_id: userId });

  if (!goal) throw new ApiError(404, 'Savings goal not found.');
  return goal;
}

async function accountBalance(userId, accountId) {
  const summary = await accountSummary(userId, 'INR');
  const position = summary.balances.find((item) => item.id === accountId.toString());

  if (!position) {
    throw new ApiError(404, 'Account balance could not be found.');
  }

  return new Decimal(position.current_balance);
}

export async function createGoal(userId, data) {
  if (data.linked_account_id) {
    const account = await Account.findOne({
      _id: data.linked_account_id,
      user_id: userId,
      is_archived: false,
    });

    if (!account) {
      throw new ApiError(404, 'Linked account not found or unavailable.');
    }
  }

  const goal = await Goal.create({
    user_id: userId,
    name: data.name,
    target_amount: data.target_amount,
    target_date: data.target_date,
    linked_account_id: data.linked_account_id || null,
  });

  return presentGoal(goal);
}

export async function listGoals(userId) {
  const goals = await Goal.find({ user_id: userId })
    .sort({ createdAt: -1 })
    .lean();

  return Promise.all(goals.map(async (goal) => {
    const [contributions, withdrawals] = await Promise.all([
      GoalContribution.find({
        user_id: userId,
        goal_id: goal._id,
      }).sort({ contribution_date: -1 }).lean(),

      GoalWithdrawal.find({
        user_id: userId,
        goal_id: goal._id,
      }).sort({ withdrawal_date: -1 }).lean(),
    ]);

    return presentGoal(goal, contributions, withdrawals);
  }));
}

export async function getGoal(userId, goalId) {
  const goal = await findOwnedGoal(userId, goalId);

  const [contributions, withdrawals] = await Promise.all([
    GoalContribution.find({
      user_id: userId,
      goal_id: goal._id,
    }).sort({ contribution_date: -1 }).lean(),

    GoalWithdrawal.find({
      user_id: userId,
      goal_id: goal._id,
    }).sort({ withdrawal_date: -1 }).lean(),
  ]);

  return presentGoal(goal, contributions, withdrawals);
}

export async function updateGoal(userId, goalId, data) {
  const goal = await findOwnedGoal(userId, goalId);

  if (goal.status === 'completed') {
    throw new ApiError(400, 'An achieved goal cannot be edited.');
  }

  if (data.linked_account_id) {
    const account = await Account.findOne({
      _id: data.linked_account_id,
      user_id: userId,
      is_archived: false,
    });

    if (!account) {
      throw new ApiError(404, 'Linked account not found or unavailable.');
    }
  }

  if (data.name !== undefined) goal.name = data.name;

  if (data.target_amount !== undefined) {
    if (new Decimal(data.target_amount).lessThan(goal.saved_amount.toString())) {
      throw new ApiError(
        400,
        'Target amount cannot be less than the amount already saved.',
      );
    }

    goal.target_amount = data.target_amount;
  }

  if (data.target_date !== undefined) goal.target_date = data.target_date;

  if (data.linked_account_id !== undefined) {
    goal.linked_account_id = data.linked_account_id || null;
  }

  await goal.save();
  return presentGoal(goal);
}

export async function contributeToGoal(userId, goalId, data) {
  const goal = await findOwnedGoal(userId, goalId);

  if (goal.status !== 'active') {
    throw new ApiError(400, 'This goal is no longer accepting contributions.');
  }

  const amount = new Decimal(String(data.amount));

  if (!amount.isFinite() || !amount.greaterThan(0) || amount.decimalPlaces() > 2) {
    throw new ApiError(
      400,
      'Contribution amount must be positive with at most two decimal places.',
    );
  }

  const sourceId = data.source_account_id || goal.linked_account_id?.toString();

  if (!sourceId || !mongoose.isValidObjectId(sourceId)) {
    throw new ApiError(400, 'Select a valid source account.');
  }

  const account = await Account.findOne({
    _id: sourceId,
    user_id: userId,
    is_archived: false,
  });

  if (!account) {
    throw new ApiError(404, 'Source account not found or unavailable.');
  }

  if (account.type === 'credit_card') {
    throw new ApiError(
      400,
      'A credit card cannot be used as a savings source account.',
    );
  }

  // REQ-64: Reject contributions exceeding the available balance.
  const availableBalance = await accountBalance(userId, account._id);

  if (availableBalance.lessThan(amount)) {
    throw new ApiError(
      400,
      `Insufficient account balance. Available balance: ${availableBalance.toFixed(2)}.`,
    );
  }

  const decimalAmount = mongoose.Types.Decimal128.fromString(amount.toFixed(2));

  const updatedGoal = await Goal.findOneAndUpdate(
    {
      _id: goal._id,
      user_id: userId,
      status: 'active',
      $expr: {
        $lte: [
          { $add: ['$saved_amount', decimalAmount] },
          '$target_amount',
        ],
      },
    },
    { $inc: { saved_amount: decimalAmount } },
    { new: true },
  );

  if (!updatedGoal) {
    throw new ApiError(
      400,
      'Contribution exceeds the remaining goal amount, or the goal is no longer active.',
    );
  }

  try {
    await GoalContribution.create({
      user_id: userId,
      goal_id: goal._id,
      source_account_id: account._id,
      amount: decimalAmount,
      contribution_date: today(),
    });
  } catch (error) {
    await Goal.updateOne(
      { _id: goal._id, user_id: userId },
      {
        $inc: {
          saved_amount: mongoose.Types.Decimal128.fromString(
            amount.negated().toFixed(2),
          ),
        },
      },
    );

    throw error;
  }

  if (
    new Decimal(updatedGoal.saved_amount.toString())
      .greaterThanOrEqualTo(updatedGoal.target_amount.toString())
  ) {
    updatedGoal.status = 'completed';
    await updatedGoal.save();
  }

  return getGoal(userId, goalId);
}

/**
 * REQ-67: Withdraw saved money back into a user's account.
 */
export async function withdrawFromGoal(userId, goalId, data) {
  const goal = await findOwnedGoal(userId, goalId);

  if (!['active', 'completed'].includes(goal.status)) {
    throw new ApiError(400, 'This goal does not allow withdrawals.');
  }

  const amount = new Decimal(String(data.amount));

  if (!amount.isFinite() || !amount.greaterThan(0) || amount.decimalPlaces() > 2) {
    throw new ApiError(
      400,
      'Withdrawal amount must be positive with at most two decimal places.',
    );
  }

  const destinationId = data.destination_account_id;

  if (!destinationId || !mongoose.isValidObjectId(destinationId)) {
    throw new ApiError(400, 'Select a valid destination account.');
  }

  const account = await Account.findOne({
    _id: destinationId,
    user_id: userId,
    is_archived: false,
  });

  if (!account) {
    throw new ApiError(404, 'Destination account not found or unavailable.');
  }

  if (account.type === 'credit_card') {
    throw new ApiError(
      400,
      'A credit card cannot be used as a withdrawal destination.',
    );
  }

  const decimalAmount = mongoose.Types.Decimal128.fromString(amount.toFixed(2));

  // Atomic conditional update prevents withdrawing more than saved.
  const updatedGoal = await Goal.findOneAndUpdate(
    {
      _id: goal._id,
      user_id: userId,
      status: { $in: ['active', 'completed'] },
      saved_amount: { $gte: decimalAmount },
    },
    {
      $inc: {
        saved_amount: mongoose.Types.Decimal128.fromString(
          amount.negated().toFixed(2),
        ),
      },
    },
    { new: true },
  );

  if (!updatedGoal) {
    throw new ApiError(
      400,
      'Withdrawal amount exceeds the available savings in this goal.',
    );
  }

  try {
    await GoalWithdrawal.create({
      user_id: userId,
      goal_id: goal._id,
      destination_account_id: account._id,
      amount: decimalAmount,
      withdrawal_date: today(),
    });
  } catch (error) {
    await Goal.updateOne(
      { _id: goal._id, user_id: userId },
      {
        $inc: {
          saved_amount: decimalAmount,
        },
      },
    );

    throw error;
  }

  // A completed goal becomes active again if money is withdrawn.
  if (
    new Decimal(updatedGoal.saved_amount.toString())
      .lessThan(updatedGoal.target_amount.toString())
  ) {
    updatedGoal.status = 'active';
    await updatedGoal.save();
  }

  return getGoal(userId, goalId);
}

export async function deleteGoal(userId, goalId) {
  const goal = await findOwnedGoal(userId, goalId);

  await Promise.all([
    GoalContribution.deleteMany({
      user_id: userId,
      goal_id: goal._id,
    }),

    GoalWithdrawal.deleteMany({
      user_id: userId,
      goal_id: goal._id,
    }),
  ]);

  await goal.deleteOne();

  return { id: goal._id.toString() };
}