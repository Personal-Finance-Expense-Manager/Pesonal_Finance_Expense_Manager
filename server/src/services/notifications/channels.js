import nodemailer from 'nodemailer';
import Notification from '../../models/Notification.js';
import PushSubscription from '../../models/PushSubscription.js';

/**
 * Notification channels - US-17 (#44), REQ-57.
 *
 * Each channel exposes send(message) and resolves to
 *   { status: 'sent' | 'skipped_not_configured' | 'logged_dev', detail? }
 * or throws on a delivery failure (which the dispatcher retries).
 *
 * A channel reports `sent` ONLY when a real provider accepted the message.
 * With no provider configured it says so; it never pretends.
 *
 * message = { user, title, body, reminder }
 */

// --- in-app ---------------------------------------------------------------

export const inAppChannel = {
  name: 'in_app',
  async send({ user, title, body }) {
    await Notification.create({
      user_id: user._id,
      type: 'bill_reminder',
      title,
      body,
    });
    return { status: 'sent' };
  },
};

// --- email ----------------------------------------------------------------

export function smtpConfigured(env = process.env) {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.EMAIL_FROM);
}

function devEmailFallback(env = process.env) {
  return env.NODE_ENV !== 'production' && env.DEV_EMAIL_CONSOLE === 'true';
}

// Replaceable in tests so no real mail is ever sent.
let transportFactory = (env) => nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: Number(env.SMTP_PORT || 587),
  secure: env.SMTP_SECURE === 'true',
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

export function setEmailTransportFactory(factory) {
  transportFactory = factory;
}

export const emailChannel = {
  name: 'email',
  async send({ user, title, body }, env = process.env) {
    if (smtpConfigured(env)) {
      await transportFactory(env).sendMail({
        from: env.EMAIL_FROM,
        to: user.email,
        subject: title,
        text: body,
      });
      return { status: 'sent' };
    }

    if (devEmailFallback(env)) {
      console.log(`[dev] Email NOT sent (no SMTP). To: ${user.email} | ${title} | ${body}`);
      return { status: 'logged_dev', detail: 'Printed to the console; no email was sent.' };
    }

    return { status: 'skipped_not_configured', detail: 'SMTP is not configured.' };
  },
};

// --- push -----------------------------------------------------------------

/**
 * A push provider is any object with:
 *   async send(subscription, { title, body, data }) -> void   (throws on failure)
 * Register one at start-up with setPushProvider(). None ships by default:
 * delivering a push needs a provider account (for example Web Push with VAPID
 * keys, or FCM), which cannot be hard-coded here. See README "Notifications".
 */
let pushProvider = null;

export function setPushProvider(provider) {
  pushProvider = provider;
}

export function pushConfigured() {
  return Boolean(pushProvider);
}

export const pushChannel = {
  name: 'push',
  async send({ user, title, body, reminder }) {
    if (!pushProvider) {
      return { status: 'skipped_not_configured', detail: 'No push provider is configured.' };
    }

    const subscriptions = await PushSubscription.find({ user_id: user._id }).lean();
    if (!subscriptions.length) {
      return { status: 'skipped_not_configured', detail: 'The user has no push subscription.' };
    }

    let delivered = 0;
    let lastError = null;
    for (const subscription of subscriptions) {
      try {
        await pushProvider.send(subscription, {
          title,
          body,
          data: { url: '#/bills', reminder_id: String(reminder._id) },
        });
        delivered += 1;
      } catch (error) {
        lastError = error;
      }
    }

    if (!delivered) throw lastError || new Error('Push delivery failed.');
    return { status: 'sent' };
  },
};

export const ALL_CHANNELS = [inAppChannel, emailChannel, pushChannel];
