import mongoose from 'mongoose';
import { hasAtMostTwoDecimalPlaces } from '../utils/money.js';

const reminderSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    default: null,
    validate: { validator: hasAtMostTwoDecimalPlaces, message: 'Reminder amount must have at most two decimal places.' },
  },
  due_date: { type: Date, required: true, index: true },
  notify_days_before: { type: Number, min: 0, max: 365, default: 0 },
  status: { type: String, enum: ['pending', 'completed', 'dismissed'], default: 'pending' },
  linked_transaction_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
}, { timestamps: true });

reminderSchema.index({ user_id: 1, due_date: 1, status: 1 });

export default mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema);
