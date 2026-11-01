import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apportionPercentages, trendMonths } from '../src/services/chartsService.js';

// ---------------------------------------------------------------------------
// REQ-70: the breakdown's percentages must sum to exactly 100
// ---------------------------------------------------------------------------

function sum(values) {
  // Percentages carry one decimal place, so add them as tenths to keep the
  // assertion free of binary floating-point noise.
  return values.reduce((total, value) => total + Math.round(value * 10), 0) / 10;
}

test('REQ-70 an even split still sums to exactly 100', () => {
  // Three equal thirds each round to 33.3 and would total 99.9.
  const shares = apportionPercentages(['100.00', '100.00', '100.00'], '300.00');
  assert.equal(sum(shares), 100);
});

test('REQ-70 an awkward split sums to exactly 100', () => {
  const shares = apportionPercentages(['1.00', '1.00', '1.00', '1.00', '1.00', '1.00', '1.00'], '7.00');
  assert.equal(sum(shares), 100);
});

test('REQ-70 a split that would overshoot is brought back to 100', () => {
  const shares = apportionPercentages(['16.67', '16.67', '16.66', '16.67', '16.67', '16.66'], '100.00');
  assert.equal(sum(shares), 100);
});

test('REQ-70 every share stays within a tenth of its true value', () => {
  const amounts = ['512.45', '331.10', '98.20', '41.75', '16.50'];
  const total = '1000.00';
  const shares = apportionPercentages(amounts, total);

  shares.forEach((share, index) => {
    const exact = (Number(amounts[index]) / Number(total)) * 100;
    assert.ok(
      Math.abs(share - exact) <= 0.1,
      `${share} is more than a tenth away from ${exact}`
    );
  });
});

test('REQ-70 a single category takes the whole hundred', () => {
  assert.deepEqual(apportionPercentages(['250.00'], '250.00'), [100]);
});

test('REQ-70 the leftover tenth goes to the largest slice', () => {
  // 2/3 and 1/3 are 66.7 and 33.3, which already total 100; shifting the
  // amounts makes the remainder decide, and the larger slice must take it.
  const shares = apportionPercentages(['200.00', '100.00'], '300.00');
  assert.equal(sum(shares), 100);
  assert.ok(shares[0] > shares[1]);
});

test('REQ-70 a period with no spending does not divide by zero', () => {
  assert.deepEqual(apportionPercentages(['0.00', '0.00'], '0.00'), [0, 0]);
});

test('REQ-70 no categories gives no shares', () => {
  assert.deepEqual(apportionPercentages([], '0.00'), []);
});

// ---------------------------------------------------------------------------
// REQ-71: the trend covers the last six or twelve months, oldest first
// ---------------------------------------------------------------------------

test('REQ-71 six months ends with the selected month', () => {
  const months = trendMonths(new Date(Date.UTC(2026, 9, 31)), 6);
  assert.equal(months.length, 6);
  assert.equal(months[5].key, '2026-10');
});

test('REQ-71 twelve months ends with the selected month', () => {
  const months = trendMonths(new Date(Date.UTC(2026, 9, 31)), 12);
  assert.equal(months.length, 12);
  assert.equal(months[11].key, '2026-10');
});

test('REQ-71 the window runs oldest first', () => {
  const months = trendMonths(new Date(Date.UTC(2026, 9, 31)), 6);
  assert.deepEqual(
    months.map((m) => m.key),
    ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
  );
});

test('REQ-71 the window crosses a year boundary correctly', () => {
  const months = trendMonths(new Date(Date.UTC(2026, 1, 28)), 6);
  assert.deepEqual(
    months.map((m) => m.key),
    ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']
  );
});

test('REQ-71 each month carries its own first and last day', () => {
  const [january] = trendMonths(new Date(Date.UTC(2026, 0, 31)), 1);
  assert.equal(january.start.toISOString().slice(0, 10), '2026-01-01');
  assert.equal(january.end.toISOString().slice(0, 10), '2026-01-31');
});

test('REQ-71 February in a leap year ends on the 29th', () => {
  const [february] = trendMonths(new Date(Date.UTC(2028, 1, 15)), 1);
  assert.equal(february.end.toISOString().slice(0, 10), '2028-02-29');
});
