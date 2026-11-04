import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  END_BEFORE_START, FREQUENCIES, describeSchedule, emptyRuleForm, frequencyLabel, isRealDate,
  ruleActions, ruleToForm, toRulePayload, todayIst, validateRuleForm,
} from '../src/recurringForm.js';

const TODAY = '2026-11-04';
const valid = (over = {}) => ({
  ...emptyRuleForm(TODAY), amount: '15000', account_id: 'acc1', start_date: '2026-12-01', ...over,
});
const check = (form, opts = {}) => validateRuleForm(form, { today: TODAY, ...opts });

test('all five frequencies are offered', () => {
  assert.deepEqual(FREQUENCIES.map((f) => f.value), ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']);
  assert.equal(frequencyLabel('quarterly'), 'Quarterly');
});

test('a complete form is valid', () => {
  assert.deepEqual(check(valid()), {});
});

test('required fields are reported', () => {
  const errors = check(valid({ amount: '', account_id: '', start_date: '' }));
  assert.ok(errors.amount && errors.account_id && errors.start_date);
});

test('amount must be positive with at most two decimals', () => {
  for (const bad of ['0', '-5', '1.234', 'abc', ' ']) assert.ok(check(valid({ amount: bad })).amount, bad);
  assert.deepEqual(check(valid({ amount: '10.5' })), {});
});

test('REQ-53 an end date before the start date shows the exact message', () => {
  const errors = check(valid({ end_mode: 'date', start_date: '2026-12-01', end_date: '2026-11-30' }));
  assert.equal(errors.end_date, 'End date must be after the start date.');
  assert.equal(END_BEFORE_START, 'End date must be after the start date.');
  assert.deepEqual(check(valid({ end_mode: 'date', start_date: '2026-12-01', end_date: '2026-12-01' })), {});
});

test('an end date is required when "on a date" is chosen', () => {
  assert.ok(check(valid({ end_mode: 'date', end_date: '' })).end_date);
});

test('an occurrence count must be a whole number from 1 to 1000', () => {
  for (const bad of ['', '0', '-1', '1.5', 'x', '1001']) {
    assert.ok(check(valid({ end_mode: 'count', occurrence_count: bad })).occurrence_count, bad);
  }
  assert.deepEqual(check(valid({ end_mode: 'count', occurrence_count: '12' })), {});
});

test('the start date cannot be in the past, except an existing rule\'s own', () => {
  assert.equal(check(valid({ start_date: '2026-11-03' })).start_date, 'Start date cannot be in the past.');
  assert.deepEqual(check(valid({ start_date: '2026-11-04' })), {});
  const existing = { start_date: '2026-10-01', occurrences_done: 2 };
  assert.deepEqual(check(valid({ start_date: '2026-10-01' }), { existing }), {});
});

test('an edited occurrence count must exceed those already processed', () => {
  const existing = { start_date: '2026-12-01', occurrences_done: 5 };
  assert.ok(check(valid({ end_mode: 'count', occurrence_count: '5' }), { existing }).occurrence_count);
  assert.deepEqual(check(valid({ end_mode: 'count', occurrence_count: '6' }), { existing }), {});
});

test('impossible calendar dates are rejected', () => {
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('2028-02-29'), true);
  assert.equal(isRealDate('2026-13-01'), false);
  assert.ok(check(valid({ start_date: '2026-02-30' })).start_date);
});

test('the payload sends exactly one limit and clears the other', () => {
  assert.deepEqual(
    [toRulePayload(valid({ end_mode: 'date', end_date: '2027-01-01' })).end_date, toRulePayload(valid({ end_mode: 'date', end_date: '2027-01-01' })).occurrence_count],
    ['2027-01-01', null],
  );
  const counted = toRulePayload(valid({ end_mode: 'count', occurrence_count: '12', end_date: '2027-01-01' }));
  assert.equal(counted.occurrence_count, 12);
  assert.equal(counted.end_date, null);
  const open = toRulePayload(valid());
  assert.equal(open.end_date, null);
  assert.equal(open.occurrence_count, null);
  assert.equal(open.category_id, null);
});

test('a rule round-trips through the edit form', () => {
  const rule = {
    type: 'income', amount: '500.00', account_id: 'a', category_id: 'c', frequency: 'weekly',
    start_date: '2026-12-01', end_date: null, occurrence_count: 8, note: 'x',
  };
  const form = ruleToForm(rule);
  assert.equal(form.end_mode, 'count');
  assert.equal(form.occurrence_count, '8');
  assert.equal(toRulePayload(form).occurrence_count, 8);
  assert.equal(ruleToForm({ ...rule, occurrence_count: null, end_date: '2027-01-01' }).end_mode, 'date');
  assert.equal(ruleToForm({ ...rule, occurrence_count: null }).end_mode, 'never');
});

test('schedule descriptions read naturally', () => {
  assert.equal(describeSchedule({ frequency: 'monthly', end_date: null, occurrence_count: null }), 'Monthly · no end');
  assert.equal(describeSchedule({ frequency: 'weekly', occurrence_count: 12 }), 'Weekly · 12 times');
  assert.equal(describeSchedule({ frequency: 'daily', occurrence_count: 1 }), 'Daily · 1 time');
  assert.equal(describeSchedule({ frequency: 'yearly', end_date: '2030-01-01' }, (d) => `<${d}>`), 'Yearly · until <2030-01-01>');
});

test('REQ-56 the actions offered match the rule state', () => {
  assert.deepEqual(ruleActions({ status: 'active' }), { canEdit: true, canPause: true, canResume: false });
  assert.deepEqual(ruleActions({ status: 'paused' }), { canEdit: true, canPause: false, canResume: true });
  assert.deepEqual(ruleActions({ status: 'completed' }), { canEdit: false, canPause: false, canResume: false });
});

test('todayIst uses the Indian day, not the browser\'s', () => {
  assert.equal(todayIst(new Date('2026-11-03T20:00:00Z')), '2026-11-04'); // 01:30 IST
  assert.equal(todayIst(new Date('2026-11-03T10:00:00Z')), '2026-11-03');
});
