import mongoose from 'mongoose';

/**
 * US-17 (REQ-57): one delivery attempt record per reminder, channel and
 * notification date. The unique index stops a reminder being sent twice on the
 * same channel, however often the scheduler runs.
 *
 * Status is honest: `sent` only when a real provider accepted the message.
 *   skipped_not_configured  no provider is set up for this channel
 *   logged_dev              printed to the console (DEV_EMAIL_CONSOLE), not sent
 */
const notificationDeliverySchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reminder_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Reminder', required: true },
  channel: { type: String, enum: ['in_app', 'email', 'push'], required: true },
  notify_for_date: { type: Date, required: true },
  status: {
    type: String,
    enum: ['pending', 'sent', 'failed', 'skipped_not_configured', 'logged_dev'],
    default: 'pending',
  },
  attempts: { type: Number, default: 0, min: 0 },
  next_attempt_at: { type: Date, default: null },
  last_error: { type: String, default: null, maxlength: 300 },
  sent_at: { type: Date, default: null },
}, { timestamps: true });

notificationDeliverySchema.index(
  { reminder_id: 1, channel: 1, notify_for_date: 1 },
  { unique: true },
);
notificationDeliverySchema.index({ status: 1, next_attempt_at: 1 });

export default mongoose.models.NotificationDelivery ||
  mongoose.model('NotificationDelivery', notificationDeliverySchema);
