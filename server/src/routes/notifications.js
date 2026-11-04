import express from 'express';
import mongoose from 'mongoose';
import Notification from '../models/Notification.js';
import PushSubscription from '../models/PushSubscription.js';
import { ApiError, sendApiError } from '../utils/apiError.js';
import { parsePagination } from '../utils/pagination.js';
import { pushConfigured } from '../services/notifications/channels.js';

/**
 * In-app notifications and push subscriptions - US-17 (#44). Behind requireUser.
 *
 *   GET  /api/notifications                  list (?unread=true)
 *   POST /api/notifications/:id/read
 *   GET  /api/notifications/push-status      whether a push provider is configured
 *   POST /api/notifications/push-subscriptions    store this device's subscription
 */
const router = express.Router();

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendApiError(res, next, error);
  }
};

router.get('/push-status', handle(async (req, res) => {
  res.json({ push_configured: pushConfigured() });
}));

router.post('/push-subscriptions', handle(async (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) {
    throw new ApiError(400, 'Invalid push subscription.', { endpoint: 'Enter a valid https endpoint.' });
  }
  await PushSubscription.updateOne(
    { user_id: req.user.id, endpoint },
    { $set: { keys: { p256dh: keys?.p256dh ?? null, auth: keys?.auth ?? null } } },
    { upsert: true },
  );
  res.status(201).json({ message: 'Push subscription saved.' });
}));

router.get('/', handle(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filter = { user_id: new mongoose.Types.ObjectId(String(req.user.id)) };
  if (req.query.unread === 'true') filter.is_read = false;

  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);

  res.json({
    data: items.map((n) => ({
      id: String(n._id), type: n.type, title: n.title, body: n.body,
      is_read: n.is_read, created_at: n.createdAt,
    })),
    pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) },
  });
}));

router.post('/:id/read', handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Notification not found.');
  const result = await Notification.updateOne(
    { _id: req.params.id, user_id: req.user.id },
    { $set: { is_read: true } },
  );
  if (result.matchedCount !== 1) throw new ApiError(404, 'Notification not found.');
  res.json({ message: 'Notification marked as read.' });
}));

export default router;
