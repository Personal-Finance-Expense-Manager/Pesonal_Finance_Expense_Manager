/**
 * Pure helpers for the bill-reminders page (US-17, REQ-57 .. REQ-59).
 * No React and no network, so they can be unit tested under node.
 */

export const LEAD_TIME_OPTIONS = [
  { value: 0, label: 'On the due date' },
  { value: 1, label: '1 day before' },
  { value: 2, label: '2 days before' },
  { value: 3, label: '3 days before (default)' },
  { value: 5, label: '5 days before' },
  { value: 7, label: '1 week before' },
  { value: 14, label: '2 weeks before' },
];

export const DEFAULT_LEAD_DAYS = 3;

const AMOUNT = /^\d+(\.\d{1,2})?$/;

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function emptyBillForm() {
  return {
    name: '', amount: '', due_date: '', notify_days_before: DEFAULT_LEAD_DAYS, account_id: '', category_id: '',
  };
}

export function validateBillForm(form) {
  const errors = {};
  const name = String(form.name ?? '').trim();
  if (!name) errors.name = 'Enter a bill name.';
  else if (name.length > 120) errors.name = 'Bill name must be 120 characters or fewer.';

  const amount = String(form.amount ?? '').trim();
  if (!AMOUNT.test(amount) || Number(amount) <= 0) {
    errors.amount = 'Enter an amount greater than 0 with up to 2 decimal places.';
  }

  if (!isRealDate(form.due_date)) errors.due_date = 'Enter a valid due date.';

  const days = Number(form.notify_days_before);
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    errors.notify_days_before = 'Choose how many days before the due date to be reminded.';
  }
  return errors;
}

export function toBillPayload(form) {
  return {
    name: form.name.trim(),
    amount: String(form.amount).trim(),
    due_date: form.due_date,
    notify_days_before: Number(form.notify_days_before),
    account_id: form.account_id || null,
    category_id: form.category_id || null,
  };
}

export function billToForm(bill) {
  return {
    name: bill.name,
    amount: bill.amount ?? '',
    due_date: bill.due_date,
    notify_days_before: bill.notify_days_before,
    account_id: bill.account_id || '',
    category_id: bill.category_id || '',
  };
}

export const BILL_STATUS = {
  pending: { label: 'Upcoming', bg: '#1e293b', text: '#cbd5e1' },
  overdue: { label: 'Overdue', bg: '#451a1a', text: '#fecaca' },
  paid: { label: 'Paid', bg: '#123524', text: '#bbf7d0' },
};

/** "Due today", "Due in 3 days", "5 days overdue", "Paid". */
export function dueLabel(bill) {
  if (bill.status === 'paid') return 'Paid';
  const n = bill.days_until_due;
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`;
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return `Due in ${n} days`;
}

/** Whether the one-tap pay button is offered, and whether it needs an account first. */
export function payAction(bill) {
  if (bill.status === 'paid') return { canPay: false, needsAccount: false };
  return { canPay: true, needsAccount: !bill.account_id };
}
