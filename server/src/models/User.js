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

    email_verified: {
      type: Boolean,
      default: false,
    },

    // Email verification
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

    // US-04: Failed sign-in tracking and account lockout
    failed_sign_in_attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    sign_in_locked_until: {
      type: Date,
      default: null,
    },

    // US-04: Password reset tokens
    password_reset_token_hash: {
      type: String,
      select: false,
    },

    password_reset_expires_at: {
      type: Date,
      select: false,
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

    // US-25 (#61), REQ-93: the server distinguishes the User and the
    // Administrator role. The role is only ever read from this record, never
    // from the request, so a client cannot claim to be an administrator.
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.User ||
  mongoose.model('User', userSchema);