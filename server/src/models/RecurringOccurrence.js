import mongoose from 'mongoose';

/**
 * US-16 (REQ-60): the idempotency ledger for recurring generation.
 *
 * One row per (rule, scheduled date). The unique index is the database-level
 * guard against duplicates, however often or from however many processes the
 * scheduler runs. It is deliberately separate from the Transaction: a user can
 * delete a generated transaction and the recycle bin later purges it, but the
 * occurrence stays recorded, so it is never generated again.
 */
const recurringOccurrenceSchema = new mongoose.Schema({
  rule_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringRule', required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  scheduled_date: { type: Date, required: true },
  // claimed: reserved, transaction not yet recorded (or the process died)
  status: { type: String, enum: ['claimed', 'generated', 'skipped'], default: 'claimed' },
  transaction_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  skip_reason: { type: String, default: null, maxlength: 200 },
}, { timestamps: true });

recurringOccurrenceSchema.index({ rule_id: 1, scheduled_date: 1 }, { unique: true });
recurringOccurrenceSchema.index({ status: 1, updatedAt: 1 });

export default mongoose.models.RecurringOccurrence ||
  mongoose.model('RecurringOccurrence', recurringOccurrenceSchema);
