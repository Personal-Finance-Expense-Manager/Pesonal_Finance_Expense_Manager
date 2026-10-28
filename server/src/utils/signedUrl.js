import crypto from 'node:crypto';

/**
 * Short-lived signed URLs for receipt files - US-23 (#57), SRS REQ-81.
 *
 * A browser <img> or a download link cannot send the Authorization header, so
 * the file route is not behind requireUser. Instead the owner asks for a URL
 * (which IS authenticated) and gets one that names the attachment, the owner
 * and an expiry, signed with HMAC-SHA256. The file route recomputes the
 * signature, refuses anything expired or altered, and checks the attachment
 * still belongs to the user the URL was issued to (ST_54).
 */

export const SIGNED_URL_TTL_SECONDS = 5 * 60;

function secret() {
  const value = process.env.ATTACHMENT_URL_SECRET || process.env.JWT_SECRET;

  if (!value || value.length < 32) {
    throw new Error('ATTACHMENT_URL_SECRET (or JWT_SECRET) must be at least 32 characters.');
  }

  return value;
}

function signature(attachmentId, userId, expires) {
  return crypto
    .createHmac('sha256', secret())
    .update(`attachment:${attachmentId}:${userId}:${expires}`)
    .digest('base64url');
}

/** Sign access to one attachment for one user. `expires` is Unix seconds. */
export function signAttachment(attachmentId, userId, now = Date.now(), ttl = SIGNED_URL_TTL_SECONDS) {
  const expires = Math.floor(now / 1000) + ttl;
  return {
    expires,
    signature: signature(String(attachmentId), String(userId), expires),
  };
}

/**
 * Check a signature. Returns 'ok', 'expired' or 'invalid'.
 * The comparison is constant-time so the signature cannot be guessed byte by byte.
 */
export function verifyAttachment(attachmentId, userId, expires, sig, now = Date.now()) {
  const exp = Number(expires);

  if (!Number.isInteger(exp) || typeof sig !== 'string' || !sig) return 'invalid';

  const expected = Buffer.from(signature(String(attachmentId), String(userId), exp));
  const given = Buffer.from(sig);

  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return 'invalid';
  }

  if (Math.floor(now / 1000) > exp) return 'expired';

  return 'ok';
}
