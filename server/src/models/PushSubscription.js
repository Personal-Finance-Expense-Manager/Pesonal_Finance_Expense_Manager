import mongoose from 'mongoose';

/** US-17: a device's push subscription, stored for a future push provider. */
const pushSubscriptionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  endpoint: { type: String, required: true, maxlength: 2000 },
  keys: {
    p256dh: { type: String, maxlength: 500, default: null },
    auth: { type: String, maxlength: 500, default: null },
  },
}, { timestamps: true });

pushSubscriptionSchema.index({ user_id: 1, endpoint: 1 }, { unique: true });

export default mongoose.models.PushSubscription ||
  mongoose.model('PushSubscription', pushSubscriptionSchema);
