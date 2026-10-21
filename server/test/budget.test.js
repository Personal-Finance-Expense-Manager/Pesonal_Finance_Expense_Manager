import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateOnly,
  formatDateOnly,
  monthlyPeriod,
  weeklyPeriod,
  daysLeft,
  periodsOverlap,
  today,
} from '../src/utils/period.js';
import { validateNewBudget } from '../src/validators/budget.js';
import { summarise } from '../src/services/budgetService.js';
import { decideAlerts } from '../src/services/budgetEvaluator.js';

const d = (s) => parseDateOnly(s);
const range = (p) => [formatDateOnly(p.start), formatDateOnly(p.end)];
const TODAY = d('2026-10-21');
const CATEGORY = '652f1c2b9b1e8a0012345678';

// ---------------------------------------------------------------------------
// Period maths - BR-14 (month start day), REQ-45 (days left), REQ-44 (overlap)
// ---------------------------------------------------------------------------

test('dates: rejects impossible or badly formatted dates', () => {
  assert.equal(d('2026-02-30'), null);
  assert.equal(d('21-10-2026'), null);
  assert.equal(d(''), null);
});

test('BR-14 monthly period starts on the 1st by default', () => {
  assert.deepEqual(range(monthlyPeriod(TODAY, 1)), ['2026-10-01', '2026-10-31']);
});

test('BR-14 monthly period follows a month start day of 25', () => {
  assert.deepEqual(range(monthlyPeriod(TODAY, 25)), ['2026-09-25', '2026-10-24']);
  assert.deepEqual(range(monthlyPeriod(d('2026-10-25'), 25)), ['2026-10-25', '2026-11-24']);
});

test('BR-14 monthly period crosses the year boundary', () => {
  assert.deepEqual(range(monthlyPeriod(d('2026-01-10'), 25)), ['2025-12-25', '2026-01-24']);
});

test('weekly period is seven days', () => {
  assert.deepEqual(range(weeklyPeriod(TODAY)), ['2026-10-21', '2026-10-27']);
});

test('period end includes the whole last day', () => {
  const { end } = monthlyPeriod(TODAY, 1);
  assert.equal(end.toISOString(), '2026-10-31T23:59:59.999Z');
});

test('REQ-45 days left counts today and the last day', () => {
  const october = monthlyPeriod(TODAY, 1);
  assert.equal(daysLeft(october, d('2026-10-21')), 11);
  assert.equal(daysLeft(october, d('2026-10-31')), 1);
  assert.equal(daysLeft(october, d('2026-11-01')), 0);
  assert.equal(daysLeft(october, d('2026-09-15')), 31);
});

test('REQ-44 overlap: same days overlap, back-to-back periods do not', () => {
  const october = monthlyPeriod(TODAY, 1);
  const november = monthlyPeriod(d('2026-11-05'), 1);
  const lateOctWeek = weeklyPeriod(d('2026-10-28'));
  assert.equal(periodsOverlap(october, november), false);
  assert.equal(periodsOverlap(october, lateOctWeek), true);
});

test("today() uses the app time zone, not UTC", () => {
  // 20:00 UTC on 21 Oct is already 22 Oct in India.
  const now = new Date('2026-10-21T20:00:00Z');
  assert.equal(formatDateOnly(today('Asia/Kolkata', now)), '2026-10-22');
  assert.equal(formatDateOnly(today('UTC', now)), '2026-10-21');
});

// ---------------------------------------------------------------------------
// REQ-43 - create a budget (UT_27, UT_28)
// ---------------------------------------------------------------------------

test('REQ-43 UT_27 category budget, monthly, current period by default', () => {
  const { data, errors } = validateNewBudget(
    { category_id: CATEGORY, amount: '6000', period_type: 'monthly' },
    { today: TODAY, monthStartDay: 1 },
  );
  assert.equal(errors, undefined);
  assert.equal(data.category_id, CATEGORY);
  assert.equal(data.amount, '6000.00');
  assert.deepEqual(range({ start: data.period_start, end: data.period_end }), ['2026-10-01', '2026-10-31']);
});

test('REQ-43 UT_27 overall spending budget, weekly', () => {
  const { data } = validateNewBudget(
    { category_id: 'overall', amount: 5000, period_type: 'weekly', period_start: '2026-10-19' },
    { today: TODAY },
  );
  assert.equal(data.category_id, null);
  assert.deepEqual(range({ start: data.period_start, end: data.period_end }), ['2026-10-19', '2026-10-25']);
});

