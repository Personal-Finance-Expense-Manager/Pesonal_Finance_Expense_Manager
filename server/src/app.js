import express from 'express';
import cors from 'cors';
import adminRoutes from './routes/admin.js';
import privacyRoutes from './routes/privacy.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import appLockRoutes from './routes/appLock.js';
import accountRoutes from './routes/accounts.js';
import budgetRoutes from './routes/budgets.js';
import transactionRoutes from './routes/transactions.js';
import categoryRoutes from './routes/categories.js';
import tagRoutes from './routes/tags.js';
import reportRoutes from './routes/reports.js';
import dataRoutes from './routes/data.js';
import recurringRuleRoutes from './routes/recurringRules.js';
import billReminderRoutes from './routes/billReminders.js';
import notificationRoutes from './routes/notifications.js';
import {
  attachmentFileRoutes,
  attachmentRoutes,
  transactionAttachmentRoutes,
} from './routes/attachments.js';
import goalRoutes from './routes/goals.js';
import { requireUser } from './middleware/currentUser.js';
import requestTiming from './middleware/requestTiming.js';
import { enforceHttps, securityHeaders, corsOptions, originGuard } from './middleware/securityHeaders.js';
import inputGuard from './middleware/inputGuard.js';
import maintenance from './middleware/maintenance.js';
import { buildAuthLimiter, buildGlobalLimiter } from './middleware/rateLimit.js';
import { trustProxySetting } from './config/security.js';

/**
 * Express application for the Personal Finance & Expense Manager API.
 *
 * Feature routers:
 *   /api/auth             US-03, US-04   (#15, #16)
 *   /api/app-lock         US-05          (#17)
 *   /api/accounts         US-06, US-07   (#20, #21)
 *   /api/transactions     US-08 .. US-10 (#24, #25, #26)
 *   /api/categories       US-12, US-13   (#30, #31)
 *   /api/tags             US-13          (#31)
 *   /api/budgets          US-14          (#35)
 *   /api/reports          US-20          (#34)
 *   /api/attachments      US-23          (#57)
 *   /api/data             US-24          (#58)
 *   /api/recurring-rules  US-16          (#43)
 *   /api/bill-reminders   US-17          (#44)
 *   /api/notifications    US-17          (#44)
 *   /api/goals            US-18          (#47)
 *   /api/admin            US-26          (#62)
 *   /api/privacy          US-28          (#67)
 */
const app = express();

// Only believe X-Forwarded-For when TRUST_PROXY names how many proxies sit in
// front (SEC-7). By default req.ip is the real TCP peer and cannot be forged.
app.set('trust proxy', trustProxySetting());
app.disable('x-powered-by');

// Time every request and log slow ones (US-27, PER-1, PER-5).
app.use(requestTiming);

// US-28 SEC-1 / SEC-6: HTTPS in production, secure headers, strict CORS.
app.use(enforceHttps);
app.use(securityHeaders);
app.use(cors(corsOptions()));

// US-26 REQ-97: nothing is served while a backup is being restored.
app.use(maintenance);

// US-28 SEC-7: 100 requests per minute per IP, before any work is done.
app.use('/api', buildGlobalLimiter());
app.use(originGuard);

// Parse JSON and URL-encoded request bodies.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// US-28 SEC-6 / SEC-9: refuse operator injection and prohibited credential fields.
app.use(inputGuard);

// US-28 SEC-7: 10 requests per minute per account on the sign-in family.
const authLimiter = buildAuthLimiter();
app.post(
  [
    '/api/auth/register',
    '/api/auth/verify-email',
    '/api/auth/resend-code',
    '/api/auth/login',
    '/api/auth/password-reset/request',
    '/api/auth/password-reset/confirm',
  ],
  authLimiter,
);

// US-28 SEC-4: every /api route is authenticated unless it is on this short
// list. A router added later without its own check is therefore closed by default.
//   /api/health        liveness probe
//   /api/auth/*        registration, sign-in, password reset (and sign-out, which checks its own token)
//   /api/app-lock/*    each route authenticates itself, because lock state belongs to the session
//   /api/attachments/:id/content   authenticated by its signed, expiring URL
const PUBLIC_API = /^\/(health|auth(\/|$)|app-lock(\/|$)|attachments\/[a-f\d]{24}\/content$)/i;
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS' || PUBLIC_API.test(req.path)) return next();
  return requireUser(req, res, next);
});

// API routes.
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);

// US-05: authenticates each route itself with a real session token,
// because the lock state belongs to the session.
app.use('/api/app-lock', appLockRoutes);

app.use('/api/accounts', requireUser, accountRoutes);
app.use('/api/budgets', requireUser, budgetRoutes);

// US-18: Savings goals and contributions.
app.use('/api/goals', requireUser, goalRoutes);

app.use(
  '/api/transactions/:id/attachments',
  requireUser,
  transactionAttachmentRoutes
);
app.use('/api/transactions', requireUser, transactionRoutes);
app.use('/api/categories', requireUser, categoryRoutes);
app.use('/api/tags', requireUser, tagRoutes);
app.use('/api/reports', requireUser, reportRoutes);
app.use('/api/data', requireUser, dataRoutes);
app.use('/api/recurring-rules', requireUser, recurringRuleRoutes);
app.use('/api/bill-reminders', requireUser, billReminderRoutes);
app.use('/api/notifications', requireUser, notificationRoutes);

// US-26: administrators only (requireAdmin is applied inside the router).
app.use('/api/admin', requireUser, adminRoutes);

// US-28 SEC-13: a person's own data rights.
app.use('/api/privacy', requireUser, privacyRoutes);

// The file itself is served through a short-lived signed URL,
// which an <img> or download link can use without the Authorization header.
app.use('/api/attachments', attachmentFileRoutes);
app.use('/api/attachments', requireUser, attachmentRoutes);

// Unknown route handler. The path is not echoed back.
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
  });
});

// Error handler. Never leak stack traces, queries or internals (SEC-6, SEC-11).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = Number(err.status || err.statusCode) || 500;

  if (status === 400 || status === 413) {
    // Malformed JSON or an oversized body: a client mistake, safe to describe generally.
    const message = status === 413 ? 'The request is too large.' : 'The request could not be read.';
    return res.status(status).json({ error: message, message });
  }

  // Only the message is logged - never the request body, headers or token.
  console.error('[api]', status >= 500 ? err.message : `${status} ${err.message}`);

  return res.status(status >= 400 && status < 500 ? status : 500).json({
    error: 'Internal server error',
  });
});

export default app;
