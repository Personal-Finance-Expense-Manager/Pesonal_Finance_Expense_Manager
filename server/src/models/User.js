import mongoose from 'mongoose';
import { hasAtMostTwoDecimalPlaces } from '../utils/money.js';
import fieldEncryption from './plugins/fieldEncryption.js';

// US-05: one enrolled device biometric (a WebAuthn credential).
const appLockCredentialSchema = new mongoose.Schema(
  {
    credential_id: { type: String, required: true },
    // Base64 SPKI DER public key used to verify unlock signatures.
    public_key: { type: String, required: true },
    sign_count: { type: Number, default: 0, min: 0 },
    transports: { type: [String], default: [] },
    created_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

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
      lowercase: true,
      trim: true,
    },

    // SEC-3: the email is stored encrypted. This keyed hash (HMAC-SHA256) is what
    // sign-in looks up and what keeps addresses unique. See plugins/fieldEncryption.js.
    email_hash: {
      type: String,
      select: false,
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

    // US-28 (SEC-13, DPDP Act): explicit consent to process personal data,
    // recorded with enough metadata to show what was agreed, when and to which notice.
    consent: {
      type: new mongoose.Schema(
        {
          personal_data_processing: { type: Boolean, default: false },
          policy_version: { type: String, default: null },
          purposes: { type: [String], default: [] },
          given_at: { type: Date, default: null },
          given_ip: { type: String, default: null },
          withdrawn_at: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: null,
    },

    // US-26 (REQ-94): who suspended the account, when and why (never shown to the user's data).
    suspended_at: { type: Date, default: null },
    suspended_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    suspension_reason: { type: String, default: null, maxlength: 300 },
    last_sign_in_at: { type: Date, default: null },

    // US-28 (SEC-13): set when the account was erased on the user's request.
    erased_at: { type: Date, default: null },

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

    // US-05 (REQ-11): the four-digit app-lock PIN. Never the PIN itself: a
    // bcrypt hash of an HMAC of the PIN (see services/appLockService.js).
    app_lock_pin_hash: {
      type: String,
      select: false,
    },

    // US-05: consecutive wrong PINs. Incremented atomically BEFORE the PIN is
    // compared, so parallel guesses cannot exceed the limit.
    app_lock_failed_attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    // US-05 (HI-2): device biometric credentials (WebAuthn platform
    // authenticators). Only the public key is stored - the fingerprint or face
    // never leaves the device.
    app_lock_credentials: {
      type: [appLockCredentialSchema],
      select: false,
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

userSchema.index({ email_hash: 1 }, { unique: true, partialFilterExpression: { email_hash: { $type: 'string' } } });
userSchema.index({ status: 1, createdAt: -1 });

userSchema.plugin(fieldEncryption, {
  fields: ['name', 'email', 'mobile_number'],
  blindIndex: { email: 'email_hash' },
});

export default mongoose.models.User ||
  mongoose.model('User', userSchema);