import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  entity_type: { type: String, required: true, trim: true, maxlength: 80 },
  entity_id: { type: mongoose.Schema.Types.ObjectId, required: true },
  action: { type: String, required: true, trim: true, maxlength: 80 },
  old_value: { type: mongoose.Schema.Types.Mixed, default: null },
  new_value: { type: mongoose.Schema.Types.Mixed, default: null },
  ip_address: { type: String, default: null },
  timestamp: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

auditLogSchema.index({ user_id: 1, timestamp: -1 });
auditLogSchema.index({ entity_type: 1, entity_id: 1 });

export default mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
