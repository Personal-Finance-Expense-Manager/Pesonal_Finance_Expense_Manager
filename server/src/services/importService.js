import mongoose from 'mongoose';
import Decimal from 'decimal.js';
import Account from '../models/Account.js';
import Category from '../models/Category.js';
import Transaction from '../models/Transaction.js';
import TransactionTag from '../models/TransactionTag.js';
import Transfer from '../models/Transfer.js';
import { ApiError } from '../utils/apiError.js';
import { parseCsv, unprotectCell } from '../utils/csv.js';
import { formatDateOnly } from '../utils/period.js';
import { validateTransactionInput } from '../validators/transaction.js';
import { recordAudit } from './auditService.js';
import { resolveTagIds } from './transactionService.js';

/**
 * CSV import - US-24 (#58), SRS REQ-83 to REQ-86.
 *
 *   1. preview  - parse, map columns, validate every row and flag probable
 *                 duplicates. Nothing is written (REQ-83).
 *   2. commit   - repeat the same checks on the server (the preview is never
 *                 trusted), then write only the valid rows, skipping
 *                 duplicates unless the user chose them (REQ-84, REQ-85).
 *
 * Every row goes through validateTransactionInput, the validator POST
 * /api/transactions uses, and is stored as an ordinary Transaction or
 * Transfer. Balances, budget utilisation and reports are derived from those
 * records on every read, so they reflect an import exactly as they would the
 * same entries made by hand (REQ-86).
 *
 * A commit is all-or-nothing (SAF-5): if any write fails, everything this
 * import wrote is removed again before the error is returned.
 */

/** Fields a file can be mapped to. */
export const IMPORT_FIELDS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'type', label: 'Type (income, expense or transfer)', required: false },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'account', label: 'Account', required: true },
  { key: 'to_account', label: 'To account (transfers)', required: false },
  { key: 'category', label: 'Category', required: false },
  { key: 'payment_mode', label: 'Payment mode', required: false },
  { key: 'note', label: 'Note', required: false },
  { key: 'tags', label: 'Tags (separated by ;)', required: false },
];

export const MAX_IMPORT_ROWS = 5000;

// Headings recognised automatically when suggesting a mapping.
const SYNONYMS = {
  date: ['date', 'transaction date', 'txn date', 'value date', 'posting date'],
  type: ['type', 'transaction type', 'kind', 'dr/cr', 'debit/credit'],
  amount: ['amount', 'amt', 'value', 'amount (inr)', 'amount inr'],
  account: ['account', 'account name', 'from account', 'source account'],
  to_account: ['to account', 'to_account', 'destination account'],
  category: ['category', 'category name'],
  payment_mode: ['payment mode', 'payment_mode', 'mode', 'payment method', 'method'],
  note: ['note', 'notes', 'description', 'narration', 'details', 'remarks', 'memo'],
  tags: ['tags', 'tag', 'labels'],
};

const PAYMENT_MODES = {
  cash: 'cash',
  card: 'card',
  'credit card': 'card',
  'debit card': 'card',
  upi: 'upi',
  bank_transfer: 'bank_transfer',
  'bank transfer': 'bank_transfer',
  neft: 'bank_transfer',
  imps: 'bank_transfer',
  rtgs: 'bank_transfer',
  wallet: 'wallet',
  other: 'other',
};

const TYPES = {
  income: 'income',
  credit: 'income',
  cr: 'income',
  expense: 'expense',
  debit: 'expense',
  dr: 'expense',
  transfer: 'transfer',
};

const normalise = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Suggest a mapping { field: column index } from the file's headings. */
export function suggestMapping(headers) {
  const mapping = {};
  const names = headers.map((h) => normalise(h).replace(/_/g, ' '));

  for (const { key } of IMPORT_FIELDS) {
    const wanted = SYNONYMS[key].map((s) => s.replace(/_/g, ' '));
    const index = names.findIndex((name) => wanted.includes(name));
    if (index !== -1 && !Object.values(mapping).includes(index)) mapping[key] = index;
  }

  return mapping;
}

