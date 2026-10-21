
import mongoose from 'mongoose';
import { isPositiveMoney } from '../utils/money.js';

const recurringRuleSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  category_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
  },
  type: {
    type: String,
    enum: ['income', 'expense'],
    required: true,
  },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    validate: {
      validator: isPositiveMoney,
      message:
        'Recurring amount must be positive and have at most two decimal places.',
    },
  },
  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'yearly'],
    required: true,
  },
  start_date: {
    type: Date,
    required: true,
  },
  end_date: {
    type: Date,
    default: null,
  },
  occurrence_count: {
    type: Number,
    min: 1,
    default: null,
  },
  next_due_date: {
    type: Date,
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['active', 'paused', 'completed'],
    default: 'active',
  },
}, {
  timestamps: true,
});

recurringRuleSchema.index({
  user_id: 1,
  next_due_date: 1,
  status: 1,
});

export default mongoose.models.RecurringRule ||
  mongoose.model('RecurringRule', recurringRuleSchema);
