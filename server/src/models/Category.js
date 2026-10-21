import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['income', 'expense'],
    required: true,
  },
  parent_category_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
  },
  icon: { type: String, default: null },
  colour: { type: String, default: null },
  is_system: { type: Boolean, default: false },
}, { timestamps: true });

categorySchema.index({ user_id: 1, type: 1, name: 1 });
categorySchema.index({ parent_category_id: 1 });

export default mongoose.models.Category ||
  mongoose.model('Category', categorySchema);
