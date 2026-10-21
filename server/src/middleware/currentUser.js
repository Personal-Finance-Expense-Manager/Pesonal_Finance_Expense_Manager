import mongoose from 'mongoose';
import User from '../models/User.js';

/**
 * Work out which user is making the request.
 *
 * TEMPORARY - sign-in (US-04, #16) is not merged yet. Until it is, feature
 * routes need some way to know the user, so this middleware:
 *
 *   1. uses req.user if a real authentication middleware already set it, and
 *   2. otherwise, ONLY in local development with DEV_AUTH_HEADER=true in
 *      server/.env, accepts the user id from an "X-User-Id" request header.
 *
 * The header route is never active in production (NODE_ENV=production) and is
 * off unless explicitly switched on, because trusting a client-supplied user
 * id would let anyone read anyone's data. When US-04 lands, mount its
 * middleware in front of the feature routers and delete step 2.
 *
 * Recorded as a deviation in the US-06 pull request.
 */
export async function requireUser(req, res, next) {
  if (req.user?.id) return next();

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
