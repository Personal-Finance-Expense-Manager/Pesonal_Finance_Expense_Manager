import recoverable from './plugins/recoverable.js';
import mongoose from 'mongoose';
import { isPositiveMoney } from '../utils/money.js';

/**
 * US-17 (#44), REQ-57 .. REQ-59: a bill reminder.
 *
 * `pending` is a bill not yet paid and not yet past due; `overdue` is one whose
 * due date has passed unpaid; `paid` is final. `completed` and `dismissed`
 * belong to the earlier stub of this model and are kept so old documents stay
 * valid; the application no longer sets them.
 */
const reminderSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    default: null,
    validate: {
      validator: (value) => value == null || isPositiveMoney(value),
      message: 'Reminder amount must be positive and have at most two decimal places.',
    },
  },
  due_date: { type: Date, required: true, index: true },
  notify_days_before: { type: Number, min: 0, max: 365, default: 3 },
  status: {
    type: String,
    enum: ['pending', 'overdue', 'paid', 'completed', 'dismissed'],
    default: 'pending',
  },
  linked_transaction_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  // Optional defaults that make "Mark as paid" a single tap.
  account_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
  category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  paid_at: { type: Date, default: null },
  // Set atomically by the first pay request; later requests find it taken.
  payment_claimed_at: { type: Date, default: null },
}, { timestamps: true });

reminderSchema.index({ user_id: 1, due_date: 1, status: 1 });
reminderSchema.index({ status: 1, due_date: 1 });

reminderSchema.plugin(recoverable);

export default mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);
