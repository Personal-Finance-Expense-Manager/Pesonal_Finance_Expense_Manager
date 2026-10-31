import mongoose from 'mongoose';

const transactionTagSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  transaction_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true },
  tag_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tag', required: true },
}, { timestamps: true });

transactionTagSchema.index({ transaction_id: 1, tag_id: 1 }, { unique: true });
transactionTagSchema.index({ user_id: 1, transaction_id: 1 });
// US-27 (PER-10): the transaction list's tag filter looks up links by
// (user, tag); without this index that query scans every link the user has.
transactionTagSchema.index({ user_id: 1, tag_id: 1 });

export default mongoose.models.TransactionTag ||
  mongoose.model('TransactionTag', transactionTagSchema);
