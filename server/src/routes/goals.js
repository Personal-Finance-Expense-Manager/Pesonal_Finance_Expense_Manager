import { sendApiError } from '../utils/apiError.js';
import { Router } from 'express';
import Goal from '../models/Goal.js';
import {
  validateNewGoal,
} from '../validators/goal.js';
import {
  createGoal,
  listGoals,
  getGoal,
  updateGoal,
  contributeToGoal,
  withdrawFromGoal,
  deleteGoal,
} from '../services/goalService.js';

const router = Router();

// GET /api/goals
router.get('/', async (req, res, next) => {
  try {
    const goals = await listGoals(req.user.id);
    return res.json({ goals });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// POST /api/goals
router.post('/', async (req, res, next) => {
  try {
    const { data, errors } = validateNewGoal(req.body);

    if (errors) {
      return res.status(400).json({
        message: 'Please correct the highlighted fields.',
        errors,
      });
    }

    const goal = await createGoal(req.user.id, data);

    return res.status(201).json({
      message: 'Savings goal created.',
      goal,
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// GET /api/goals/:id
router.get('/:id', async (req, res, next) => {
  try {
    const goal = await getGoal(req.user.id, req.params.id);
    return res.json({ goal });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// PATCH /api/goals/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const current = await Goal.findOne({
      _id: req.params.id,
      user_id: req.user.id,
    });

    if (!current) {
      return res.status(404).json({
        message: 'Savings goal not found.',
      });
    }

    const merged = {
      name: req.body.name ?? current.name,
      target_amount: req.body.target_amount
        ?? current.target_amount.toString(),
      target_date: req.body.target_date
        ?? current.target_date?.toISOString().slice(0, 10),
      linked_account_id: req.body.linked_account_id !== undefined
        ? req.body.linked_account_id
        : current.linked_account_id?.toString() ?? null,
    };

    const { data, errors } = validateNewGoal(merged);

    if (errors) {
      return res.status(400).json({
        message: 'Please correct the highlighted fields.',
        errors,
      });
    }

    const goal = await updateGoal(req.user.id, req.params.id, data);

    return res.json({
      message: 'Savings goal updated.',
      goal,
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// POST /api/goals/:id/contributions
router.post('/:id/contributions', async (req, res, next) => {
  try {
    const goal = await contributeToGoal(
      req.user.id,
      req.params.id,
      req.body,
    );

    return res.status(201).json({
      message: 'Savings contribution recorded.',
      goal,
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// POST /api/goals/:id/withdrawals
router.post('/:id/withdrawals', async (req, res, next) => {
  try {
    const goal = await withdrawFromGoal(
      req.user.id,
      req.params.id,
      req.body,
    );

    return res.status(201).json({
      message: 'Savings withdrawal recorded successfully.',
      goal,
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// DELETE /api/goals/:id?confirm=true
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.query.confirm !== 'true') {
      return res.status(400).json({
        message: 'Please confirm deletion of this savings goal.',
        requiresConfirmation: true,
      });
    }

    const result = await deleteGoal(req.user.id, req.params.id);

    return res.json({
      message: 'Savings goal moved to recovery for 30 days.',
      ...result,
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

export default router;
