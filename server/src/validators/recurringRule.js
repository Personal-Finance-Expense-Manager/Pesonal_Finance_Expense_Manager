import { parseDateOnly, today as appToday } from '../utils/period.js';
import { FREQUENCIES } from '../utils/recurrence.js';
import { parseAmount } from './transaction.js';

/**
 * Validate a recurring rule request body - US-16 (#43), REQ-52, REQ-53.
 *
 * allowPartial  - edit mode: only the fields sent are checked.
 * today         - injectable for tests; defaults to today in the app time zone.
 */

export const END_BEFORE_START_MESSAGE = 'End date must be after the start date.';
export const MAX_OCCURRENCE_COUNT = 1000;

const TYPES = ['income', 'expense'];
const PAYMENT_MODES = ['cash', 'card', 'upi', 'bank_transfer', 'wallet', 'other'];
const ALLOWED = [
  'type', 'amount', 'account_id', 'category_id', 'frequency', 'start_date',
  'end_date', 'occurrence_count', 'payment_mode', 'note',
];

const isObjectId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const blank = (v) => v === undefined || v === null || v === '';

export function validateRecurringRuleInput(
  body,
  { allowPartial = false, today = appToday() } = {},
) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const errors = {};
  const data = {};
  const has = (key) => key in input;
  const required = (key) => !allowPartial || has(key);

  for (const key of Object.keys(input)) {
    if (!ALLOWED.includes(key)) errors[key] = 'This field cannot be changed.';
  }

  if (required('type')) {
    if (!TYPES.includes(input.type)) errors.type = 'Type must be income or expense.';
    else data.type = input.type;
  }

  if (required('amount')) {
    const amount = parseAmount(input.amount);
    if (amount === null) errors.amount = 'Enter an amount greater than 0 with up to 2 decimal places.';
    else data.amount = amount;
  }

  if (required('account_id')) {
    if (!isObjectId(input.account_id)) errors.account_id = 'Select a valid account.';
    else data.account_id = input.account_id;
  }

  if (required('category_id') && (has('category_id') || !allowPartial)) {
    if (blank(input.category_id)) data.category_id = null;
    else if (!isObjectId(input.category_id)) errors.category_id = 'Select a valid category.';
    else data.category_id = input.category_id;
  }

  if (required('frequency')) {
    if (!FREQUENCIES.includes(input.frequency)) {
      errors.frequency = 'Frequency must be daily, weekly, monthly, quarterly or yearly.';
    } else data.frequency = input.frequency;
  }

  if (required('start_date')) {
    const start = parseDateOnly(input.start_date);
    if (!start) errors.start_date = 'Enter a valid date in YYYY-MM-DD format.';
    else if (start.getTime() < today.getTime()) errors.start_date = 'Start date cannot be in the past.';
    else data.start_date = start;
  }

  if (has('end_date')) {
    if (blank(input.end_date)) data.end_date = null;
    else {
      const end = parseDateOnly(input.end_date);
      if (!end) errors.end_date = 'Enter a valid date in YYYY-MM-DD format.';
      else data.end_date = end;
    }
  }

  if (has('occurrence_count')) {
    if (blank(input.occurrence_count)) data.occurrence_count = null;
    else {
      const raw = input.occurrence_count;
      const n = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw)) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > MAX_OCCURRENCE_COUNT) {
        errors.occurrence_count = `Enter a whole number from 1 to ${MAX_OCCURRENCE_COUNT}.`;
      } else data.occurrence_count = n;
    }
  }

  // REQ-52: an end date, an occurrence count, or neither - not both.
  if (data.end_date && data.occurrence_count) {
    errors.occurrence_count = 'Choose either an end date or an occurrence count, not both.';
  }

  // REQ-53: the exact wording the SRS requires.
  if (data.start_date && data.end_date && data.end_date.getTime() < data.start_date.getTime()) {
    errors.end_date = END_BEFORE_START_MESSAGE;
  }

  if (has('payment_mode')) {
    if (!PAYMENT_MODES.includes(input.payment_mode)) errors.payment_mode = 'Select a valid payment mode.';
    else data.payment_mode = input.payment_mode;
  }

  if (has('note')) {
    if (blank(input.note)) data.note = '';
    else if (typeof input.note !== 'string' || input.note.trim().length > 200) {
      errors.note = 'Note must be 200 characters or fewer.';
    } else data.note = input.note.trim();
  }

  return Object.keys(errors).length ? { errors } : { data };
}
