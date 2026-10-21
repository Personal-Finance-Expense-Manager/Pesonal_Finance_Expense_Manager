import mongoose from 'mongoose';
import { hasAtMostTwoDecimalPlaces } from '../utils/money.js';

const accountSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['cash', 'bank', 'credit_card', 'wallet', 'investment', 'other'],
    required: true,
  },
  opening_balance: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    validate: {
      validator: hasAtMostTwoDecimalPlaces,
      message: 'Opening balance must have at most two decimal places.',
    },
  },
  currency: { type: String, required: true, uppercase: true, default: 'INR' },
  credit_limit: {
    type: mongoose.Schema.Types.Decimal128,
    default: '0.00',
    validate: {
      validator: hasAtMostTwoDecimalPlaces,
      message: 'Credit limit must have at most two decimal places.',
    },
  },
  // Credit cards only: day of the month the statement is due (REQ-21).
  statement_due_day: { type: Number, min: 1, max: 31, default: null },
  is_archived: { type: Boolean, default: false },
}, { timestamps: true });

accountSchema.index({ user_id: 1, name: 1 });

export default mongoose.models.Account ||
  mongoose.model('Account', accountSchema);
