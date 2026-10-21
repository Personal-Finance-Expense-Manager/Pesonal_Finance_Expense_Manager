
import mongoose from 'mongoose';
import { isPositiveMoney } from '../utils/money.js';

const goalContributionSchema = new mongoose.Schema({
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
  source_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    validate: {
      validator: isPositiveMoney,
      message:
        'Contribution amount must be positive and have at most two decimal places.',
    },
  },
  contribution_date: {
    type: Date,
    required: true,
  },
}, {
  timestamps: true,
});

goalContributionSchema.index({
  user_id: 1,
  contribution_date: -1,
});

export default mongoose.models.GoalContribution ||
  mongoose.model('GoalContribution', goalContributionSchema);
