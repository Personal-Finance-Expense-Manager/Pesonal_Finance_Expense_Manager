import mongoose from 'mongoose';
import User from '../models/User.js';
import authenticate from './authenticate.js';
import { recordAudit } from '../services/auditService.js';

/**
 * Work out which user is making the request - US-25 (#61), SRS 5.10: REQ-93.
 *
 * Order of precedence:
 *
 *   1. req.user, if an earlier middleware already established it.
 *   2. A Bearer token. This is the real path: the request is handed to the
 *      US-04 authenticate middleware, which verifies the signature, checks the
 *      session has not been revoked or expired, and confirms the account is
 *      active and verified (REQ-93, SEC-4, SEC-5).
 *   3. ONLY in local development with DEV_AUTH_HEADER=true, an "X-User-Id"
 *      header. This is the interim left over from US-06, when the feature
 *      screens were built before sign-in existed.
 *
 * Step 3 can never apply in production (NODE_ENV=production) and is off unless
 * explicitly switched on, because trusting a client-supplied user id would let
 * anyone read anyone's data. The web client no longer uses it (US-28: every page
 * sends the session token); it remains only so the server's own integration
 * suites and local command-line scripts can act as a user without signing in.
 * Production start-up refuses to run with DEV_AUTH_HEADER=true (config/security.js).
 */
export async function requireUser(req, res, next) {
  if (req.user?.id) return next();

  // A Bearer token is always preferred over the development header.
  const authorization = req.headers.authorization;

  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }

  // SEC-4/SEC-12: development-only, and only when switched on explicitly. The
  // server also refuses to start in production with this flag set.
  const devHeaderAllowed =
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_AUTH_HEADER === 'true';

  const headerId = req.get('X-User-Id');

  if (!devHeaderAllowed || !headerId) {
    return res.status(401).json({ message: 'Please sign in to continue.' });
  }

  if (!mongoose.isValidObjectId(headerId)) {
    return res.status(401).json({ message: 'Please sign in to continue.' });
  }

  try {
    const user = await User.findById(headerId)
      .select('_id base_currency status')
      .lean();

    if (!user || user.status !== 'active') {
      return res.status(401).json({ message: 'Please sign in to continue.' });
    }

    req.user = {
      id: user._id.toString(),
      baseCurrency: user.base_currency || 'INR',
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Only an administrator may continue (REQ-93, REQ-94).
 *
 * Mounted after requireUser, so req.user is already established. The role is
 * read from the user record on the server; it is never taken from the request.
 */
export function requireAdmin(req, res, next) {
  const role = req.user?.role || 'user';

  if (role !== 'admin') {
    // REQ-96: permission failures are audited.
    void recordAudit({
      userId: req.user?._id ?? req.user?.id ?? null,
      actorRole: role,
      category: 'authz',
      outcome: 'denied',
      action: 'admin.access_denied',
      ip: req.ip,
      metadata: { path: (req.originalUrl || '').split('?')[0].slice(0, 120), method: req.method },
    });

    return res.status(403).json({
      message: 'This area is restricted to administrators.',
    });
  }

  return next();
}