/** Check a client-supplied mapping: each field to a distinct, existing column. */
function checkMapping(mapping, columnCount) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new ApiError(400, 'Choose which column holds each field.');
  }

  const clean = {};
  const used = new Set();
  const known = new Set(IMPORT_FIELDS.map((f) => f.key));

  for (const [key, raw] of Object.entries(mapping)) {
    if (!known.has(key)) throw new ApiError(400, `Unknown field "${key}".`);
    if (raw === null || raw === '' || raw === undefined) continue;
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= columnCount) {
      throw new ApiError(400, `The column chosen for ${key} does not exist in the file.`);
    }
    if (used.has(index)) throw new ApiError(400, 'Each column can be mapped to only one field.');
    used.add(index);
    clean[key] = index;
  }

  const missing = IMPORT_FIELDS.filter((f) => f.required && clean[f.key] === undefined).map((f) => f.label);
  if (missing.length) {
    throw new ApiError(400, `Choose a column for: ${missing.join(', ')}.`);
  }

  return clean;
}

/** YYYY-MM-DD, or DD/MM/YYYY and DD-MM-YYYY as Indian bank statements write them. */
export function normaliseDate(raw) {
  const text = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return text;
}

/** "₹1,234.50", "INR 1234.5" and "1 234.50" all become "1234.50"-style strings. */
export function normaliseAmount(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^(₹|rs\.?|inr)\s*/i, '')
    .replace(/[,\s]/g, '');
}

function sameText(a, b) {
  return normalise(a) === normalise(b);
}

/** Key used to spot a probable duplicate: date, amount, account and note (REQ-85). */
function duplicateKey(date, amount, accountId, note) {
  return [date, new Decimal(amount).toFixed(2), String(accountId), normalise(note)].join('|');
}

async function loadLookups(userId) {
  const [accounts, categories] = await Promise.all([
    Account.find({ user_id: userId }).select('name currency is_archived').lean(),
    Category.find({ user_id: userId }).select('name type').lean(),
  ]);

  return { accounts, categories };
}

/**
 * Validate every data row. Returns { rows, invalid } where each valid row has
 * the transaction body to store and a duplicate flag.
 */
