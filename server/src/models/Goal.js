
import mongoose from 'mongoose';
import {
  isPositiveMoney,
  isNonNegativeMoney,
} from '../utils/money.js';

const goalSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  target_amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    validate: {
      validator: isPositiveMoney,
      message:
        'Target amount must be positive and have at most two decimal places.',
    },
  },
  saved_amount: {
    type: mongoose.Schema.Types.Decimal128,
    default: '0.00',
    validate: {
      validator: isNonNegativeMoney,
      message:
        'Saved amount must be non-negative and have at most two decimal places.',
    },
  },
  target_date: {
    type: Date,
    default: null,
  },
  linked_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    default: null,
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'paused', 'cancelled'],
    default: 'active',
  },
}, {
  timestamps: true,
});

goalSchema.index({
  user_id: 1,
  status: 1,
});

export default mongoose.models.Goal ||
  mongoose.model('Goal', goalSchema);
