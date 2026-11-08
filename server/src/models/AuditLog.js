import mongoose from 'mongoose';
import { auditRetentionDays } from '../config/security.js';

/**
 * Audit trail - US-26 (#62) REQ-96, US-28 (#67) SEC-11.
 *
 * Every record has the actor (user_id, null when nobody was signed in), the
 * action, a timestamp and the source IP. Records are append-only through the
 * application: updates and deletes are refused here, and no route lets an
 * ordinary user read them. They leave only when MongoDB's TTL monitor removes
 * them after `expires_at` (at least 12 months after they were written).
 */
export const AUDIT_CATEGORIES = [
  'data', // state changes to records (transaction edit, attachment upload ...)
  'auth', // sign-in, sign-out, registration, verification, password reset
  'authz', // permission / authorization failures
  'export', // data exports
  'bulk_delete', // deletions of many records at once
  'admin', // administrator actions
  'backup', // backup and restore
  'privacy', // consent, access, correction, erasure
  'security', // rate limiting, rejected input and other security signals
];

const auditLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actor_role: { type: String, enum: ['user', 'admin', null], default: null },
  target_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  category: { type: String, enum: AUDIT_CATEGORIES, default: 'data' },
  outcome: { type: String, enum: ['success', 'failure', 'denied'], default: 'success' },
  entity_type: { type: String, default: null, trim: true, maxlength: 80 },
  entity_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  action: { type: String, required: true, trim: true, maxlength: 80 },
  old_value: { type: mongoose.Schema.Types.Mixed, default: null },
  new_value: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  ip_address: { type: String, default: null, maxlength: 64 },
  timestamp: { type: Date, default: Date.now, index: true },
  // TTL: MongoDB deletes the record once this moment has passed.
  expires_at: {
    type: Date,
    default: () => new Date(Date.now() + auditRetentionDays() * 24 * 60 * 60 * 1000),
  },
}, { versionKey: false });

auditLogSchema.index({ user_id: 1, timestamp: -1 });
auditLogSchema.index({ entity_type: 1, entity_id: 1 });
auditLogSchema.index({ category: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

// Append-only: the application can add records but never change or remove them.
const REFUSED = [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
];

auditLogSchema.pre(REFUSED, function refuse() {
  throw new Error('Audit records are append-only.');
});

auditLogSchema.pre('save', function refuseChange() {
  if (!this.isNew) throw new Error('Audit records are append-only.');
});

auditLogSchema.pre('deleteOne', { document: true, query: false }, function refuseDocumentDelete() {
  throw new Error('Audit records are append-only.');
});

export default mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
