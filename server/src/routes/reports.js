import { Router } from 'express';
import { dashboard } from '../services/dashboardService.js';
import { totalsForPeriod } from '../services/totalsService.js';
import { chartsForPeriod } from '../services/chartsService.js';
import { monthlyPeriod, parseDateOnly, today } from '../utils/period.js';

/**
 * Reports - US-20 (#34) and US-13 (#31), SRS 5.8 and 5.4.
 *
 *   GET /api/reports/dashboard   income, expense, net savings and net worth for
 *                                the current budget period (REQ-69), plus top
 *                                spending categories and active budgets
 *   GET /api/reports/totals      category-wise and tag-wise totals for any
 *                                selected period (REQ-42)
 *   GET /api/reports/charts      the category breakdown, the income-versus-
 *                                expense trend and the largest spends for a
 *                                selected period (REQ-70, REQ-71, REQ-72)
 *
 * The remaining period reports (REQ-73 to REQ-78) are US-22.
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

// ---------------------------------------------------------------------------
// GET /api/reports/totals?from=&to=&type=   (REQ-42)
// ---------------------------------------------------------------------------
router.get('/totals', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const type = (req.query.type || 'expense').toString().toLowerCase();

    if (!['expense', 'income'].includes(type)) {
      return res.status(400).json({ message: 'Type must be expense or income.' });
    }

    // Default to the current month so the page is useful with no parameters.
    const period = monthlyPeriod(today());

    let start = period.start;
    let end = period.end;

    if (from !== undefined) {
      start = parseDateOnly(from);
      if (!start) return res.status(400).json({ message: 'From must be a date such as 2026-10-01.' });
    }

    if (to !== undefined) {
      end = parseDateOnly(to);
      if (!end) return res.status(400).json({ message: 'To must be a date such as 2026-10-31.' });
    }

    if (start > end) {
      return res.status(400).json({ message: 'The start date must be on or before the end date.' });
    }

    res.json(await totalsForPeriod(req.user.id, { from: start, to: end, type }));
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/reports/charts?from=&to=&months=   (REQ-70, REQ-71, REQ-72)
// ---------------------------------------------------------------------------
router.get('/charts', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    // REQ-71 offers the last six or twelve months, and nothing else.
    const months = req.query.months === undefined ? 6 : Number(req.query.months);

    if (![6, 12].includes(months)) {
      return res.status(400).json({ message: 'Months must be 6 or 12.' });
    }

    const period = monthlyPeriod(today());

    let start = period.start;
    let end = period.end;

    if (from !== undefined) {
      start = parseDateOnly(from);
      if (!start) return res.status(400).json({ message: 'From must be a date such as 2026-10-01.' });
    }

    if (to !== undefined) {
      end = parseDateOnly(to);
      if (!end) return res.status(400).json({ message: 'To must be a date such as 2026-10-31.' });
    }

    if (start > end) {
      return res.status(400).json({ message: 'The start date must be on or before the end date.' });
    }

    res.json(await chartsForPeriod(req.user.id, { from: start, to: end, months }));
  } catch (error) {
    next(error);
  }
});

export default router;