async function analyse(userId, csvText, rawMapping) {
  if (typeof csvText !== 'string' || !csvText.trim()) {
    throw new ApiError(400, 'Choose a CSV file to import.');
  }

  const table = parseCsv(csvText);

  if (table.length < 2) {
    throw new ApiError(400, 'The file needs a heading row and at least one transaction.');
  }

  const [headers, ...data] = table;

  if (data.length > MAX_IMPORT_ROWS) {
    throw new ApiError(400, `A file can hold at most ${MAX_IMPORT_ROWS} transactions. Split it and import each part.`);
  }

  const mapping = rawMapping === undefined || rawMapping === null
    ? suggestMapping(headers)
    : checkMapping(rawMapping, headers.length);

  const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === undefined);

  // With no usable mapping yet, return the headings so the user can map them.
  if (missing.length) {
    return { headers, mapping, needsMapping: true, rows: [], invalid: [], total: data.length };
  }

  const { accounts, categories } = await loadLookups(userId);
  const cell = (row, key) => (mapping[key] === undefined ? '' : unprotectCell(row[mapping[key]] ?? '').trim());

  const rows = [];
  const invalid = [];

  data.forEach((row, i) => {
    const rowNumber = i + 2; // the heading is row 1, as a spreadsheet numbers it
    const reasons = [];

    // With no type column every row is an expense, the common case for a
    // spending list kept in a spreadsheet.
    const typeText = normalise(cell(row, 'type'));
    const type = mapping.type === undefined ? 'expense' : TYPES[typeText] || null;
    const amountText = normaliseAmount(cell(row, 'amount'));

    if (!type) {
      reasons.push(typeText
        ? `Type "${cell(row, 'type')}" is not income, expense or transfer.`
        : 'Type is missing.');
    }

    const accountName = cell(row, 'account');
    const account = accounts.find((a) => sameText(a.name, accountName));

    if (!accountName) reasons.push('Account is missing.');
    else if (!account) reasons.push(`Account "${accountName}" does not exist. Create it first.`);
    else if (account.is_archived) reasons.push(`Account "${accountName}" is archived.`);

    const body = {
      type: type || 'expense',
      amount: amountText,
      transaction_date: normaliseDate(cell(row, 'date')),
      note: cell(row, 'note'),
    };

    let toAccount = null;

    if (type === 'transfer') {
      const toName = cell(row, 'to_account');
      toAccount = accounts.find((a) => sameText(a.name, toName));
      if (!toName) reasons.push('A transfer needs a "to account".');
      else if (!toAccount) reasons.push(`Account "${toName}" does not exist. Create it first.`);
      else if (toAccount.is_archived) reasons.push(`Account "${toName}" is archived.`);
      else if (account && account.currency !== toAccount.currency) {
        reasons.push('Transfers between accounts in different currencies are not supported.');
      }
      body.from_account_id = account?._id.toString() || '';
      body.to_account_id = toAccount?._id.toString() || '';
    } else {
      body.account_id = account?._id.toString() || '';
      const categoryName = cell(row, 'category');
      if (categoryName) {
        const category = categories.find((c) => c.type === type && sameText(c.name, categoryName));
        if (category) body.category_id = category._id.toString();
        else if (type) reasons.push(`Category "${categoryName}" does not exist for ${type}. Create it first or leave it blank.`);
      }
      const modeText = normalise(cell(row, 'payment_mode'));
      if (modeText) {
        if (PAYMENT_MODES[modeText]) body.payment_mode = PAYMENT_MODES[modeText];
        else reasons.push(`Payment mode "${cell(row, 'payment_mode')}" is not recognised.`);
      }
      const tagText = cell(row, 'tags');
      if (tagText) body.tags = tagText.split(/[;|]/).map((t) => t.trim()).filter(Boolean);
    }

    const checked = validateTransactionInput(body);

    if (checked.errors) {
      for (const [field, message] of Object.entries(checked.errors)) {
        // Account problems were already explained by name above.
        if (['account_id', 'from_account_id', 'to_account_id'].includes(field) && reasons.length) continue;
        reasons.push(field === 'amount' && !amountText ? 'Amount is missing.' : message);
      }
    }

    if (reasons.length) {
      invalid.push({ row: rowNumber, reasons: [...new Set(reasons)] });
      return;
    }

    rows.push({
      row: rowNumber,
      data: checked.data,
      display: {
        date: formatDateOnly(checked.data.transaction_date),
        type: checked.data.type,
        amount: checked.data.amount,
        account: account.name,
        to_account: toAccount?.name || '',
        category: cell(row, 'category'),
        note: checked.data.note,
        tags: checked.data.tags || [],
      },
      duplicate: false,
    });
  });

  await flagDuplicates(userId, rows);

  return { headers, mapping, needsMapping: false, rows, invalid, total: data.length };
}

/** Mark rows matching an existing live record on date, amount, account and note. */
async function flagDuplicates(userId, rows) {
  if (!rows.length) return;

  const dates = rows.map((r) => r.data.transaction_date.getTime());
  const range = { $gte: new Date(Math.min(...dates)), $lte: new Date(Math.max(...dates)) };

  const [transactions, transfers] = await Promise.all([
    Transaction.find({ user_id: userId, is_deleted: { $ne: true }, transaction_date: range })
      .select('transaction_date amount account_id note')
      .lean(),
    Transfer.find({ user_id: userId, is_deleted: { $ne: true }, transfer_date: range })
      .select('transfer_date amount from_account_id note')
      .lean(),
  ]);

  const existing = new Set([
    ...transactions.map((t) =>
      duplicateKey(formatDateOnly(t.transaction_date), t.amount.toString(), t.account_id, t.note)),
    ...transfers.map((t) =>
      duplicateKey(formatDateOnly(t.transfer_date), t.amount.toString(), t.from_account_id, t.note)),
  ]);

  for (const row of rows) {
    const accountId = row.data.type === 'transfer' ? row.data.from_account_id : row.data.account_id;
    row.duplicate = existing.has(
      duplicateKey(row.display.date, row.data.amount, accountId, row.data.note),
    );
  }
}

/** REQ-83, REQ-84, REQ-85: what would be imported. Writes nothing. */
export async function previewImport(userId, { csv, mapping } = {}) {
  const result = await analyse(userId, csv, mapping);

  return {
    fields: IMPORT_FIELDS,
    headers: result.headers,
    mapping: result.mapping,
    needs_mapping: result.needsMapping,
    total_rows: result.total,
    valid_count: result.rows.length,
    invalid_count: result.invalid.length,
    duplicate_count: result.rows.filter((r) => r.duplicate).length,
    rows: result.rows.map((r) => ({ row: r.row, duplicate: r.duplicate, ...r.display })),
    invalid_rows: result.invalid,
  };
}

