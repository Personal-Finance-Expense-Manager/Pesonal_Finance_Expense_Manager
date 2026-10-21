import { Router } from 'express';
import mongoose from 'mongoose';
import Budget from '../models/Budget.js';
import Category from '../models/Category.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { validateNewBudget } from '../validators/budget.js';
import { findOverlappingBudget, spentForBudget, summarise, present } from '../services/budgetService.js';
import { evaluateBudget } from '../services/budgetEvaluator.js';
import { today } from '../utils/period.js';

/**
 * Budgets - US-14 (#35), SRS 5.5: REQ-43, REQ-44, REQ-45, REQ-46, REQ-50, REQ-51.
 *
 *   GET  /api/budgets             active budgets with utilisation (?include=all for past ones)
 *   POST /api/budgets             create a budget                        REQ-43, REQ-44
 *   GET  /api/budgets/categories  expense categories a budget can use
 *   GET  /api/budgets/alerts      recent budget alerts                   REQ-46
 *   GET  /api/budgets/:id         one budget with utilisation             REQ-45
 *
 * Editing, deleting, rollover and repeat are US-15 (#36, Sprint 2).
 * Every query is scoped to req.user.id.
 */
const router = Router();

const OVERLAP_MESSAGE = 'A budget already exists for this category in this period.'; // REQ-44, verbatim

/** Categories this user may budget against: their own plus the shared defaults. */
function visibleCategoryFilter(userId) {
  return { type: 'expense', $or: [{ user_id: userId }, { user_id: null }] };
}

async function monthStartDay(userId) {
  const user = await User.findById(userId).select('month_start_day').lean();
  return user?.month_start_day || 1;
}

/** Utilisation for a list of budgets, raising any alerts that are now due. */
async function withUtilisation(budgets, onDay) {
  const ids = budgets.filter((b) => b.category_id).map((b) => b.category_id);
  const categories = await Category.find({ _id: { $in: ids } }).select('name').lean();
  const names = new Map(categories.map((c) => [c._id.toString(), c]));

  const results = [];
  const newAlerts = [];

  for (const budget of budgets) {
    const category = budget.category_id ? names.get(budget.category_id.toString()) : null;
    const spent = await spentForBudget(budget);
    const utilisation = summarise(
      budget.amount,
      spent,
      { start: budget.period_start, end: budget.period_end },
      onDay,
    );

    if (budget.period_end.getTime() >= onDay.getTime()) {
      const created = await evaluateBudget(budget, utilisation, category?.name);
      newAlerts.push(...created.map((n) => ({ type: n.type, title: n.title, body: n.body })));
    }

    results.push(present(budget, category, utilisation, onDay));
  }

  return { results, newAlerts };
}

// GET /api/budgets
router.get('/', async (req, res, next) => {
  try {
    const onDay = today();
    const filter = { user_id: req.user.id };
    if (req.query.include !== 'all') filter.period_end = { $gte: onDay };

    const budgets = await Budget.find(filter).sort({ period_start: -1, createdAt: 1 }).lean();
    const { results, newAlerts } = await withUtilisation(budgets, onDay);

    res.json({ budgets: results, newAlerts });
  } catch (error) {
    next(error);
  }
});

// GET /api/budgets/categories
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await Category.find(visibleCategoryFilter(req.user.id))
      .sort({ name: 1 })
      .select('name parent_category_id')
      .lean();
    res.json({
      categories: categories.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        parent_id: c.parent_category_id ? c.parent_category_id.toString() : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/budgets/alerts
router.get('/alerts', async (req, res, next) => {
  try {
    const alerts = await Notification.find({
      user_id: req.user.id,
      type: { $in: ['budget_warning', 'budget_over'] },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json({
      alerts: alerts.map((a) => ({
        id: a._id.toString(),
        type: a.type,
        title: a.title,
        body: a.body,
        created_at: a.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/budgets
router.post('/', async (req, res, next) => {
  try {
    const onDay = today();
    const { data, errors } = validateNewBudget(req.body, {
      today: onDay,
      monthStartDay: await monthStartDay(req.user.id),
    });

    if (errors) {
      return res.status(400).json({ message: 'Please correct the highlighted fields.', errors });
    }

    if (data.category_id) {
      const category = await Category.findOne({
        _id: data.category_id,
        ...visibleCategoryFilter(req.user.id),
      }).lean();
      if (!category) {
        return res.status(400).json({
          message: 'Please correct the highlighted fields.',
          errors: { category_id: 'That category does not exist or is not an expense category.' },
        });
      }
    }

    const period = { start: data.period_start, end: data.period_end };
    if (await findOverlappingBudget(req.user.id, data.category_id, period)) {
      return res.status(409).json({ message: OVERLAP_MESSAGE, errors: { period_start: OVERLAP_MESSAGE } });
    }

    const budget = await Budget.create({ ...data, user_id: req.user.id });
    const { results, newAlerts } = await withUtilisation([budget.toObject()], onDay);

    return res.status(201).json({ message: 'Budget created.', budget: results[0], newAlerts });
  } catch (error) {
    return next(error);
  }
});

// GET /api/budgets/:id
router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Budget not found.' });
    }
    const budget = await Budget.findOne({ _id: req.params.id, user_id: req.user.id }).lean();
    if (!budget) return res.status(404).json({ message: 'Budget not found.' });

    const { results, newAlerts } = await withUtilisation([budget], today());
    return res.json({ budget: results[0], newAlerts });
  } catch (error) {
    return next(error);
  }
});

export default router;