test('REQ-43 custom period needs a valid start and end', () => {
  const ok = validateNewBudget(
    { amount: '1000', period_type: 'custom', period_start: '2026-10-10', period_end: '2026-10-20' },
    { today: TODAY },
  );
  assert.deepEqual(range({ start: ok.data.period_start, end: ok.data.period_end }), ['2026-10-10', '2026-10-20']);

  const missingEnd = validateNewBudget(
    { amount: '1000', period_type: 'custom', period_start: '2026-10-10' },
    { today: TODAY },
  );
  assert.ok(missingEnd.errors.period_end);

  const backwards = validateNewBudget(
    { amount: '1000', period_type: 'custom', period_start: '2026-10-20', period_end: '2026-10-10' },
    { today: TODAY },
  );
  assert.match(backwards.errors.period_end, /on or after/);
});

test('REQ-43 UT_28 zero and negative amounts are rejected', () => {
  for (const amount of ['0', '-500', 0, '0.00']) {
    const { errors } = validateNewBudget({ amount, period_type: 'monthly' }, { today: TODAY });
    assert.match(errors.amount, /greater than zero/, `amount ${amount}`);
  }
});

test('REQ-43 non-numeric or over-precise amounts are rejected', () => {
  assert.ok(validateNewBudget({ amount: 'abc', period_type: 'monthly' }, { today: TODAY }).errors.amount);
  assert.match(
    validateNewBudget({ amount: '10.555', period_type: 'monthly' }, { today: TODAY }).errors.amount,
    /two decimal/,
  );
});

test('REQ-43 only weekly, monthly and custom periods are accepted', () => {
  for (const period_type of ['yearly', 'daily', undefined]) {
    const { errors } = validateNewBudget({ amount: '100', period_type }, { today: TODAY });
    assert.ok(errors.period_type, `period ${period_type}`);
  }
});

test('REQ-43 an invalid category id is rejected', () => {
  const { errors } = validateNewBudget(
    { category_id: 'food', amount: '100', period_type: 'monthly' },
    { today: TODAY },
  );
  assert.ok(errors.category_id);
});

// ---------------------------------------------------------------------------
// REQ-45 - utilisation figures (ST_15)
// ---------------------------------------------------------------------------

test('REQ-45 ST_15 budgeted, spent, remaining, percent and days left', () => {
  const october = monthlyPeriod(TODAY, 1);
  const u = summarise('6000', '2400', october, TODAY);
  assert.deepEqual(u, {
    budgeted: '6000.00',
    spent: '2400.00',
    remaining: '3600.00',
    percent_used: 40,
    days_left: 11,
    status: 'ok',
  });
});

test('REQ-45 status turns to warning at 80% and over at 100%', () => {
  const p = monthlyPeriod(TODAY, 1);
  assert.equal(summarise('6000', '4799.99', p, TODAY).status, 'ok');
  assert.equal(summarise('6000', '4800', p, TODAY).status, 'warning');
  assert.equal(summarise('6000', '6000', p, TODAY).status, 'over');
  assert.equal(summarise('6000', '6100', p, TODAY).remaining, '-100.00');
});

// ---------------------------------------------------------------------------
// REQ-46 - alerts once per budget per period (IT_07, IT_08)
// ---------------------------------------------------------------------------

test('REQ-46 no alert below 80%', () => {
  assert.deepEqual(decideAlerts(79.9, false, false),
    { sendWarning: false, sendOver: false, markWarning: false, markOver: false });
});

test('REQ-46 IT_07 warning raised at exactly 80%, and only once', () => {
  assert.equal(decideAlerts(80, false, false).sendWarning, true);
  assert.equal(decideAlerts(80.8, true, false).sendWarning, false); // +₹50 later: no repeat
});

test('REQ-46 IT_08 over-budget raised at 100% or more, and only once', () => {
  const first = decideAlerts(101.7, true, false);
  assert.equal(first.sendOver, true);
  assert.equal(first.sendWarning, false);
  assert.equal(decideAlerts(102.5, true, true).sendOver, false);
});

test('REQ-46 jumping straight past 100% sends only the over-budget alert', () => {
  const r = decideAlerts(120, false, false);
  assert.equal(r.sendOver, true);
  assert.equal(r.sendWarning, false);
  assert.equal(r.markWarning, true); // the 80% warning will never arrive late
});
