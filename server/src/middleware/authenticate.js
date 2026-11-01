import jwt from 'jsonwebtoken';
import Session from '../models/Session.js';
import User from '../models/User.js';

export default async function authenticate(req, res, next) {
  try {
    const authorization = req.headers.authorization;

    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      return res.status(401).json({
        message: 'Authentication required.',
      });
    }

    const token = authorization.slice('Bearer '.length).trim();

    if (!token) {
      return res.status(401).json({
        message: 'Authentication required.',
      });
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
      payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
      });
    } catch {
      return res.status(401).json({
        message: 'Invalid or expired session.',
      });
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string'
    ) {
      return res.status(401).json({
        message: 'Invalid or expired session.',
      });
    }

    const session = await Session.findOne({
      jti: payload.jti,
      user_id: payload.sub,
      revoked_at: null,
      expires_at: { $gt: new Date() },
    });

    if (!session) {
      return res.status(401).json({
        message: 'Invalid or expired session.',
      });
    }

    const user = await User.findById(payload.sub);

    if (!user || user.status !== 'active' || !user.email_verified) {
      return res.status(401).json({
        message: 'Invalid or expired session.',
      });
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