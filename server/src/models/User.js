import mongoose from 'mongoose';
import { hasAtMostTwoDecimalPlaces } from '../utils/money.js';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password_hash: { type: String, required: true, select: false },
  base_currency: { type: String, default: 'INR', uppercase: true },
  monthly_income: {
    type: mongoose.Schema.Types.Decimal128,
    default: '0.00',
    validate: {
      validator: hasAtMostTwoDecimalPlaces,
      message: 'Monthly income must have at most two decimal places.',
    },
  },
  month_start_day: { type: Number, min: 1, max: 28, default: 1 },
  app_lock_enabled: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['active', 'suspended', 'closed'],
    default: 'active',
  },
}, { timestamps: true });



export default mongoose.models.User ||
  mongoose.model('User', userSchema);
