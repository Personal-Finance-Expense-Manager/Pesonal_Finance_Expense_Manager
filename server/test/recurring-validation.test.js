import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  END_BEFORE_START_MESSAGE, validateRecurringRuleInput,
} from '../src/validators/recurringRule.js';

const TODAY = new Date('2026-11-04T00:00:00.000Z');
const ID = 'a'.repeat(24);
const valid = (over = {}) => ({
  type: 'expense', amount: '15000', account_id: ID, category_id: ID,
  frequency: 'monthly', start_date: '2026-12-01', ...over,
});
const run = (body, opts = {}) => validateRecurringRuleInput(body, { today: TODAY, ...opts });

test('REQ-52 UT_33 a complete monthly rule is accepted and normalised', () => {
  const { data, errors } = run(valid());
  assert.equal(errors, undefined);
  assert.equal(data.amount, '15000.00');
  assert.equal(data.frequency, 'monthly');
  assert.equal(data.start_date.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(data.type, 'expense');
});

test('REQ-52 every supported frequency is accepted, others are not', () => {
  for (const f of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
    assert.equal(run(valid({ frequency: f })).errors, undefined, f);
  }
  assert.ok(run(valid({ frequency: 'fortnightly' })).errors.frequency);
  assert.ok(run(valid({ frequency: undefined })).errors.frequency);
});

test('REQ-52 UT_34 an end date, an occurrence count, or neither is accepted', () => {
  assert.equal(run(valid({ end_date: '2027-12-01' })).errors, undefined);
  assert.equal(run(valid({ occurrence_count: 12 })).errors, undefined);
  assert.equal(run(valid({ occurrence_count: '12' })).data.occurrence_count, 12);
  assert.equal(run(valid()).errors, undefined);
  assert.equal(run(valid({ end_date: '', occurrence_count: null })).errors, undefined);
});

test('REQ-52 an end date and an occurrence count together are refused', () => {
  const { errors } = run(valid({ end_date: '2027-12-01', occurrence_count: 12 }));
  assert.match(errors.occurrence_count, /either an end date or an occurrence count/);
});

test('REQ-52 the occurrence count must be a whole number from 1 to 1000', () => {
  for (const bad of [0, -1, 1.5, 'abc', 1001]) {
    assert.ok(run(valid({ occurrence_count: bad })).errors.occurrence_count, String(bad));
  }
});

test('REQ-53 UT_18 an end date before the start date gives the exact SRS message', () => {
  const { errors } = run(valid({ start_date: '2026-12-01', end_date: '2026-11-30' }));
  assert.equal(errors.end_date, 'End date must be after the start date.');
  assert.equal(END_BEFORE_START_MESSAGE, 'End date must be after the start date.');
});

test('REQ-53 the end date may equal the start date (a single occurrence)', () => {
  assert.equal(run(valid({ start_date: '2026-12-01', end_date: '2026-12-01' })).errors, undefined);
});

test('REQ-52 amount: positive, at most two decimals', () => {
  for (const bad of ['0', '-5', '1.234', 'abc', '', undefined, null]) {
    assert.ok(run(valid({ amount: bad })).errors.amount, String(bad));
  }
  assert.equal(run(valid({ amount: '10.5' })).data.amount, '10.50');
});

test('REQ-52 type, account and category are validated', () => {
  assert.ok(run(valid({ type: 'transfer' })).errors.type);
  assert.ok(run(valid({ account_id: 'nope' })).errors.account_id);
  assert.ok(run(valid({ account_id: undefined })).errors.account_id);
  assert.ok(run(valid({ category_id: 'nope' })).errors.category_id);
  assert.equal(run(valid({ category_id: '' })).data.category_id, null);
});

test('REQ-52 the start date must be a real calendar day, today or later', () => {
  assert.ok(run(valid({ start_date: '2026-02-30' })).errors.start_date);
  assert.ok(run(valid({ start_date: '01/12/2026' })).errors.start_date);
  assert.equal(run(valid({ start_date: '2026-11-03' })).errors.start_date, 'Start date cannot be in the past.');
  assert.equal(run(valid({ start_date: '2026-11-04' })).errors, undefined);
});

test('unknown fields cannot be smuggled in', () => {
  const { errors } = run(valid({ user_id: ID, status: 'completed', next_due_date: '2020-01-01' }));
  assert.ok(errors.user_id && errors.status && errors.next_due_date);
});

test('REQ-56 a partial edit checks only the fields sent', () => {
  assert.equal(run({ amount: '20' }, { allowPartial: true }).data.amount, '20.00');
  assert.deepEqual(Object.keys(run({ amount: '20' }, { allowPartial: true }).data), ['amount']);
  assert.ok(run({ amount: '-1' }, { allowPartial: true }).errors.amount);
  assert.deepEqual(run({}, { allowPartial: true }).data, {});
});

test('payment mode and note are optional but checked', () => {
  assert.equal(run(valid({ payment_mode: 'upi', note: ' Rent ' })).data.note, 'Rent');
  assert.ok(run(valid({ payment_mode: 'cheque' })).errors.payment_mode);
  assert.ok(run(valid({ note: 'x'.repeat(201) })).errors.note);
});
