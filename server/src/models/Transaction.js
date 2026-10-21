import mongoose from 'mongoose';
import {
  hasAtMostTwoDecimalPlaces,
  isPositiveMoney,
  isPositiveDecimal,
} from '../utils/money.js';

const transactionSchema = new mongoose.Schema(
  {
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
      index: true,
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
    // Original transaction amount in the transaction currency.
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: isPositiveMoney,
        message:
          'Transaction amount must be positive and have at most two decimal places.',
      },
    },
    // Amount converted to the user's base currency.
    // Null is allowed for transactions that have not been converted.
    converted_amount: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
      validate: {
        validator: value =>
          value == null || isPositiveMoney(value),
        message:
          'Converted amount must be positive and have at most two decimal places.',
      },
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      default: 'INR',
      trim: true,
      minlength: 3,
      maxlength: 3,
    },
    // Stored conversion rate; do not recalculate historical transactions
    // using a later exchange rate.
    exchange_rate: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
      validate: {
        validator: value =>
          value == null || isPositiveDecimal(value),
        message:
          'Exchange rate must be a positive, finite decimal value.',
      },
    },
    transaction_date: {
      type: Date,
      required: true,
    },
    payment_mode: {
      type: String,
      enum: [
        'cash',
        'card',
        'upi',
        'bank_transfer',
        'wallet',
        'other',
      ],
      default: 'other',
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    is_excluded_from_budget: {
      type: Boolean,
      default: false,
    },
    is_deleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

transactionSchema.index({
  user_id: 1,
  transaction_date: -1,
});

transactionSchema.index({
  user_id: 1,
  category_id: 1,
  transaction_date: -1,
});

transactionSchema.index({
  user_id: 1,
  account_id: 1,
  transaction_date: -1,
});

transactionSchema.index(
  { deleted_at: 1 },
  { sparse: true },
);

transactionSchema.pre('validate', function validateDeletionDate() {
  if (this.is_deleted && !this.deleted_at) {
    this.deleted_at = new Date();
  }

  if (!this.is_deleted && this.deleted_at) {
    this.deleted_at = null;
  }
});

export default mongoose.models.Transaction ||
  mongoose.model('Transaction', transactionSchema);
