import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  kind: { type: String, enum: ['goal', 'import'], required: true },
  state: { type: String, enum: ['pending', 'committed'], default: 'pending' },
  // IDs and decimal deltas only; never CSV, notes, names, credentials or keys.
  goal_id: mongoose.Schema.Types.ObjectId,
  record_id: mongoose.Schema.Types.ObjectId,
  record_model: { type: String, enum: ['GoalContribution', 'GoalWithdrawal'] },
  delta: String,
  transactions: [mongoose.Schema.Types.ObjectId],
  transfers: [mongoose.Schema.Types.ObjectId],
  links: [mongoose.Schema.Types.ObjectId],
}, { timestamps: true, writeConcern: { w: 'majority', j: true } });
// Deliberately no TTL. An unresolved operation must remain visible until reconciled.
export default mongoose.models.FinancialOperation || mongoose.model('FinancialOperation', schema);
