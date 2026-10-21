
import mongoose from 'mongoose';
import { isPositiveMoney } from '../utils/money.js';

const budgetSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  category_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
  },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    validate: {
      validator: isPositiveMoney,
      message:
        'Budget amount must be positive and have at most two decimal places.',
    },
  },
  period_type: {
    type: String,
    enum: ['weekly', 'monthly', 'yearly', 'custom'],
    required: true,
  },
  period_start: {
    type: Date,
    required: true,
  },
  period_end: {
    type: Date,
    required: true,
  },
  rollover_enabled: {
    type: Boolean,
    default: false,
  },
  repeat_enabled: {
    type: Boolean,
    default: false,
  },
  // REQ-46 / BR-6: each alert is raised only once per budget per period.
  // A budget covers exactly one period, so "sent" is recorded on the budget.
  warning_alert_sent_at: {
    type: Date,
    default: null,
  },
  over_budget_alert_sent_at: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

budgetSchema.index({
  user_id: 1,
  period_start: 1,
  period_end: 1,
});

budgetSchema.index({
  user_id: 1,
  category_id: 1,
  period_start: 1,
  period_end: 1,
});

budgetSchema.pre('validate', function validatePeriod() {
  if (
    this.period_start &&
    this.period_end &&
    this.period_end < this.period_start
  ) {
    this.invalidate(
      'period_end',
      'Period end must be on or after period start.',
    );
  }
});

export default mongoose.models.Budget ||
  mongoose.model('Budget', budgetSchema);
