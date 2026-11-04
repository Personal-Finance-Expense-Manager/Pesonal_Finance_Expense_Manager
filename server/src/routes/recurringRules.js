import express from 'express';
import { sendApiError } from '../utils/apiError.js';
import { parsePagination } from '../utils/pagination.js';
import {
  createRule,
  deleteRule,
  getRule,
  listRules,
  pauseRule,
  resumeRule,
  updateRule,
} from '../services/recurringRuleService.js';

/**
 * Recurring rules - US-16 (#43), REQ-52 .. REQ-56. Mounted behind requireUser.
 *
 *   GET    /api/recurring-rules              list (?status=active|paused|completed|all)
 *   POST   /api/recurring-rules              create
 *   GET    /api/recurring-rules/:id          one rule and its recent generated transactions
 *   PATCH  /api/recurring-rules/:id          edit (future occurrences only)
 *   POST   /api/recurring-rules/:id/pause
 *   POST   /api/recurring-rules/:id/resume
 *   DELETE /api/recurring-rules/:id          generated transactions are kept
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
  res.json(await listRules(req.user.id, { status: req.query.status, page, limit }));
}));

router.post('/', handle(async (req, res) => {
  const data = await createRule(req.user.id, req.body, { ip: req.ip });
  res.status(201).json({ message: 'Recurring rule created successfully.', data });
}));

router.get('/:id', handle(async (req, res) => {
  res.json({ data: await getRule(req.user.id, req.params.id) });
}));

router.patch('/:id', handle(async (req, res) => {
  const data = await updateRule(req.user.id, req.params.id, req.body, { ip: req.ip });
  res.json({ message: 'Recurring rule updated successfully.', data });
}));

router.post('/:id/pause', handle(async (req, res) => {
  const data = await pauseRule(req.user.id, req.params.id, { ip: req.ip });
  res.json({ message: 'Recurring rule paused.', data });
}));

router.post('/:id/resume', handle(async (req, res) => {
  const data = await resumeRule(req.user.id, req.params.id, { ip: req.ip });
  res.json({ message: 'Recurring rule resumed.', data });
}));

router.delete('/:id', handle(async (req, res) => {
  const data = await deleteRule(req.user.id, req.params.id, { ip: req.ip });
  res.json({ message: 'Recurring rule deleted. Transactions it generated were kept.', data });
}));

export default router;
