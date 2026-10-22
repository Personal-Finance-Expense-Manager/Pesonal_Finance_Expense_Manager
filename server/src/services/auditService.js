import AuditLog from '../models/AuditLog.js';

/**
 * Write audit entries for transaction state changes (SRS 5.3 state model:
 * "every transition is written to AUDIT_LOG with the actor and timestamp").
 *
 * An audit failure is logged but never undoes or blocks the user's change.
 */
export async function recordAudit(entries) {
  const list = (Array.isArray(entries) ? entries : [entries]).map((entry) => ({
    user_id: entry.userId,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    action: entry.action,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    ip_address: entry.ip ?? null,
  }));

  if (!list.length) return;

  try {
    await AuditLog.insertMany(list);
  } catch (error) {
    console.error('[audit] could not write audit entry:', error.message);
  }
}
