
import mongoose from 'mongoose';
import { isPositiveMoney } from '../utils/money.js';

const transferSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  from_account_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  to_account_id: {
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
        'Transfer amount must be positive and have at most two decimal places.',
    },
  },
  transfer_date: {
    type: Date,
    required: true,
  },
  note: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: '',
  },
}, {
  timestamps: true,
});

transferSchema.index({
  user_id: 1,
  transfer_date: -1,
});

transferSchema.index({
  user_id: 1,
  from_account_id: 1,
  transfer_date: -1,
});

transferSchema.index({
  user_id: 1,
  to_account_id: 1,
  transfer_date: -1,
});

transferSchema.pre('validate', function validateAccounts() {
  if (
    this.from_account_id &&
    this.to_account_id &&
    this.from_account_id.equals(this.to_account_id)
  ) {
    this.invalidate(
      'to_account_id',
      'Source and destination accounts must be different.',
    );
  }
});

export default mongoose.models.Transfer ||
  mongoose.model('Transfer', transferSchema);
