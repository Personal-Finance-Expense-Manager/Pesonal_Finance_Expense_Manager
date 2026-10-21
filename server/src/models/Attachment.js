import mongoose from 'mongoose';

const attachmentSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transaction_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
  object_key: { type: String, required: true, trim: true },
  file_name: { type: String, required: true, trim: true, maxlength: 255 },
  mime_type: { type: String, required: true, trim: true, maxlength: 120 },
  size_bytes: { type: Number, required: true, min: 1, max: 10485760 },
  uploaded_at: { type: Date, default: Date.now },
}, { timestamps: true });

attachmentSchema.index({ user_id: 1, transaction_id: 1 });

export default mongoose.models.Attachment || mongoose.model('Attachment', attachmentSchema);
