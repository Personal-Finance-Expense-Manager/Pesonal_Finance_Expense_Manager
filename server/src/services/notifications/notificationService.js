import NotificationDelivery from '../../models/NotificationDelivery.js';
import { ALL_CHANNELS } from './channels.js';

/**
 * Bill reminder dispatch with an honest delivery log - US-17, REQ-57, CI-9.
 *
 * One NotificationDelivery row exists per (reminder, channel, notification
 * date) - the unique index makes a repeat run, or a second server, a no-op.
 * A failed send is retried up to MAX_ATTEMPTS times with exponential backoff
 * (SRS CI-9). Statuses never overstate: see models/NotificationDelivery.js.
 */

export const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

export const backoffMs = (attempts) => BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);

/**
 * Send one delivery if it is due, exactly once per attempt.
 * Returns the final delivery status, or null if someone else holds it.
 */
async function attempt(delivery, channel, message, now) {
  // Claim the attempt. A lease on next_attempt_at keeps a concurrent run away.
  const claimed = await NotificationDelivery.findOneAndUpdate(
    {
      _id: delivery._id,
      status: { $in: ['pending', 'failed'] },
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }],
    },
    { $inc: { attempts: 1 }, $set: { next_attempt_at: new Date(now.getTime() + LEASE_MS) } },
    { new: true },
  );
  if (!claimed) return null;

  try {
    const result = await channel.send(message);
    const terminal = result.status;
    await NotificationDelivery.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: terminal,
          next_attempt_at: null,
          last_error: result.detail ?? null,
          sent_at: terminal === 'sent' ? now : null,
        },
      },
    );
    return terminal;
  } catch (error) {
    const exhausted = claimed.attempts >= MAX_ATTEMPTS;
    await NotificationDelivery.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: 'failed',
          last_error: String(error.message || error).slice(0, 300),
          next_attempt_at: exhausted ? null : new Date(now.getTime() + backoffMs(claimed.attempts)),
        },
      },
    );
    return 'failed';
  }
}

/**
 * Notify a user about a reminder on every channel, once per notification date.
 * `message` is { user, title, body, reminder }.
 */
export async function dispatchReminder({
  reminder,
  user,
  notifyForDate,
  title,
  body,
  channels = ALL_CHANNELS,
  now = new Date(),
}) {
  const results = {};

  for (const channel of channels) {
    let delivery;
    try {
      delivery = await NotificationDelivery.findOneAndUpdate(
        { reminder_id: reminder._id, channel: channel.name, notify_for_date: notifyForDate },
        { $setOnInsert: { user_id: reminder.user_id, status: 'pending', attempts: 0 } },
        { upsert: true, new: true },
      );
    } catch (error) {
      if (error.code === 11000) {
        delivery = await NotificationDelivery.findOne({
          reminder_id: reminder._id, channel: channel.name, notify_for_date: notifyForDate,
        });
      } else throw error;
    }

    results[channel.name] = await attempt(delivery, channel, { user, title, body, reminder }, now);
  }

  return results;
}

/** Deliveries that failed and whose backoff has elapsed. */
export async function dueRetries({ now = new Date(), limit = 100 } = {}) {
  return NotificationDelivery.find({
    status: 'failed',
    attempts: { $lt: MAX_ATTEMPTS },
    next_attempt_at: { $lte: now },
  }).limit(limit).lean();
}
