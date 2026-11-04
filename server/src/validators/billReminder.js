import { parseDateOnly } from '../utils/period.js';
import { parseAmount } from './transaction.js';

/** Validate a bill reminder request body - US-17 (#44), REQ-57. */

export const DEFAULT_NOTIFY_DAYS = 3;
export const MAX_NOTIFY_DAYS = 365;

const ALLOWED = ['name', 'amount', 'due_date', 'notify_days_before', 'account_id', 'category_id'];
const isObjectId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
const blank = (v) => v === undefined || v === null || v === '';

export function validateBillReminderInput(body, { allowPartial = false } = {}) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const errors = {};
  const data = {};
  const has = (key) => key in input;
  const required = (key) => !allowPartial || has(key);

  for (const key of Object.keys(input)) {
    if (!ALLOWED.includes(key)) errors[key] = 'This field cannot be changed.';
  }

  if (required('name')) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) errors.name = 'Enter a bill name.';
    else if (name.length > 120) errors.name = 'Bill name must be 120 characters or fewer.';
    else data.name = name;
  }

  if (required('amount')) {
    const amount = parseAmount(input.amount);
    if (amount === null) errors.amount = 'Enter an amount greater than 0 with up to 2 decimal places.';
    else data.amount = amount;
  }

  if (required('due_date')) {
    const due = parseDateOnly(input.due_date);
    if (!due) errors.due_date = 'Enter a valid date in YYYY-MM-DD format.';
    else if (due.getUTCFullYear() < 2000 || due.getUTCFullYear() > 2100) {
      errors.due_date = 'Enter a due date between the years 2000 and 2100.';
    } else data.due_date = due;
  }

  if (has('notify_days_before') || !allowPartial) {
    if (blank(input.notify_days_before)) {
      data.notify_days_before = DEFAULT_NOTIFY_DAYS;
    } else {
      const raw = input.notify_days_before;
      const n = typeof raw === 'number' ? raw : /^\d+$/.test(String(raw)) ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < 0 || n > MAX_NOTIFY_DAYS) {
        errors.notify_days_before = `Enter a whole number of days from 0 to ${MAX_NOTIFY_DAYS}.`;
      } else data.notify_days_before = n;
    }
  }

  for (const key of ['account_id', 'category_id']) {
    if (has(key)) {
      if (blank(input[key])) data[key] = null;
      else if (!isObjectId(input[key])) {
        errors[key] = key === 'account_id' ? 'Select a valid account.' : 'Select a valid category.';
      } else data[key] = input[key];
    }
  }

  return Object.keys(errors).length ? { errors } : { data };
}
