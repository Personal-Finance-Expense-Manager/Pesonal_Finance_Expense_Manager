import AuditLog from '../models/AuditLog.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Audit trail writer - US-26 (#62) REQ-96, US-28 (#67) SEC-11.
 *
 * Two ways to write:
 *
 *   recordAudit(entries)       best effort. A failure is reported on stderr but
 *                              never undoes or blocks the user's own change. Used
 *                              for ordinary events (sign-in, exports, edits).
 *   recordAuditStrict(entry)   throws if the record cannot be stored. Used where
 *                              the action must not happen unrecorded: administrator
 *                              actions and backup restoration.
 *
 * A best-effort failure is not silent: the event is written to stderr as one
 * JSON line of non-sensitive fields, so it can be recovered from the logs, and
 * counted (auditFailureCount) for health monitoring.
 *
 * Nothing sensitive is stored. Every value passes through sanitizeForAudit,
 * which drops secrets and replaces notes and money amounts with a marker.
 */

const SECRET_KEY = /pass(word)?|token|secret|jwt|authorization|cookie|signature|otp|verification|\bcode\b|(^|[_-])pin($|[_-])|[a-z]Pin$|hash|cvv|card|private|credential|api[-_]?key/i;
const FINANCIAL_KEY = /^(amount|converted_amount|balance|opening_balance|credit_limit|monthly_income|note|notes|description|exchange_rate|target_amount|current_amount)$/i;
const REDACTED = '[redacted]';
const MAX_DEPTH = 3;
const MAX_STRING = 200;

let failures = 0;
export const auditFailureCount = () => failures;

export function sanitizeForAudit(value, depth = 0, key = '') {
  if (value === null || value === undefined) return null;
  if (key && SECRET_KEY.test(key)) return REDACTED;
  if (key && FINANCIAL_KEY.test(key)) return REDACTED;
  if (depth > MAX_DEPTH) return REDACTED;

  if (value instanceof Date) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value.toString === 'function' && value._bsontype) return value.toString();

  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeForAudit(item, depth + 1));

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) out[k] = sanitizeForAudit(v, depth + 1, k);
    return out;
  }

  return REDACTED;
}

function toDocument(entry) {
  const doc = {
    user_id: entry.userId ?? null,
    actor_role: entry.actorRole ?? null,
    target_user_id: entry.targetUserId ?? null,
    category: entry.category ?? 'data',
    outcome: entry.outcome ?? 'success',
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    action: entry.action,
    old_value: sanitizeForAudit(entry.oldValue ?? null),
    new_value: sanitizeForAudit(entry.newValue ?? null),
    metadata: sanitizeForAudit(entry.metadata ?? null),
    ip_address: entry.ip ? String(entry.ip).slice(0, 64) : null,
  };
  if (entry.timestamp) doc.timestamp = entry.timestamp;
  return doc;
}

function reportFailure(list, error) {
  failures += list.length;
  for (const doc of list) {
    // Only non-sensitive identifying fields: enough to reconstruct that it happened.
    console.error(
      '[audit:FAILED]',
      JSON.stringify({
        action: doc.action,
        category: doc.category,
        outcome: doc.outcome,
        user_id: doc.user_id ? String(doc.user_id) : null,
        ip: doc.ip_address,
        at: new Date().toISOString(),
        reason: error.message,
      })
    );
  }
}

export async function recordAudit(entries) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean).map(toDocument);
  if (!list.length) return;

  try {
    await AuditLog.insertMany(list);
  } catch (error) {
    reportFailure(list, error);
  }
}

/** Store the record or throw. The caller must not carry out the action if this throws. */
export async function recordAuditStrict(entry) {
  const doc = toDocument(entry);
  try {
    await AuditLog.create(doc);
  } catch (error) {
    reportFailure([doc], error);
    throw new ApiError(503, 'The action was not carried out because it could not be recorded in the audit trail.');
  }
}

/** Shorthand used by routes: the actor and source IP come from the request. */
export function auditFromRequest(req, entry) {
  return recordAudit({
    userId: req.user?._id ?? req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    ip: req.ip,
    ...entry,
  });
}

export function auditStrictFromRequest(req, entry) {
  return recordAuditStrict({
    userId: req.user?._id ?? req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    ip: req.ip,
    ...entry,
  });
}
