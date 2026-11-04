import express from 'express';
import { sendApiError } from '../utils/apiError.js';
import { parsePagination } from '../utils/pagination.js';
import {
  createReminder,
  deleteReminder,
  getReminder,
  listReminders,
  markPaid,
  updateReminder,
} from '../services/billReminderService.js';

/**
 * Bill reminders - US-17 (#44), REQ-57 .. REQ-59. Mounted behind requireUser.
 *
 *   GET    /api/bill-reminders            list (?status=pending|overdue|paid|all)
 *   POST   /api/bill-reminders            create
 *   GET    /api/bill-reminders/:id
 *   PATCH  /api/bill-reminders/:id        edit (not once paid)
 *   DELETE /api/bill-reminders/:id
 *   POST   /api/bill-reminders/:id/pay    one-tap pay: creates the linked expense
 */
const router = express.Router();

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendApiError(res, next, error);
  }
};

router.get('/', handle(async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  res.json(await listReminders(req.user.id, { status: req.query.status, page, limit }));
}));

router.post('/', handle(async (req, res) => {
  const data = await createReminder(req.user.id, req.body, { ip: req.ip });
  res.status(201).json({ message: 'Bill reminder created successfully.', data });
}));

router.get('/:id', handle(async (req, res) => {
  res.json({ data: await getReminder(req.user.id, req.params.id) });
}));

router.patch('/:id', handle(async (req, res) => {
  const data = await updateReminder(req.user.id, req.params.id, req.body, { ip: req.ip });
  res.json({ message: 'Bill reminder updated successfully.', data });
}));

router.delete('/:id', handle(async (req, res) => {
  const data = await deleteReminder(req.user.id, req.params.id, { ip: req.ip });
  res.json({ message: 'Bill reminder deleted.', data });
}));

router.post('/:id/pay', handle(async (req, res) => {
  const data = await markPaid(req.user.id, req.params.id, req.body, { ip: req.ip });
  res.json({ message: 'Bill marked as paid and the expense was recorded.', data });
}));

export default router;
