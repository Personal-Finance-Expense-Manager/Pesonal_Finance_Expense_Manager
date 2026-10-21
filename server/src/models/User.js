import mongoose from 'mongoose';
import { hasAtMostTwoDecimalPlaces } from '../utils/money.js';

const userSchema = new mongoose.Schema(
  {
    // Basic user information
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    mobile_number: {
      type: String,
      trim: true,
    },

    // Authentication
    password_hash: {
      type: String,
      required: true,
      select: false,
    },

    // Email verification
    email_verified: {
      type: Boolean,
      default: false,
    },

    email_verification_code_hash: {
      type: String,
      select: false,
    },

    email_verification_expires_at: {
      type: Date,
      select: false,
    },

    email_verification_attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    email_verification_resend_count: {
      type: Number,
      default: 0,
      min: 0,
    },

    email_verification_resend_window_started_at: {
      type: Date,
    },

    // User consent
    terms_accepted_at: {
      type: Date,
    },

    privacy_policy_accepted_at: {
      type: Date,
    },

    // Financial preferences
    base_currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },

    monthly_income: {
      type: mongoose.Schema.Types.Decimal128,
      default: '0.00',
      validate: {
        validator: hasAtMostTwoDecimalPlaces,
        message: 'Monthly income must have at most two decimal places.',
      },
    },

    month_start_day: {
      type: Number,
      min: 1,
      max: 28,
      default: 1,
    },

    // Application security settings
    app_lock_enabled: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ['active', 'suspended', 'closed'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.User ||
  mongoose.model('User', userSchema);