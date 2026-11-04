import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBillReminderInput } from '../src/validators/billReminder.js';
import { effectiveStatus, notifyDate, presentReminder } from '../src/services/billReminderService.js';
import { backoffMs, MAX_ATTEMPTS } from '../src/services/notifications/notificationService.js';
import { emailChannel, pushChannel, smtpConfigured } from '../src/services/notifications/channels.js';

const d = (s) => new Date(`${s}T00:00:00.000Z`);
const ID = 'b'.repeat(24);

// ---------------------------------------------------------------------------
// REQ-57: creation and validation
// ---------------------------------------------------------------------------

test('REQ-57 UT_37 notify-days-before defaults to three when left blank', () => {
  for (const blank of [undefined, null, '']) {
    const { data, errors } = validateBillReminderInput({
      name: 'Electricity', amount: '3000', due_date: '2026-10-20', notify_days_before: blank,
    });
    assert.equal(errors, undefined);
    assert.equal(data.notify_days_before, 3);
  }
  assert.equal(validateBillReminderInput({ name: 'E', amount: '1', due_date: '2026-10-20' }).data.notify_days_before, 3);
});

test('REQ-57 a complete reminder is accepted and normalised', () => {
  const { data } = validateBillReminderInput({
    name: '  Electricity  ', amount: '3000', due_date: '2026-10-20', notify_days_before: '7',
  });
  assert.equal(data.name, 'Electricity');
  assert.equal(data.amount, '3000.00');
  assert.equal(data.due_date.toISOString(), '2026-10-20T00:00:00.000Z');
  assert.equal(data.notify_days_before, 7);
});

test('REQ-57 name, amount and due date are required and checked', () => {
  const { errors } = validateBillReminderInput({});
  assert.ok(errors.name && errors.amount && errors.due_date);
  assert.ok(validateBillReminderInput({ name: 'x'.repeat(121), amount: '1', due_date: '2026-10-20' }).errors.name);
  for (const bad of ['0', '-1', '1.999', 'abc']) {
    assert.ok(validateBillReminderInput({ name: 'x', amount: bad, due_date: '2026-10-20' }).errors.amount, bad);
  }
  for (const bad of ['2026-02-30', '20-10-2026', '1999-01-01', '2101-01-01']) {
    assert.ok(validateBillReminderInput({ name: 'x', amount: '1', due_date: bad }).errors.due_date, bad);
  }
});

test('REQ-57 the lead time is a whole number of days from 0 to 365', () => {
  for (const bad of [-1, 366, 1.5, 'abc']) {
    assert.ok(validateBillReminderInput({ name: 'x', amount: '1', due_date: '2026-10-20', notify_days_before: bad }).errors.notify_days_before, String(bad));
  }
  assert.equal(validateBillReminderInput({ name: 'x', amount: '1', due_date: '2026-10-20', notify_days_before: 0 }).data.notify_days_before, 0);
});

test('REQ-57 status and ownership fields cannot be set by the client', () => {
  const { errors } = validateBillReminderInput({
    name: 'x', amount: '1', due_date: '2026-10-20', status: 'paid', user_id: ID, linked_transaction_id: ID,
  });
  assert.ok(errors.status && errors.user_id && errors.linked_transaction_id);
});

test('a partial edit checks only the fields sent', () => {
  assert.deepEqual(validateBillReminderInput({ name: 'New' }, { allowPartial: true }).data, { name: 'New' });
  assert.ok(validateBillReminderInput({ amount: '0' }, { allowPartial: true }).errors.amount);
});

// ---------------------------------------------------------------------------
// Notification date and REQ-59: overdue
// ---------------------------------------------------------------------------

test('REQ-57 the notification date is the due date minus the lead time', () => {
  assert.equal(notifyDate({ due_date: d('2026-10-20'), notify_days_before: 3 }).toISOString().slice(0, 10), '2026-10-17');
  assert.equal(notifyDate({ due_date: d('2026-03-02'), notify_days_before: 3 }).toISOString().slice(0, 10), '2026-02-27');
  assert.equal(notifyDate({ due_date: d('2026-10-20'), notify_days_before: 0 }).toISOString().slice(0, 10), '2026-10-20');
});

test('REQ-59 ST_19 an unpaid bill past its due date is overdue; due today is not', () => {
  const today = d('2026-11-04');
  assert.equal(effectiveStatus({ status: 'pending', due_date: d('2026-11-03') }, today), 'overdue');
  assert.equal(effectiveStatus({ status: 'pending', due_date: d('2026-11-04') }, today), 'pending');
  assert.equal(effectiveStatus({ status: 'pending', due_date: d('2026-11-05') }, today), 'pending');
  assert.equal(effectiveStatus({ status: 'overdue', due_date: d('2026-11-03') }, today), 'overdue');
});

test('REQ-59 a paid bill is never shown as overdue', () => {
  assert.equal(effectiveStatus({ status: 'paid', due_date: d('2020-01-01') }, d('2026-11-04')), 'paid');
});

test('presentReminder shows days until due, negative once overdue', () => {
  const r = { _id: ID, name: 'Rent', amount: { toString: () => '100.00' }, due_date: d('2026-11-01'), notify_days_before: 3, status: 'pending' };
  const p = presentReminder(r, d('2026-11-04'));
  assert.equal(p.status, 'overdue');
  assert.equal(p.days_until_due, -3);
  assert.equal(p.notify_date, '2026-10-29');
  assert.equal(p.amount, '100.00');
});

// ---------------------------------------------------------------------------
// Notification honesty and retry policy (REQ-57, SRS CI-9)
// ---------------------------------------------------------------------------

test('retry backoff is exponential and there are three attempts', () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.deepEqual([1, 2, 3].map(backoffMs), [60000, 120000, 240000]);
});

test('email with no SMTP and no dev flag is reported as NOT configured, never sent', async () => {
  const result = await emailChannel.send({ user: { email: 'a@b.test' }, title: 't', body: 'b' }, { NODE_ENV: 'production' });
  assert.equal(result.status, 'skipped_not_configured');
});

test('email in dev-console mode is reported as logged, never sent', async () => {
  const original = console.log;
  console.log = () => {};
  try {
    const result = await emailChannel.send({ user: { email: 'a@b.test' }, title: 't', body: 'b' }, { NODE_ENV: 'development', DEV_EMAIL_CONSOLE: 'true' });
    assert.equal(result.status, 'logged_dev');
  } finally {
    console.log = original;
  }
});

test('DEV_EMAIL_CONSOLE is ignored in production', async () => {
  const result = await emailChannel.send({ user: { email: 'a@b.test' }, title: 't', body: 'b' }, { NODE_ENV: 'production', DEV_EMAIL_CONSOLE: 'true' });
  assert.equal(result.status, 'skipped_not_configured');
});

test('smtpConfigured needs host, user, password and a from address', () => {
  assert.equal(smtpConfigured({}), false);
  assert.equal(smtpConfigured({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }), false);
  assert.equal(smtpConfigured({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', EMAIL_FROM: 'f@x.test' }), true);
});

test('push with no provider registered is reported as NOT configured', async () => {
  const result = await pushChannel.send({ user: { _id: ID }, title: 't', body: 'b', reminder: { _id: ID } });
  assert.equal(result.status, 'skipped_not_configured');
});
