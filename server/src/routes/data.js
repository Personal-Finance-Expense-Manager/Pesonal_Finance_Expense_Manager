import express from 'express';
import mongoose from 'mongoose';
import { CSV_COLUMNS, exportAllJson, exportTransactionsCsv } from '../services/exportService.js';
import { commitImport, previewImport } from '../services/importService.js';
import { recordAudit } from '../services/auditService.js';
import { sendApiError } from '../utils/apiError.js';
import { formatDateOnly, parseDateOnly, today } from '../utils/period.js';
import { toCsv } from '../utils/csv.js';

/**
 * Import and export - US-24 (#58), SRS REQ-82 to REQ-87. Mounted behind requireUser.
 *
 *   GET  /api/data/transactions.csv?startDate=&endDate=   REQ-82
 *   GET  /api/data/import/template                       sample file in the export layout
 *   POST /api/data/import/preview   { csv, mapping? }    REQ-83, REQ-84, REQ-85 (writes nothing)
 *   POST /api/data/import/commit    { csv, mapping, import_duplicates? }   REQ-84 .. REQ-86
 *   GET  /api/data/export.json                           REQ-87
 *
 * The CSV is sent as text inside the JSON body, so the 1 MB JSON limit in
 * app.js caps a file at roughly 1 MB (several thousand rows).
 */

const router = express.Router();

function sendDownload(res, { body, type, fileName }) {
  res.set({
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.send(body);
}

function auditExport(req, action, detail) {
  return recordAudit({
    userId: req.user.id,
    entityType: 'export',
    entityId: new mongoose.Types.ObjectId(String(req.user.id)),
    action,
    newValue: detail,
    ip: req.ip,
  });
}

// REQ-82: transactions in a date range as CSV.
router.get('/transactions.csv', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const from = startDate ? parseDateOnly(String(startDate)) : null;
    const to = endDate ? parseDateOnly(String(endDate)) : null;

    if ((startDate && !from) || (endDate && !to)) {
      return res.status(400).json({ message: 'Enter dates in YYYY-MM-DD format.' });
    }

    if (from && to && from > to) {
      return res.status(400).json({ message: 'The start date must be on or before the end date.' });
    }

    const { csv, count } = await exportTransactionsCsv(req.user.id, { from, to });
    const label = `${from ? formatDateOnly(from) : 'start'}-to-${to ? formatDateOnly(to) : formatDateOnly(today())}`;

    await auditExport(req, 'export_csv', { from: startDate || null, to: endDate || null, rows: count });

    return sendDownload(res, {
      body: csv,
      type: 'text/csv; charset=utf-8',
      fileName: `pfem-transactions-${label}.csv`,
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// A small file in the documented layout, to show what an import expects.
router.get('/import/template', (req, res) => {
  const date = formatDateOnly(today());
  const csv = toCsv([
    CSV_COLUMNS,
    [date, 'expense', '250.00', 'INR', 'Cash', '', '', 'cash', 'Lunch', 'food'],
    [date, 'income', '50000.00', 'INR', 'Bank', '', '', 'bank_transfer', 'Salary', ''],
    [date, 'transfer', '1000.00', 'INR', 'Bank', 'Cash', '', '', 'ATM withdrawal', ''],
  ]);

  return sendDownload(res, { body: csv, type: 'text/csv; charset=utf-8', fileName: 'pfem-import-template.csv' });
});

// REQ-83 .. REQ-85: validate and preview. Nothing is written.
router.post('/import/preview', async (req, res, next) => {
  try {
    const data = await previewImport(req.user.id, {
      csv: req.body?.csv,
      mapping: req.body?.mapping,
    });
    return res.json({ data });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// REQ-84 .. REQ-86: import the valid rows after the user confirms.
router.post('/import/commit', async (req, res, next) => {
  try {
    const data = await commitImport(
      req.user.id,
      {
        csv: req.body?.csv,
        mapping: req.body?.mapping,
        importDuplicates: req.body?.import_duplicates,
      },
      { ip: req.ip },
    );

    return res.status(201).json({
      message: `Imported ${data.imported} transaction${data.imported === 1 ? '' : 's'}.`,
      data,
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

// REQ-87: everything the user owns, as one JSON file.
router.get('/export.json', async (req, res, next) => {
  try {
    const data = await exportAllJson(req.user.id);
    await auditExport(req, 'export_json', data.counts);

    return sendDownload(res, {
      body: JSON.stringify(data, null, 2),
      type: 'application/json; charset=utf-8',
      fileName: `pfem-my-data-${formatDateOnly(today())}.json`,
    });
  } catch (error) {
    return sendApiError(res, next, error);
  }
});

export default router;
