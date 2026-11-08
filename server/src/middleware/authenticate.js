import jwt from 'jsonwebtoken';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { SESSION_TTL_MS, sessionIdleMs } from '../config/security.js';
import { recordAudit } from '../services/auditService.js';

// Requests the client makes by itself on a timer. They prove the app is open,
// not that a person is using it, so they must not keep a session alive (SEC-8).
const BACKGROUND_PATHS = new Set(['/api/app-lock/heartbeat', '/api/app-lock/status']);
const TOUCH_INTERVAL_MS = 60 * 1000;

function reject(req, res, status, message, code, reason, userId = null) {
  // Authentication and authorization failures are audited (REQ-96, SEC-11).
  // Only the reason is stored, never the token or any part of it.
  void recordAudit({
    userId,
    category: 'authz',
    outcome: 'denied',
    action: 'auth.request_rejected',
    ip: req.ip,
    metadata: { reason, path: (req.originalUrl || '').split('?')[0].slice(0, 120), method: req.method },
  });

  return res.status(status).json({ message, ...(code ? { code } : {}) });
}

export default async function authenticate(req, res, next) {
  try {
    const authorization = req.headers.authorization;

    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      return reject(req, res, 401, 'Authentication required.', null, 'missing_credentials');
    }

    const token = authorization.slice('Bearer '.length).trim();

    if (!token) {
      return reject(req, res, 401, 'Authentication required.', null, 'missing_credentials');
    }

    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 32) {
      console.error('[auth] JWT_SECRET is missing or too short.');

      return res.status(500).json({
        message: 'Authentication service is not configured.',
      });
    }

    let payload;

    try {
      // SEC-4: signed HS256 only, expiry required and enforced, and no token
      // older than 24 hours is accepted even if it were minted with a later exp.
      payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
        clockTolerance: 0,
      });
    } catch (error) {
      return reject(
        req,
        res,
        401,
        'Invalid or expired session.',
        error?.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        error?.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid'
      );
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return reject(req, res, 401, 'Invalid or expired session.', 'TOKEN_INVALID', 'token_claims_invalid');
    }

    const session = await Session.findOne({
      jti: payload.jti,
      user_id: payload.sub,
      revoked_at: null,
      expires_at: { $gt: new Date() },
    });

    if (!session) {
      return reject(req, res, 401, 'Invalid or expired session.', 'SESSION_REVOKED', 'session_revoked', payload.sub);
    }

    // SEC-8: server-side inactivity timeout.
    const now = Date.now();
    const lastActivity = (session.last_activity_at || session.createdAt || new Date(now)).getTime();

    if (now - lastActivity > sessionIdleMs()) {
      await Session.updateOne({ _id: session._id, revoked_at: null }, { $set: { revoked_at: new Date() } });
      return reject(
        req,
        res,
        401,
        'You were signed out after a period of inactivity.',
        'SESSION_IDLE',
        'session_idle',
        payload.sub
      );
    }

    const user = await User.findById(payload.sub);

    if (user && user.status === 'suspended') {
      return reject(req, res, 401, 'This account has been suspended.', 'ACCOUNT_SUSPENDED', 'account_suspended', payload.sub);
    }

    if (!user || user.status !== 'active' || !user.email_verified) {
      return reject(req, res, 401, 'Invalid or expired session.', null, 'account_inactive', payload.sub);
    }

    // US-05 (REQ-11, SEC-8): with the app lock on, a session may use the API
    // only while it is unlocked. Routes a locked session must still reach
    // (unlocking, the lock status, sign-out) set req.allowWhileLocked first.
    if (
      user.app_lock_enabled === true &&
      !req.allowWhileLocked &&
      !(session.app_unlocked_until && session.app_unlocked_until.getTime() > Date.now())
    ) {
      return res.status(423).json({
        message: 'The app is locked. Unlock it to continue.',
        code: 'APP_LOCKED',
      });
    }

    // Record activity, at most once a minute so reads do not become writes.
    const path = (req.originalUrl || '').split('?')[0];
    if (!BACKGROUND_PATHS.has(path) && now - lastActivity > TOUCH_INTERVAL_MS) {
      Session.updateOne({ _id: session._id }, { $set: { last_activity_at: new Date(now) } }).catch(() => {});
    }

    req.user = user;
    req.authSession = session;

    return next();
  } catch (error) {
    console.error('[auth] Authentication middleware failed:', error.message);

    return res.status(500).json({
      message: 'Unable to authenticate this request.',
    });
  }
}
