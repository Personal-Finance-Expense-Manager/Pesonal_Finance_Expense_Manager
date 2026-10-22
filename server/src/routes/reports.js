import { Router } from 'express';
import { dashboard } from '../services/dashboardService.js';

/**
 * Reports - US-20 (#34), SRS 5.8.
 *
 *   GET /api/reports/dashboard   income, expense, net savings and net worth for
 *                                the current budget period (REQ-69), plus top
 *                                spending categories and active budgets
 *
 * Charts and period reports (REQ-70 to REQ-78) are US-21 and US-22 (Sprint 2).
 */
const router = Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const baseCurrency = req.user.baseCurrency || req.user.base_currency;
    res.json(await dashboard(req.user.id, baseCurrency));
  } catch (error) {
    next(error);
  }
});

export default router;
