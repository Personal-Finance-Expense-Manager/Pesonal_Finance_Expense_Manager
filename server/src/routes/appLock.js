import { Router } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Session from '../models/Session.js';
import authenticate from '../middleware/authenticate.js';
import { sendAccountLockoutEmail } from './auth.js';
import {
  APP_LOCK_IDLE_MS,
  MAX_BIOMETRIC_DEVICES,
  LockError,
  clearPinAttempts,
  consumeChallenge,
  extendUnlockedSession,
  hashPin,
  isValidPin,
  lockOtherSessions,
  lockSession,
  recordLockAudit,
  storeChallenge,
  unlockSession,
  verifyPinOrThrow,
} from '../services/appLockService.js';
import {
  CHALLENGE_TTL_MS,
  WebAuthnError,
  buildAuthenticationOptions,
  buildRegistrationOptions,
  newChallenge,
  relyingParty,
  verifyAssertion,
  verifyRegistration,
} from '../services/webauthnService.js';

/**
 * /api/app-lock - US-05 (#17), SRS REQ-11, SEC-8, HI-2. See
 * services/appLockService.js for how the lock works.
 *
 * Every route here needs a real session token (authenticate), never the
 * development X-User-Id header: the lock state lives on the session, and the
 * caller is always the session's own user - no route accepts a user id.
 *
 * The routes marked `whileLocked` are the ones a locked session may still call:
 * the lock status, the heartbeat, locking, unlocking and the forgot-PIN reset.
 * Everything that changes or removes the lock needs an unlocked session.
 */
const router = Router();

const LOCKOUT_MS = 15 * 60 * 1000; // REQ-8
const MAX_PASSWORD_ATTEMPTS = 5; // REQ-8

function whileLocked(req, res, next) {
  req.allowWhileLocked = true;
  next();
}

/** Run a handler, turning a LockError into its response and anything else into a 500. */
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof LockError) {
        return res.status(error.status).json(error.body);
      }

      // Only the message: a request body must never reach the log.
      console.error('[app-lock] Request failed:', error.message);

      return res.status(500).json({ message: 'Unable to process the app-lock request.' });
    }
  };
}

/** What the client may know about the lock. No hash, no key, no credential id. */
async function statusFor(userId, sessionId, now = Date.now()) {
  const [user, session] = await Promise.all([
    User.findById(userId).select('app_lock_enabled +app_lock_credentials').lean(),
    Session.findById(sessionId).select('app_unlocked_until').lean(),
  ]);

  const enabled = user?.app_lock_enabled === true;
  const until = session?.app_unlocked_until ? new Date(session.app_unlocked_until) : null;
  const unlocked = Boolean(until) && until.getTime() > now;

  return {
    enabled,
    locked: enabled && !unlocked,
    biometricDevices: enabled ? (user.app_lock_credentials || []).length : 0,
    idleLockSeconds: APP_LOCK_IDLE_MS / 1000,
    unlockedUntil: enabled && unlocked ? until.toISOString() : null,
  };
}

async function sendStatus(res, req, status = 200, message) {
  const body = await statusFor(req.user._id, req.authSession._id);
  if (message) body.message = message;

  return res.status(status).json(body);
}

function requireEnabled(req) {
  if (req.user.app_lock_enabled !== true) {
    throw new LockError(409, 'The app lock is not turned on.', { code: 'APP_LOCK_NOT_ENABLED' });
  }
}

function requirePinFormat(pin, message = 'Enter a four-digit PIN (digits only).') {
  if (!isValidPin(pin)) {
    throw new LockError(400, message, { code: 'INVALID_PIN_FORMAT' });
  }
}

// ---------------------------------------------------------------------------
// Status, heartbeat, lock, unlock
// ---------------------------------------------------------------------------

// GET /api/app-lock/status
router.get('/status', whileLocked, authenticate, handle(async (req, res) => {
  return sendStatus(res, req);
}));

