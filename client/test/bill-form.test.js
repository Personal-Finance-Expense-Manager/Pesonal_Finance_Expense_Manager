import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILL_STATUS, DEFAULT_LEAD_DAYS, LEAD_TIME_OPTIONS, billToForm, dueLabel, emptyBillForm,
  payAction, toBillPayload, validateBillForm,
} from '../src/billForm.js';

const valid = (over = {}) => ({ ...emptyBillForm(), name: 'Electricity', amount: '3000', due_date: '2026-11-20', ...over });

test('REQ-57 the lead time defaults to three days and is offered as a choice', () => {
  assert.equal(DEFAULT_LEAD_DAYS, 3);
  assert.equal(emptyBillForm().notify_days_before, 3);
  assert.ok(LEAD_TIME_OPTIONS.some((o) => o.value === 3));
  assert.ok(LEAD_TIME_OPTIONS.length >= 5);
});

test('a complete form is valid', () => {
  assert.deepEqual(validateBillForm(valid()), {});
});

test('name, amount and due date are required and checked', () => {
  const errors = validateBillForm(emptyBillForm());
  assert.ok(errors.name && errors.amount && errors.due_date);
  assert.ok(validateBillForm(valid({ name: 'x'.repeat(121) })).name);
  for (const bad of ['0', '-1', '1.999', 'abc']) assert.ok(validateBillForm(valid({ amount: bad })).amount, bad);
  assert.ok(validateBillForm(valid({ due_date: '2026-02-30' })).due_date);
});

test('the lead time must be a whole number of days from 0 to 365', () => {
  for (const bad of [-1, 366, 1.5, 'x']) assert.ok(validateBillForm(valid({ notify_days_before: bad })).notify_days_before, String(bad));
  assert.deepEqual(validateBillForm(valid({ notify_days_before: '0' })), {});
});

test('the payload is trimmed and numeric where the API expects it', () => {
  const p = toBillPayload(valid({ name: '  Rent ', notify_days_before: '7' }));
  assert.equal(p.name, 'Rent');
  assert.equal(p.notify_days_before, 7);
  assert.equal(p.account_id, null);
  assert.equal(p.category_id, null);
});

test('a bill round-trips through the edit form', () => {
  const bill = { name: 'Water', amount: '450.00', due_date: '2026-12-01', notify_days_before: 5, account_id: 'a', category_id: null };
  const form = billToForm(bill);
  assert.equal(form.category_id, '');
  assert.deepEqual(toBillPayload(form), { name: 'Water', amount: '450.00', due_date: '2026-12-01', notify_days_before: 5, account_id: 'a', category_id: null });
});

test('REQ-59 due labels count forward and back and say Paid for paid bills', () => {
  assert.equal(dueLabel({ status: 'pending', days_until_due: 0 }), 'Due today');
  assert.equal(dueLabel({ status: 'pending', days_until_due: 1 }), 'Due tomorrow');
  assert.equal(dueLabel({ status: 'pending', days_until_due: 9 }), 'Due in 9 days');
  assert.equal(dueLabel({ status: 'overdue', days_until_due: -1 }), '1 day overdue');
  assert.equal(dueLabel({ status: 'overdue', days_until_due: -5 }), '5 days overdue');
  assert.equal(dueLabel({ status: 'paid', days_until_due: -5 }), 'Paid');
});

test('REQ-58 mark-as-paid is one tap when an account is saved, and offered only until paid', () => {
  assert.deepEqual(payAction({ status: 'pending', account_id: 'a' }), { canPay: true, needsAccount: false });
  assert.deepEqual(payAction({ status: 'overdue', account_id: null }), { canPay: true, needsAccount: true });
  assert.deepEqual(payAction({ status: 'paid', account_id: 'a' }), { canPay: false, needsAccount: false });
});

test('paid and overdue have distinct indicators', () => {
  assert.notEqual(BILL_STATUS.paid.bg, BILL_STATUS.overdue.bg);
  assert.equal(BILL_STATUS.overdue.label, 'Overdue');
  assert.equal(BILL_STATUS.paid.label, 'Paid');
});
