import Decimal from 'decimal.js';
import Reminder from '../models/Reminder.js';
import User from '../models/User.js';
import { formatDateOnly, today as appToday } from '../utils/period.js';
import { dueCutoff } from '../utils/recurrence.js';
import { dispatchReminder, dueRetries } from './notifications/notificationService.js';
import { ALL_CHANNELS } from './notifications/channels.js';
import NotificationDelivery from '../models/NotificationDelivery.js';
import { notifyDate } from './billReminderService.js';

/**
 * Scheduled work for bill reminders - US-17 (#44), REQ-57, REQ-59.
 *
 *  markOverdue()               unpaid bills past their due date -> OVERDUE
 *  dispatchDueNotifications()  send reminders whose notification date is reached
 *  runBillScheduler()          both, plus retries; safe to run any number of times
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** REQ-59. Only `pending` is touched, so a paid bill can never become overdue. */
export async function markOverdue({ today = appToday() } = {}) {
  const result = await Reminder.updateMany(
    { status: 'pending', due_date: { $lt: today } },
    { $set: { status: 'overdue' } },
  );
  return result.modifiedCount;
}

function messageFor(reminder, user, onDay) {
  const days = Math.round((reminder.due_date.getTime() - onDay.getTime()) / DAY_MS);
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  const amount = reminder.amount
    ? ` of ${new Decimal(reminder.amount.toString()).toFixed(2)} ${user.base_currency || 'INR'}`
    : '';
  return {
    title: `Bill due ${when}: ${reminder.name}`,
    body: `${reminder.name}${amount} is due on ${formatDateOnly(reminder.due_date)} (${when}).`,
  };
}

/**
 * Reminders whose notification date (due date - lead time) has been reached
 * and that are still unpaid and not yet past due. Eligible from 00:05 IST.
 */
export async function dispatchDueNotifications({ now = new Date(), channels = ALL_CHANNELS } = {}) {
  const cutoff = dueCutoff(now);
  const onDay = appToday(undefined, now);
  const summary = { reminders: 0, delivered: 0, failed: 0, not_configured: 0, retried: 0 };

  const reminders = await Reminder.find({
    status: 'pending',
    due_date: { $gte: onDay },
    $expr: {
      $lte: [
        { $subtract: ['$due_date', { $multiply: ['$notify_days_before', DAY_MS] }] },
        cutoff,
      ],
    },
  }).limit(1000).lean();

  const tally = (results) => {
    for (const status of Object.values(results)) {
      if (status === 'sent' || status === 'logged_dev') summary.delivered += 1;
      else if (status === 'failed') summary.failed += 1;
      else if (status === 'skipped_not_configured') summary.not_configured += 1;
    }
  };

  const users = new Map();
  const userFor = async (id) => {
    const key = String(id);
    if (!users.has(key)) {
      users.set(key, await User.findById(id).select('email name base_currency status').lean());
    }
    return users.get(key);
  };

  for (const reminder of reminders) {
    const user = await userFor(reminder.user_id);
    if (!user || user.status !== 'active') continue;

    summary.reminders += 1;
    const { title, body } = messageFor(reminder, user, onDay);
    tally(await dispatchReminder({
      reminder, user, notifyForDate: notifyDate(reminder), title, body, channels, now,
    }));
  }

  // Retry failed deliveries whose backoff has elapsed (SRS CI-9).
  for (const failed of await dueRetries({ now })) {
    const reminder = await Reminder.findOne({ _id: failed.reminder_id, status: 'pending' }).lean();
    const user = reminder && await userFor(reminder.user_id);
    if (!reminder || !user) {
      await NotificationDelivery.updateOne({ _id: failed._id }, { $set: { next_attempt_at: null } });
      continue;
    }
    const channel = channels.find((c) => c.name === failed.channel);
    if (!channel) continue;

    const { title, body } = messageFor(reminder, user, onDay);
    tally(await dispatchReminder({
      reminder, user, notifyForDate: failed.notify_for_date, title, body, channels: [channel], now,
    }));
    summary.retried += 1;
  }

  return summary;
}

export async function runBillScheduler({ now = new Date(), channels } = {}) {
  const overdue = await markOverdue({ today: appToday(undefined, now) });
  const notifications = await dispatchDueNotifications({ now, channels });
  return { overdue, ...notifications };
}