// POST /api/app-lock/heartbeat
// Sent every 30 seconds while the app is on screen. It keeps an unlocked
// session unlocked; it can never unlock a locked one.
router.post('/heartbeat', whileLocked, authenticate, handle(async (req, res) => {
  if (req.user.app_lock_enabled === true) {
    await extendUnlockedSession(req.authSession._id);
  }

  return sendStatus(res, req);
}));

// POST /api/app-lock/lock
router.post('/lock', whileLocked, authenticate, handle(async (req, res) => {
  requireEnabled(req);

  await lockSession(req.authSession._id);

  return sendStatus(res, req, 200, 'The app is locked.');
}));

// POST /api/app-lock/unlock   { method: 'pin', pin }  or  { method: 'biometric', credential }
router.post('/unlock', whileLocked, authenticate, handle(async (req, res) => {
  requireEnabled(req);

  const { method } = req.body ?? {};

  if (method === 'pin') {
    await verifyPinOrThrow(req.user._id, req.body.pin, req.ip);
  } else if (method === 'biometric') {
    await verifyBiometric(req);
  } else {
    throw new LockError(400, 'Choose PIN or biometric to unlock.');
  }

  await unlockSession(req.authSession._id);
  await recordLockAudit(req.user._id, `unlocked_with_${method}`, req.ip);

  return sendStatus(res, req, 200, 'Unlocked.');
}));

// ---------------------------------------------------------------------------
// Turning the lock on, changing the PIN, forgetting the PIN, turning it off
// ---------------------------------------------------------------------------

// POST /api/app-lock/pin   { pin, confirmPin? }   - turn the lock on
router.post('/pin', authenticate, handle(async (req, res) => {
  const { pin, confirmPin } = req.body ?? {};

  requirePinFormat(pin);

  if (confirmPin !== undefined && confirmPin !== pin) {
    throw new LockError(400, 'The two PINs do not match.');
  }

  const hash = await hashPin(req.user._id, pin);

  const user = await User.findOneAndUpdate(
    { _id: req.user._id, app_lock_enabled: { $ne: true } },
    {
      $set: {
        app_lock_enabled: true,
        app_lock_pin_hash: hash,
        app_lock_failed_attempts: 0,
      },
    },
    { new: true }
  );

  if (!user) {
    throw new LockError(409, 'The app lock is already on. Change your PIN instead.');
  }

  // This device just proved itself by being signed in; every other signed-in
  // device must now enter the PIN.
  await unlockSession(req.authSession._id);
  await lockOtherSessions(req.user._id, req.authSession._id);
  await recordLockAudit(req.user._id, 'enabled', req.ip);

  return sendStatus(res, req, 201, 'The app lock is on.');
}));

// POST /api/app-lock/pin/change   { currentPin, newPin }
router.post('/pin/change', authenticate, handle(async (req, res) => {
  const { currentPin, newPin } = req.body ?? {};

  requirePinFormat(newPin, 'Enter a new four-digit PIN (digits only).');

  await verifyPinOrThrow(req.user._id, currentPin, req.ip);

  const hash = await hashPin(req.user._id, newPin);

  await User.updateOne(
    { _id: req.user._id },
    { $set: { app_lock_pin_hash: hash, app_lock_failed_attempts: 0 } }
  );

  await lockOtherSessions(req.user._id, req.authSession._id);
  await recordLockAudit(req.user._id, 'pin_changed', req.ip);

  return sendStatus(res, req, 200, 'Your PIN was changed.');
}));

