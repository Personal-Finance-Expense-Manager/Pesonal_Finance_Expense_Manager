import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import budgetRoutes from './routes/budgets.js';
import transactionRoutes from './routes/transactions.js';
import categoryRoutes from './routes/categories.js';
import tagRoutes from './routes/tags.js';
import reportRoutes from './routes/reports.js';
import dataRoutes from './routes/data.js';
import {
  attachmentFileRoutes,
  attachmentRoutes,
  transactionAttachmentRoutes,
} from './routes/attachments.js';
import { requireUser } from './middleware/currentUser.js';

/**
 * Express application for the Personal Finance & Expense Manager API.
 *
 * Feature routers:
 *   /api/auth         US-03, US-04   (#15, #16)
 *   /api/accounts     US-06, US-07   (#20, #21)
 *   /api/transactions US-08 .. US-10 (#24, #25, #26)
 *   /api/categories   US-12, US-13   (#30, #31)
 *   /api/tags         US-13          (#31)
 *   /api/budgets      US-14          (#35)
 *   /api/reports      US-20          (#34)
 *   /api/attachments  US-23          (#57)
 *   /api/data         US-24          (#58)
 */
const app = express();

// Allow requests from the React client.
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  // Lets the client read the file name of an export download (US-24).
  exposedHeaders: ['Content-Disposition'],
}));

// Parse JSON and URL-encoded request bodies.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/accounts', requireUser, accountRoutes);
app.use('/api/budgets', requireUser, budgetRoutes);
app.use('/api/transactions/:id/attachments', requireUser, transactionAttachmentRoutes);
app.use('/api/transactions', requireUser, transactionRoutes);
app.use('/api/categories', requireUser, categoryRoutes);
app.use('/api/tags', requireUser, tagRoutes);
app.use('/api/reports', requireUser, reportRoutes);
app.use('/api/data', requireUser, dataRoutes);
// The file itself is served through a short-lived signed URL, which an <img>
// or download link can use without the Authorization header (REQ-81).
app.use('/api/attachments', attachmentFileRoutes);
app.use('/api/attachments', requireUser, attachmentRoutes);

// Unknown route
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.originalUrl,
  });
});

// Error handler. Never leak stack traces to the client (SEC-6).
app.use((err, req, res, next) => {
  console.error('[api]', err.message);

  res.status(err.status || 500).json({
    error: 'Internal server error',
  });
});

export default app;