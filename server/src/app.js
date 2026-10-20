import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/health.js';

/**
 * Express application for the Personal Finance & Expense Manager API.
 *
 * Feature routers are mounted under /api as they are built:
 *   /api/auth         US-03, US-04   (#15, #16)
 *   /api/accounts     US-06, US-07   (#20, #21)
 *   /api/transactions US-08 .. US-10 (#24, #25, #26)
 *   /api/categories   US-12, US-13   (#30, #31)
 *   /api/budgets      US-14          (#35)
 *   /api/reports      US-20          (#34)
 */
const app = express();

// The React client runs on its own port in development, so cross-origin
// requests have to be allowed. US-28 (#68, OWASP hardening) restricts this
// to a configured origin list before release.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', healthRoutes);

// Unknown route
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// Error handler. Never leak a stack trace to the client (SEC-6).
app.use((err, req, res, next) => {
  console.error('[api]', err.message);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

export default app;
