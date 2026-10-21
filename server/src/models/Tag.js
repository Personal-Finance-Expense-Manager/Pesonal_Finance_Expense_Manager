import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 50 },
}, { timestamps: true });

tagSchema.index({ user_id: 1, name: 1 }, { unique: true });

export default mongoose.models.Tag || mongoose.model('Tag', tagSchema);
