import mongoose from 'mongoose';
import { isPositiveMoney } from '../utils/money.js';

export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

/**
 * US-16 (#43), REQ-52 .. REQ-56, REQ-60.
 *
 * The schedule is stored as an anchor date plus a frequency. Occurrence k is
 * always computed from the anchor (utils/recurrence.js), never from the
 * previous occurrence, so a month-end clamp does not drift
 * (Jan 31 -> Feb 28 -> Mar 31).
 */
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
    enum: RECURRING_FREQUENCIES,
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
    enum: ['active', 'paused', 'completed', 'deleted'],
    default: 'active',
  },
  payment_mode: {
    type: String,
    enum: ['cash', 'card', 'upi', 'bank_transfer', 'wallet', 'other'],
    default: 'other',
  },
  note: {
    type: String,
    trim: true,
    maxlength: 200,
    default: '',
  },
  // Schedule bookkeeping. Occurrence k falls on occurrenceDate(anchor_date,
  // frequency, k); next_due_date is that of the next unprocessed k.
  anchor_date: {
    type: Date,
    required: true,
  },
  next_index: {
    type: Number,
    min: 0,
    default: 0,
  },
  // Occurrences processed over the rule's whole life (generated or skipped).
  occurrences_done: {
    type: Number,
    min: 0,
    default: 0,
  },
  last_generated_date: {
    type: Date,
    default: null,
  },
  paused_at: {
    type: Date,
    default: null,
  },
  deleted_at: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

recurringRuleSchema.index({
  user_id: 1,
  next_due_date: 1,
  status: 1,
});

recurringRuleSchema.index({ status: 1, next_due_date: 1 });

export default mongoose.models.RecurringRule ||
  mongoose.model('RecurringRule', recurringRuleSchema);
