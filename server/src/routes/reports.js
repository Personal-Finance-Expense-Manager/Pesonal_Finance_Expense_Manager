import { Router } from 'express';
import { dashboard } from '../services/dashboardService.js';
import { totalsForPeriod } from '../services/totalsService.js';
import { chartsForPeriod } from '../services/chartsService.js';
import { reportForPeriod, reportToCsvRows } from '../services/reportService.js';
import { reportToPdf } from '../services/reportPdfService.js';
import { toCsv } from '../utils/csv.js';
import { auditFromRequest } from '../services/auditService.js';
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
 *   GET /api/reports/period      a report for any date range, optionally
 *                                compared with a second range, with the pace
 *                                of spending (REQ-73, REQ-75, REQ-76)
 *   GET /api/reports/period.csv  the same report as CSV (REQ-77)
 *   GET /api/reports/period.pdf  the same report as PDF (REQ-77)
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

// ---------------------------------------------------------------------------
// Period reports - US-22 (#51): REQ-73 to REQ-78
// ---------------------------------------------------------------------------

/**
 * Read the range and the optional comparison range off the query.
 *
 * Returns either { error } with a message for the client, or the parsed
 * values. Shared by the JSON, CSV and PDF routes so all three answer for
 * exactly the same period - REQ-77 requires the exported figures to match
 * what was displayed, and that starts with parsing the request identically.
 */
function readPeriod(query) {
  const period = monthlyPeriod(today());

  let from = period.start;
  let to = period.end;

  if (query.from !== undefined) {
    from = parseDateOnly(query.from);
    if (!from) return { error: 'From must be a date such as 2026-10-01.' };
  }

  if (query.to !== undefined) {
    to = parseDateOnly(query.to);
    if (!to) return { error: 'To must be a date such as 2026-10-31.' };
  }

  if (from > to) {
    return { error: 'The start date must be on or before the end date.' };
  }

  // REQ-78 sets the performance target at twelve months. A longer range is
  // refused rather than served slowly, so the limit is visible to the caller
  // instead of appearing as a timeout.
  const THIRTEEN_MONTHS_MS = 400 * 24 * 60 * 60 * 1000;

  if (to.getTime() - from.getTime() > THIRTEEN_MONTHS_MS) {
    return { error: 'A report can cover at most twelve months. Choose a shorter range.' };
  }

  let compare = null;

  if (query.compare_from !== undefined || query.compare_to !== undefined) {
    const compareFrom = parseDateOnly(query.compare_from);
    const compareTo = parseDateOnly(query.compare_to);

    if (!compareFrom || !compareTo) {
      return { error: 'A comparison needs both compare_from and compare_to as dates.' };
    }

    if (compareFrom > compareTo) {
      return { error: 'The comparison start date must be on or before its end date.' };
    }

    compare = { from: compareFrom, to: compareTo };
  }

  return { from, to, compare };
}

router.get('/period', async (req, res, next) => {
  try {
    const parsed = readPeriod(req.query);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    res.json(await reportForPeriod(req.user.id, parsed));
  } catch (error) {
    next(error);
  }
});

// ---- REQ-77: the same report as a file --------------------------------

function sendDownload(res, { body, type, fileName }) {
  res.set({
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(body);
}

function fileStamp(from, to) {
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  return `${iso(from)}_to_${iso(to)}`;
}

router.get('/period.csv', async (req, res, next) => {
  try {
    const parsed = readPeriod(req.query);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const report = await reportForPeriod(req.user.id, parsed);

    // REQ-96: exports are audited (the range, never the figures).
    await auditFromRequest(req, { category: 'export', action: 'export.report_csv', entityType: 'export' });

    sendDownload(res, {
      body: toCsv(reportToCsvRows(report)),
      type: 'text/csv; charset=utf-8',
      fileName: `report_${fileStamp(report.from, report.to)}.csv`,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/period.pdf', async (req, res, next) => {
  try {
    const parsed = readPeriod(req.query);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const report = await reportForPeriod(req.user.id, parsed);
    const pdf = await reportToPdf(report, { userName: req.user.name || '' });

    await auditFromRequest(req, { category: 'export', action: 'export.report_pdf', entityType: 'export' });

    sendDownload(res, {
      body: pdf,
      type: 'application/pdf',
      fileName: `report_${fileStamp(report.from, report.to)}.pdf`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