// POST /api/app-lock/pin/reset   { password, newPin }   - forgot the PIN
// The account password stands in for the PIN. Wrong passwords count toward the
// same five-failure, fifteen-minute sign-in lockout as the sign-in screen
// (REQ-8), so this route is no easier to guess against than signing in.
router.post('/pin/reset', whileLocked, authenticate, handle(async (req, res) => {
  const { password, newPin } = req.body ?? {};

  requireEnabled(req);
  requirePinFormat(newPin, 'Enter a new four-digit PIN (digits only).');

  if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
    throw new LockError(400, 'Enter your account password.');
  }

  const now = new Date();
  const user = await User.findById(req.user._id).select('+password_hash');

  if (user.sign_in_locked_until && user.sign_in_locked_until.getTime() > now.getTime()) {
    throw new LockError(423, 'Sign-in is temporarily locked. Try again later.');
  }

  if (user.sign_in_locked_until && user.sign_in_locked_until.getTime() <= now.getTime()) {
    await User.updateOne(
      { _id: user._id },
      { $set: { failed_sign_in_attempts: 0, sign_in_locked_until: null } }
    );
  }

  if (!(await bcrypt.compare(password, user.password_hash))) {
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failed_sign_in_attempts: 1 } },
      { new: true }
    );

    await recordLockAudit(user._id, 'pin_reset_failed', req.ip);

    if (updated.failed_sign_in_attempts >= MAX_PASSWORD_ATTEMPTS) {
      const lockedUntil = new Date(now.getTime() + LOCKOUT_MS);

      await User.updateOne({ _id: user._id }, { $set: { sign_in_locked_until: lockedUntil } });

      try {
        await sendAccountLockoutEmail(user.email, lockedUntil);
      } catch (emailError) {
        console.error('[app-lock] Account lockout notification failed:', emailError.message);
      }

      throw new LockError(
        423,
        'Sign-in is temporarily locked after repeated failures. Try again in 15 minutes.'
      );
    }

    throw new LockError(401, 'Incorrect password.', { code: 'INCORRECT_PASSWORD' });
  }

  const hash = await hashPin(user._id, newPin);

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        app_lock_pin_hash: hash,
        app_lock_failed_attempts: 0,
        failed_sign_in_attempts: 0,
        sign_in_locked_until: null,
      },
    }
  );

  await unlockSession(req.authSession._id);
  await lockOtherSessions(user._id, req.authSession._id);
  await recordLockAudit(user._id, 'pin_reset', req.ip);

  return sendStatus(res, req, 200, 'Your PIN was reset.');
}));

// POST /api/app-lock/disable   { pin }
router.post('/disable', authenticate, handle(async (req, res) => {
  await verifyPinOrThrow(req.user._id, req.body?.pin, req.ip);

  await User.updateOne(
    { _id: req.user._id },
    {
      $set: { app_lock_enabled: false, app_lock_failed_attempts: 0 },
      $unset: { app_lock_pin_hash: 1, app_lock_credentials: 1 },
    }
  );

  await recordLockAudit(req.user._id, 'disabled', req.ip);

  return sendStatus(res, req, 200, 'The app lock is off.');
}));

// ---------------------------------------------------------------------------
// Device biometric (WebAuthn platform authenticator) - HI-2
// ---------------------------------------------------------------------------

function readCredential(body) {
  const credential = body?.credential;

  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
    throw new LockError(400, 'The biometric response is missing.');
  }

  return credential;
}

// POST /api/app-lock/biometric/register/options   { pin }
// Adding a way to unlock the app needs the PIN, so someone holding an unlocked
// phone cannot enrol their own fingerprint.
router.post('/biometric/register/options', authenticate, handle(async (req, res) => {
  await verifyPinOrThrow(req.user._id, req.body?.pin, req.ip);

  const user = await User.findById(req.user._id).select('+app_lock_credentials');
  const existing = user.app_lock_credentials || [];

  if (existing.length >= MAX_BIOMETRIC_DEVICES) {
    throw new LockError(409, `You can enrol up to ${MAX_BIOMETRIC_DEVICES} devices. Turn biometric off first.`);
  }

  const challenge = newChallenge();

  await storeChallenge(req.authSession._id, 'register', challenge, CHALLENGE_TTL_MS);

  return res.status(200).json({
    options: buildRegistrationOptions({ user, challenge, rp: relyingParty(), existing }),
  });
}));

