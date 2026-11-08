import { bcryptRounds } from '../config/security.js';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { recordAudit } from './auditService.js';

/**
 * The optional application lock - US-05 (#17), SRS REQ-11, SEC-8, HI-2.
 *
 * How it works
 * ------------
 * The lock is enforced by the SERVER, not by the screen. A signed-in session
 * of a user who has the lock on may call the API only while its
 * `app_unlocked_until` is in the future (middleware/authenticate.js answers
 * 423 otherwise).
 *
 *   - Entering the right PIN, or passing the device biometric, or signing in
 *     with the password, sets `app_unlocked_until` to now + two minutes.
 *   - While the app is on screen the client sends a heartbeat every 30
 *     seconds, which pushes it forward again.
 *   - A backgrounded tab, a closed browser or a locked phone sends nothing, so
 *     two minutes later the session is locked - REQ-11's "re-lock after two
 *     minutes in the background" - with no help from the client. The client
 *     also locks its own screen at once, but the server does not rely on that.
 *
 * The PIN
 * -------
 * Only four digits, so ten thousand possibilities. Two things make that
 * safe enough:
 *   1. It is never stored. What is stored is bcrypt (work factor 12, as REQ-6
 *      requires for passwords) of an HMAC-SHA-256 of the user id and the PIN,
 *      keyed with a server secret. A copy of the database alone cannot be
 *      searched offline for the PIN: the key is not in it.
 *   2. Guessing is capped. Five wrong PINs in a row revoke every session of the
 *      user, so the next attempt needs the account password (which has its own
 *      REQ-8 lockout). Attempts are counted atomically BEFORE the PIN is
 *      compared, so a burst of parallel guesses cannot get more than five.
 */

export const APP_LOCK_IDLE_MS = 2 * 60 * 1000; // REQ-11
export const MAX_PIN_ATTEMPTS = 5;
export const MAX_BIOMETRIC_DEVICES = 5;

const PIN_PATTERN = /^\d{4}$/;
const BCRYPT_WORK_FACTOR = bcryptRounds();

/** An error that carries the status and JSON body the client should see. */
export class LockError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'LockError';
    this.status = status;
    this.body = { message, ...extra };
  }
}

export function isValidPin(pin) {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

function pinSecret() {
  const secret = process.env.APP_LOCK_SECRET || process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    console.error('[app-lock] APP_LOCK_SECRET (or JWT_SECRET) is missing or too short.');
    throw new LockError(503, 'The app lock is not configured on the server.');
  }

  return secret;
}

function pinDigest(userId, pin) {
  return crypto
    .createHmac('sha256', pinSecret())
    .update(`app-lock-pin:${String(userId)}:${pin}`)
    .digest('hex');
}

export async function hashPin(userId, pin) {
  return bcrypt.hash(pinDigest(userId, pin), BCRYPT_WORK_FACTOR);
}

export async function pinMatchesHash(userId, pin, hash) {
  return bcrypt.compare(pinDigest(userId, pin), hash);
}

// ---------------------------------------------------------------------------
// Lock state of a session
// ---------------------------------------------------------------------------

export function unlockDeadline(now = Date.now()) {
  return new Date(now + APP_LOCK_IDLE_MS);
}

/** True when this session may use the API under the user's lock setting. */
export function sessionIsUnlocked(lockEnabled, unlockedUntil, now = Date.now()) {
  if (!lockEnabled) return true;

  return Boolean(unlockedUntil) && new Date(unlockedUntil).getTime() > now;
}

export function unlockSession(sessionId, now = Date.now()) {
  return Session.updateOne(
    { _id: sessionId },
    { $set: { app_unlocked_until: unlockDeadline(now) } }
  );
}

export function lockSession(sessionId) {
  return Session.updateOne({ _id: sessionId }, { $set: { app_unlocked_until: null } });
}

/** Other devices must enter the PIN too once the lock is turned on or changed. */
export function lockOtherSessions(userId, exceptSessionId) {
  return Session.updateMany(
    { user_id: userId, _id: { $ne: exceptSessionId }, revoked_at: null },
    { $set: { app_unlocked_until: null } }
  );
}

/**
 * Push the unlock window forward - but only if it is still open. A session
 * that has already re-locked cannot be quietly reopened by a heartbeat.
 */