/**
 * REQ-84, REQ-85: write the valid rows. Probable duplicates are skipped unless
 * their row numbers are listed in `importDuplicates`.
 */
export async function commitImport(userId, { csv, mapping, importDuplicates = [] } = {}, { ip } = {}) {
  const result = await analyse(userId, csv, mapping);

  if (result.needsMapping) throw new ApiError(400, 'Choose which column holds each field.');

  const chosen = new Set((Array.isArray(importDuplicates) ? importDuplicates : []).map(Number));
  const toWrite = result.rows.filter((r) => !r.duplicate || chosen.has(r.row));
  const skipped = result.rows.filter((r) => r.duplicate && !chosen.has(r.row)).map((r) => r.row);

  if (!toWrite.length) {
    return { imported: 0, skipped_duplicates: skipped, invalid_rows: result.invalid };
  }

  const accountCurrency = new Map(
    (await Account.find({ user_id: userId }).select('currency').lean()).map((a) => [a._id.toString(), a.currency]),
  );

  const batchId = new mongoose.Types.ObjectId();
  const written = { transactions: [], transfers: [], links: [] };

  try {
    const transactionRows = toWrite.filter((r) => r.data.type !== 'transfer');
    const transferRows = toWrite.filter((r) => r.data.type === 'transfer');

    if (transactionRows.length) {
      const docs = await Transaction.insertMany(
        transactionRows.map(({ data }) => ({
          user_id: userId,
          account_id: data.account_id,
          category_id: data.category_id ?? null,
          type: data.type,
          amount: data.amount,
          currency: accountCurrency.get(data.account_id) || 'INR',
          transaction_date: data.transaction_date,
          payment_mode: data.payment_mode,
          note: data.note,
        })),
        { ordered: true },
      );
      written.transactions = docs.map((d) => d._id);

      const links = [];
      for (let i = 0; i < docs.length; i += 1) {
        const tags = transactionRows[i].data.tags || [];
        if (!tags.length) continue;
        const tagIds = await resolveTagIds(userId, tags);
        for (const tagId of tagIds) {
          links.push({ user_id: userId, transaction_id: docs[i]._id, tag_id: tagId });
        }
      }
      if (links.length) {
        const linkDocs = await TransactionTag.insertMany(links, { ordered: true });
        written.links = linkDocs.map((d) => d._id);
      }
    }

    if (transferRows.length) {
      const docs = await Transfer.insertMany(
        transferRows.map(({ data }) => ({
          user_id: userId,
          from_account_id: data.from_account_id,
          to_account_id: data.to_account_id,
          amount: data.amount,
          transfer_date: data.transaction_date,
          note: data.note,
        })),
        { ordered: true },
      );
      written.transfers = docs.map((d) => d._id);
    }
  } catch (error) {
    // SAF-5: leave no partial import behind.
    await rollback(userId, written);
    throw error;
  }

  await recordAudit({
    userId,
    entityType: 'import',
    entityId: batchId,
    action: 'import_csv',
    newValue: {
      transactions: written.transactions.length,
      transfers: written.transfers.length,
      skipped_duplicates: skipped.length,
      invalid_rows: result.invalid.length,
    },
    ip,
  });

  return {
    imported: written.transactions.length + written.transfers.length,
    skipped_duplicates: skipped,
    invalid_rows: result.invalid,
  };
}

/**
 * Undo whatever part of an import was written. Exported so the test suite can
 * check the clean-up directly.
 */
export async function rollback(userId, written) {
  await Promise.all([
    written.links.length
      ? TransactionTag.deleteMany({ _id: { $in: written.links }, user_id: userId }) : null,
    written.transactions.length
      ? TransactionTag.deleteMany({ transaction_id: { $in: written.transactions }, user_id: userId }) : null,
  ]);
  await Promise.all([
    written.transactions.length
      ? Transaction.deleteMany({ _id: { $in: written.transactions }, user_id: userId }) : null,
    written.transfers.length
      ? Transfer.deleteMany({ _id: { $in: written.transfers }, user_id: userId }) : null,
  ]);
}