// POST /api/app-lock/biometric/register/verify   { credential }
router.post('/biometric/register/verify', authenticate, handle(async (req, res) => {
  requireEnabled(req);

  const credential = readCredential(req.body);
  const challenge = await consumeChallenge(req.authSession._id, 'register');

  if (!challenge) {
    throw new LockError(400, 'The biometric setup expired. Start again.', { code: 'CHALLENGE_EXPIRED' });
  }

  let verified;

  try {
    verified = verifyRegistration({ credential, challenge, rp: relyingParty() });
  } catch (error) {
    if (!(error instanceof WebAuthnError)) throw error;

    console.error('[app-lock] Biometric enrolment rejected:', error.reason);

    throw new LockError(400, 'The biometric could not be verified. Try again.', { code: 'BIOMETRIC_FAILED' });
  }

  const user = await User.findOneAndUpdate(
    {
      _id: req.user._id,
      app_lock_enabled: true,
      'app_lock_credentials.credential_id': { $ne: verified.credentialId },
      [`app_lock_credentials.${MAX_BIOMETRIC_DEVICES - 1}`]: { $exists: false },
    },
    {
      $push: {
        app_lock_credentials: {
          credential_id: verified.credentialId,
          public_key: verified.publicKey,
          sign_count: verified.signCount,
          transports: verified.transports,
        },
      },
    },
    { new: true }
  );

  if (!user) {
    throw new LockError(409, 'This device is already enrolled, or the limit is reached.');
  }

  await recordLockAudit(req.user._id, 'biometric_enrolled', req.ip);

  return sendStatus(res, req, 201, 'Biometric unlock is on.');
}));

// POST /api/app-lock/biometric/options   - a challenge to sign, to unlock
router.post('/biometric/options', whileLocked, authenticate, handle(async (req, res) => {
  requireEnabled(req);

  const user = await User.findById(req.user._id).select('+app_lock_credentials');
  const credentials = user.app_lock_credentials || [];

  if (credentials.length === 0) {
    throw new LockError(409, 'No biometric is set up. Use your PIN.', { code: 'BIOMETRIC_NOT_ENROLLED' });
  }

  const challenge = newChallenge();

  await storeChallenge(req.authSession._id, 'authenticate', challenge, CHALLENGE_TTL_MS);

  return res.status(200).json({
    options: buildAuthenticationOptions({ challenge, rp: relyingParty(), credentials }),
  });
}));

// DELETE /api/app-lock/biometric   - forget every enrolled device
router.delete('/biometric', authenticate, handle(async (req, res) => {
  requireEnabled(req);

  await User.updateOne({ _id: req.user._id }, { $set: { app_lock_credentials: [] } });
  await recordLockAudit(req.user._id, 'biometric_removed', req.ip);

  return sendStatus(res, req, 200, 'Biometric unlock is off.');
}));

/**
 * Verify a WebAuthn assertion for the unlock. The challenge is the one this
 * session was issued and is spent by this attempt, pass or fail.
 */
async function verifyBiometric(req) {
  const credential = readCredential(req.body);
  const challenge = await consumeChallenge(req.authSession._id, 'authenticate');

  const failed = () => new LockError(401, 'Biometric verification failed. Use your PIN.', { code: 'BIOMETRIC_FAILED' });

  if (!challenge) throw failed();

  const user = await User.findById(req.user._id).select('+app_lock_credentials');
  const stored = (user.app_lock_credentials || []).find((item) => item.credential_id === credential.id);

  if (!stored) {
    await recordLockAudit(req.user._id, 'biometric_attempt_failed', req.ip);
    throw failed();
  }

  let result;

  try {
    result = verifyAssertion({
      credential,
      challenge,
      rp: relyingParty(),
      stored: { publicKey: stored.public_key, signCount: stored.sign_count },
    });
  } catch (error) {
    if (!(error instanceof WebAuthnError)) throw error;

    console.error('[app-lock] Biometric unlock rejected:', error.reason);
    await recordLockAudit(req.user._id, 'biometric_attempt_failed', req.ip);

    throw failed();
  }

  await User.updateOne(
    { _id: req.user._id, 'app_lock_credentials.credential_id': stored.credential_id },
    { $set: { 'app_lock_credentials.$.sign_count': result.signCount } }
  );

  await clearPinAttempts(req.user._id);
}

export default router;