export async function extendUnlockedSession(sessionId, now = Date.now()) {
  const result = await Session.updateOne(
    { _id: sessionId, revoked_at: null, app_unlocked_until: { $gt: new Date(now) } },
    { $set: { app_unlocked_until: unlockDeadline(now) } }
  );

  return result.matchedCount > 0;
}

export function revokeAllSessions(userId, now = new Date()) {
  return Session.updateMany(
    { user_id: userId, revoked_at: null },
    { $set: { revoked_at: now, app_unlocked_until: null } }
  );
}

// ---------------------------------------------------------------------------
// PIN verification with attempt limiting
// ---------------------------------------------------------------------------

function tooManyAttempts() {
  return new LockError(
    429,
    'Too many incorrect PINs. For your security you have been signed out. Sign in with your password to continue.',
    { signedOut: true }
  );
}

function audit(userId, action, ip) {
  return recordAudit({ userId, entityType: 'app_lock', entityId: userId, action, ip });
}

/**
 * Check a PIN for a user, counting the attempt. Returns on a match; throws
 * LockError otherwise (400 bad format, 401 wrong, 409 lock off, 429 too many).
 *
 * The PIN is never logged, audited or placed in an error.
 */
export async function verifyPinOrThrow(userId, pin, ip = null) {
  if (!isValidPin(pin)) {
    throw new LockError(400, 'Enter your four-digit PIN.', { code: 'INVALID_PIN_FORMAT' });
  }

  // Reserve the attempt first. Doing this as one atomic increment is what
  // stops parallel requests from each getting a "free" guess.
  const user = await User.findOneAndUpdate(
    { _id: userId, app_lock_enabled: true },
    { $inc: { app_lock_failed_attempts: 1 } },
    { new: true }
  ).select('+app_lock_pin_hash app_lock_failed_attempts');

  if (!user || !user.app_lock_pin_hash) {
    throw new LockError(409, 'The app lock is not turned on.', { code: 'APP_LOCK_NOT_ENABLED' });
  }

  const attempts = user.app_lock_failed_attempts;

  // Beyond the limit nothing is compared, whatever PIN arrives.
  if (attempts > MAX_PIN_ATTEMPTS) {
    await revokeAllSessions(user._id);
    throw tooManyAttempts();
  }

  if (!(await pinMatchesHash(user._id, pin, user.app_lock_pin_hash))) {
    await audit(user._id, 'pin_attempt_failed', ip);

    if (attempts >= MAX_PIN_ATTEMPTS) {
      await revokeAllSessions(user._id);
      await audit(user._id, 'pin_attempts_exceeded', ip);
      throw tooManyAttempts();
    }

    throw new LockError(401, 'Incorrect PIN.', {
      code: 'INCORRECT_PIN',
      attemptsRemaining: MAX_PIN_ATTEMPTS - attempts,
    });
  }

  await clearPinAttempts(user._id);
}

export function clearPinAttempts(userId) {
  return User.updateOne({ _id: userId }, { $set: { app_lock_failed_attempts: 0 } });
}

// ---------------------------------------------------------------------------
// Single-use WebAuthn challenges, kept on the session
// ---------------------------------------------------------------------------

export function storeChallenge(sessionId, purpose, challenge, ttlMs, now = Date.now()) {
  return Session.updateOne(
    { _id: sessionId },
    {
      $set: {
        webauthn_challenge: challenge,
        webauthn_challenge_purpose: purpose,
        webauthn_challenge_expires_at: new Date(now + ttlMs),
      },
    }
  );
}

/**
 * Take the challenge issued for `purpose`, if it is still valid, and delete it
 * in the same step - so a captured response cannot be replayed.
 */
export async function consumeChallenge(sessionId, purpose, now = Date.now()) {
  const session = await Session.findOneAndUpdate(
    {
      _id: sessionId,
      webauthn_challenge_purpose: purpose,
      webauthn_challenge_expires_at: { $gt: new Date(now) },
    },
    {
      $unset: {
        webauthn_challenge: 1,
        webauthn_challenge_purpose: 1,
        webauthn_challenge_expires_at: 1,
      },
    },
    { new: false }
  ).select('+webauthn_challenge');

  return session?.webauthn_challenge ?? null;
}

export { audit as recordLockAudit };
