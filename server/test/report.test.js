import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysInPeriod,
  difference,
  projectTotal,
  reportToCsvRows,
} from '../src/services/reportService.js';

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

// ---------------------------------------------------------------------------
// REQ-73: a report covers exactly the range it is given
// ---------------------------------------------------------------------------

test('REQ-73 an inclusive range counts both end days', () => {
  assert.equal(daysInPeriod(day('2026-10-01'), day('2026-10-31')), 31);
});

test('REQ-73 a single day is one day, not zero', () => {
  assert.equal(daysInPeriod(day('2026-10-15'), day('2026-10-15')), 1);
});

test('REQ-73 a range across a month boundary is counted correctly', () => {
  assert.equal(daysInPeriod(day('2026-01-30'), day('2026-02-02')), 4);
});

// ---------------------------------------------------------------------------
// REQ-75: differences in money and percent, increases told from decreases
// ---------------------------------------------------------------------------

test('REQ-75 a rise is reported as up, with both figures', () => {
  const change = difference('1200.00', '1000.00');
  assert.equal(change.amount, '200.00');
  assert.equal(change.percent, 20);
  assert.equal(change.direction, 'up');
});

test('REQ-75 a fall is reported as down, with a negative amount', () => {
  const change = difference('800.00', '1000.00');
  assert.equal(change.amount, '-200.00');
  assert.equal(change.percent, -20);
  assert.equal(change.direction, 'down');
});

test('REQ-75 no change is reported as same', () => {
  const change = difference('500.00', '500.00');
  assert.equal(change.amount, '0.00');
  assert.equal(change.percent, 0);
  assert.equal(change.direction, 'same');
});

test('REQ-75 growth from nothing has no percentage rather than infinity', () => {
  const change = difference('750.00', '0.00');
  assert.equal(change.amount, '750.00');
  assert.equal(change.percent, null);
  assert.equal(change.direction, 'up');
});

test('REQ-75 a category that stopped being used falls to zero', () => {
  const change = difference('0.00', '430.00');
  assert.equal(change.amount, '-430.00');
  assert.equal(change.percent, -100);
  assert.equal(change.direction, 'down');
});

test('REQ-75 money keeps two decimal places (BR-4)', () => {
  assert.equal(difference('100.005', '0.00').amount, '100.01');
  assert.equal(difference('33.333', '0.00').amount, '33.33');
});

test('REQ-75 percentages are rounded to one decimal place', () => {
  assert.equal(difference('1000.00', '333.00').percent, 200.3);
});

// ---------------------------------------------------------------------------
// REQ-76: average daily spend and the projected period total
// ---------------------------------------------------------------------------

test('REQ-76 a finished period projects its actual total', () => {
  const projection = projectTotal('3100.00', day('2026-09-01'), day('2026-09-30'), day('2026-10-15'));
  assert.equal(projection.is_complete, true);
  assert.equal(projection.projected_total, '3100.00');
  assert.equal(projection.total_days, 30);
});

test('REQ-76 a running period divides by the days so far, not the whole period', () => {
  // 1000 over the first 10 days of a 31-day month is 100 a day.
  const projection = projectTotal('1000.00', day('2026-10-01'), day('2026-10-31'), day('2026-10-10'));
  assert.equal(projection.is_complete, false);
  assert.equal(projection.elapsed_days, 10);
  assert.equal(projection.average_daily_spend, '100.00');
  assert.equal(projection.projected_total, '3100.00');
});

test('REQ-76 the projection does not fall as the period goes on at a steady rate', () => {
  const early = projectTotal('500.00', day('2026-10-01'), day('2026-10-31'), day('2026-10-05'));
  const later = projectTotal('2000.00', day('2026-10-01'), day('2026-10-31'), day('2026-10-20'));
  assert.equal(early.projected_total, '3100.00');
  assert.equal(later.projected_total, '3100.00');
});

test('REQ-76 the first day of a period does not divide by zero', () => {
  const projection = projectTotal('250.00', day('2026-10-01'), day('2026-10-31'), day('2026-10-01'));
  assert.equal(projection.elapsed_days, 1);
  assert.equal(projection.average_daily_spend, '250.00');
  assert.equal(projection.projected_total, '7750.00');
});

test('REQ-76 a period with no spending projects nothing, not an error', () => {
  const projection = projectTotal('0.00', day('2026-10-01'), day('2026-10-31'), day('2026-10-10'));
  assert.equal(projection.average_daily_spend, '0.00');
  assert.equal(projection.projected_total, '0.00');
});

test('REQ-76 elapsed days never exceed the period length', () => {
  const projection = projectTotal('900.00', day('2026-10-01'), day('2026-10-31'), day('2027-01-01'));
  assert.equal(projection.elapsed_days, 31);
  assert.equal(projection.is_complete, true);
});

// ---------------------------------------------------------------------------
// REQ-77: the export carries exactly the figures that were displayed
// ---------------------------------------------------------------------------

const plainReport = {
  total_expense: '1500.00',
  transaction_count: 3,
  by_category: [
    { name: 'Rent', amount: '1000.00', share_percent: 66.7, transaction_count: 1 },
    { name: 'Food', amount: '500.00', share_percent: 33.3, transaction_count: 2 },
  ],
};

test('REQ-77 the CSV header names every column', () => {
  const [header] = reportToCsvRows(plainReport);
  assert.deepEqual(header, ['category', 'amount', 'share_percent', 'transaction_count']);
});

test('REQ-77 the CSV rows carry the displayed figures unchanged', () => {
  const [, rent, food] = reportToCsvRows(plainReport);
  assert.deepEqual(rent, ['Rent', '1000.00', 66.7, 1]);
  assert.deepEqual(food, ['Food', '500.00', 33.3, 2]);
});

test('REQ-77 a comparison adds the previous figures and the change', () => {
  const comparing = {
    ...plainReport,
    compare: { total_expense: '1200.00' },
    by_category: [
      {
        name: 'Rent',
        amount: '1000.00',
        share_percent: 66.7,
        transaction_count: 1,
        previous_amount: '800.00',
        change: { amount: '200.00', percent: 25, direction: 'up' },
      },
    ],
  };

  const [header, row] = reportToCsvRows(comparing);
  assert.ok(header.includes('previous_amount'));
  assert.ok(header.includes('direction'));
  assert.deepEqual(row, ['Rent', '1000.00', 66.7, 1, '800.00', '200.00', 25, 'up']);
});

test('REQ-77 an unmeasurable percentage exports as blank, not as null', () => {
  const comparing = {
    ...plainReport,
    compare: { total_expense: '0.00' },
    by_category: [
      {
        name: 'Rent',
        amount: '1000.00',
        share_percent: 100,
        transaction_count: 1,
        previous_amount: '0.00',
        change: { amount: '1000.00', percent: null, direction: 'up' },
      },
    ],
  };

  const [, row] = reportToCsvRows(comparing);
  assert.equal(row[6], '');
});

test('REQ-74 a report with no categories still exports a header', () => {
  const rows = reportToCsvRows({ ...plainReport, by_category: [] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ['category', 'amount', 'share_percent', 'transaction_count']);
});
