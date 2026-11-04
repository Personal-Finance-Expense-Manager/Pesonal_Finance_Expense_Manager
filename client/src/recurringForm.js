/**
 * Pure helpers for the recurring-rules page (US-16, REQ-52, REQ-53, REQ-56).
 * No React and no network, so they can be unit tested under node.
 * The messages match the server's, which stays the authority.
 */

export const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

export const END_BEFORE_START = 'End date must be after the start date.';

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in India as YYYY-MM-DD (the app's scheduling day), whatever the browser's zone. */
export function todayIst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function isRealDate(value) {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function emptyRuleForm(today = todayIst()) {
  return {
    type: 'expense', amount: '', account_id: '', category_id: '', frequency: 'monthly',
    start_date: today, end_mode: 'never', end_date: '', occurrence_count: '', note: '',
  };
}

/**
 * Field errors for the form, as { field: message }. Empty object = valid.
 * `existing` is the rule being edited: an unchanged past start date is fine.
 */
export function validateRuleForm(form, { today = todayIst(), existing = null } = {}) {
  const errors = {};

  if (!['income', 'expense'].includes(form.type)) errors.type = 'Choose income or expense.';

  const amount = String(form.amount ?? '').trim();
  if (!AMOUNT.test(amount) || Number(amount) <= 0) {
    errors.amount = 'Enter an amount greater than 0 with up to 2 decimal places.';
  }

  if (!form.account_id) errors.account_id = 'Select an account.';

  if (!FREQUENCIES.some((f) => f.value === form.frequency)) errors.frequency = 'Choose how often it repeats.';

  if (!isRealDate(form.start_date)) errors.start_date = 'Enter a valid date.';
  else if (form.start_date < today && form.start_date !== existing?.start_date) {
    errors.start_date = 'Start date cannot be in the past.';
  }

  if (form.end_mode === 'date') {
    if (!isRealDate(form.end_date)) errors.end_date = 'Enter a valid end date.';
    else if (isRealDate(form.start_date) && form.end_date < form.start_date) errors.end_date = END_BEFORE_START;
  }

  if (form.end_mode === 'count') {
    const n = String(form.occurrence_count ?? '').trim();
    if (!/^\d+$/.test(n) || Number(n) < 1 || Number(n) > 1000) {
      errors.occurrence_count = 'Enter a whole number from 1 to 1000.';
    } else if (existing && Number(n) <= existing.occurrences_done) {
      errors.occurrence_count = `${existing.occurrences_done} already processed; enter a larger number.`;
    }
  }

  if (String(form.note ?? '').length > 200) errors.note = 'Note must be 200 characters or fewer.';

  return errors;
}

/** The request body for create (and edit). Sends both limits so one can clear the other. */
export function toRulePayload(form) {
  return {
    type: form.type,
    amount: String(form.amount).trim(),
    account_id: form.account_id,
    category_id: form.category_id || null,
    frequency: form.frequency,
    start_date: form.start_date,
    end_date: form.end_mode === 'date' ? form.end_date : null,
    occurrence_count: form.end_mode === 'count' ? Number(form.occurrence_count) : null,
    note: form.note.trim(),
  };
}

export function ruleToForm(rule) {
  return {
    type: rule.type,
    amount: rule.amount,
    account_id: rule.account_id,
    category_id: rule.category_id || '',
    frequency: rule.frequency,
    start_date: rule.start_date,
    end_mode: rule.end_date ? 'date' : rule.occurrence_count ? 'count' : 'never',
    end_date: rule.end_date || '',
    occurrence_count: rule.occurrence_count ? String(rule.occurrence_count) : '',
    note: rule.note || '',
  };
}

export function frequencyLabel(value) {
  return FREQUENCIES.find((f) => f.value === value)?.label ?? value;
}

/** "Monthly · until 1 Dec 2027" / "Weekly · 12 times" / "Daily · no end". */
export function describeSchedule(rule, formatDate = (d) => d) {
  const base = frequencyLabel(rule.frequency);
  if (rule.end_date) return `${base} · until ${formatDate(rule.end_date)}`;
  if (rule.occurrence_count) return `${base} · ${rule.occurrence_count} time${rule.occurrence_count === 1 ? '' : 's'}`;
  return `${base} · no end`;
}

export const RULE_STATUS = {
  active: { label: 'Active', bg: '#123524', text: '#bbf7d0' },
  paused: { label: 'Paused', bg: '#422006', text: '#fde68a' },
  completed: { label: 'Completed', bg: '#1e293b', text: '#cbd5e1' },
};

/** Which actions a rule in this state offers. */
export function ruleActions(rule) {
  return {
    canEdit: rule.status !== 'completed',
    canPause: rule.status === 'active',
    canResume: rule.status === 'paused',
  };
}
