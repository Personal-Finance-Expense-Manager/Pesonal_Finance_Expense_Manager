import mongoose from 'mongoose';
import { isPositiveMoney } from '../utils/money.js';

const goalWithdrawalSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  goal_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Goal',
    required: true,
    index: true,
  },
  destination_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    validate: {
      validator: isPositiveMoney,
      message: 'Withdrawal amount must be positive and have at most two decimal places.',
    },
  },
  withdrawal_date: {
    type: Date,
    required: true,
  },
}, { timestamps: true });

goalWithdrawalSchema.index({ user_id: 1, withdrawal_date: -1 });

export default mongoose.models.GoalWithdrawal ||
  mongoose.model('GoalWithdrawal', goalWithdrawalSchema);