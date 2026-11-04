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
    /**
     * A split bill - US-11 (#27), REQ-32.
     *
     * Empty for an ordinary transaction, which is attributed to category_id.
     * When it holds rows, they carry the category attribution instead and must
     * sum exactly to `amount`; category_id is then null, so there is never a
     * second, disagreeing answer to "which category was this?".
     */
    splits: {
      type: [
        {
          _id: false,
          category_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            default: null,
          },
          amount: {
            type: mongoose.Schema.Types.Decimal128,
            required: true,
          },
        },
      ],
      default: [],
    },
    // US-16 (REQ-54): set on transactions the scheduler generated from a
    // recurring rule. The user can still edit them like any other.
    is_system_generated: {
      type: Boolean,
      default: false,
    },
    recurring_rule_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RecurringRule',
      default: null,
    },
    // The original due date of the occurrence (REQ-60); it never changes,
    // even if the user later edits transaction_date.
    recurring_scheduled_date: {
      type: Date,
      default: null,
    },
    // US-17 (REQ-58): the bill reminder this expense paid.
    linked_reminder_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Reminder',
      default: null,
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

// US-16: one transaction per rule occurrence, enforced by the database.
transactionSchema.index(
  { recurring_rule_id: 1, recurring_scheduled_date: 1 },
  {
    unique: true,
    partialFilterExpression: { recurring_rule_id: { $type: 'objectId' } },
  },
);

// US-17: one expense per paid bill reminder.
transactionSchema.index(
  { linked_reminder_id: 1 },
  {
    unique: true,
    partialFilterExpression: { linked_reminder_id: { $type: 'objectId' } },
  },
);

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
