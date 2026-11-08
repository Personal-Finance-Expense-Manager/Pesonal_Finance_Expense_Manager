import { recordAudit } from '../services/auditService.js';

/**
 * Request input guard - US-28 (#67), SEC-6 (NoSQL injection) and SEC-9.
 *
 * 1. MongoDB operator injection. A JSON body such as {"email": {"$ne": null}}
 *    or a query string such as ?a[$gt]= would reach a query as an operator.
 *    Any key that starts with "$" or contains "." in the body, query string or
 *    route parameters is refused (not silently stripped, so an attack is
 *    visible and the handler never runs on altered data).
 *
 * 2. Prohibited credentials (SEC-9). The product never collects bank
 *    passwords, card numbers, CVVs or UPI PINs. A request that carries such a
 *    field is refused, so they cannot be stored by accident or design.
 *
 * Schema validation of each field stays with the validators beside each route.
 */

const MAX_DEPTH = 8;

// Field names that would carry credentials the product must never hold.
const PROHIBITED_FIELD =
  /^(card[_-]?(number|no|num)|cvv2?|cvc2?|card[_-]?security[_-]?code|upi[_-]?pin|atm[_-]?pin|net[_-]?banking[_-]?(password|pin)|bank[_-]?(password|login|pin|credentials?)|account[_-]?password)$/i;

export function findUnsafeKey(value, depth = 0) {
  if (value === null || typeof value !== 'object') return null;
  if (depth > MAX_DEPTH) return { reason: 'too_deep', key: '' };

  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('.')) return { reason: 'operator_key', key };
    if (PROHIBITED_FIELD.test(key)) return { reason: 'prohibited_field', key };
    const nested = findUnsafeKey(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export default function inputGuard(req, res, next) {
  // File uploads are raw bytes (a Buffer), not JSON.
  const body = Buffer.isBuffer(req.body) ? null : req.body;
  const found = findUnsafeKey(body) || findUnsafeKey(req.query) || findUnsafeKey(req.params);

  if (!found) return next();

  void recordAudit({
    category: 'security',
    outcome: 'denied',
    action: found.reason === 'prohibited_field' ? 'request.prohibited_field' : 'request.injection_rejected',
    ip: req.ip,
    userId: req.user?._id ?? req.user?.id ?? null,
    // Only the offending key name, never a value.
    metadata: { key: String(found.key).slice(0, 60), path: (req.originalUrl || '').split('?')[0].slice(0, 120) },
  });

  return res.status(400).json({
    message:
      found.reason === 'prohibited_field'
        ? 'This application never collects card, bank or UPI credentials.'
        : 'The request contains invalid characters in a field name.',
  });
}
