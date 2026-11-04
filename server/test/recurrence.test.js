import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dueCutoff, firstIndexOnOrAfter, occurrenceDate, upcomingDates, withinLimits,
} from '../src/utils/recurrence.js';

const d = (s) => new Date(`${s}T00:00:00.000Z`);
const iso = (date) => date.toISOString().slice(0, 10);
const series = (anchor, freq, n) => upcomingDates(d(anchor), freq, 0, n).map(iso);

// ---------------------------------------------------------------------------
// REQ-52: all five frequencies
// ---------------------------------------------------------------------------

test('REQ-52 daily: every day, across a month and year end', () => {
  assert.deepEqual(series('2026-12-30', 'daily', 4), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

test('REQ-52 weekly: every seven days', () => {
  assert.deepEqual(series('2026-11-04', 'weekly', 4), ['2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']);
});

test('REQ-52 monthly: same day each month', () => {
  assert.deepEqual(series('2026-10-01', 'monthly', 4), ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
});

test('REQ-52 quarterly: every three months', () => {
  assert.deepEqual(series('2026-01-15', 'quarterly', 5), ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15', '2027-01-15']);
});

test('REQ-52 yearly: same date each year', () => {
  assert.deepEqual(series('2026-03-10', 'yearly', 3), ['2026-03-10', '2027-03-10', '2028-03-10']);
});

// ---------------------------------------------------------------------------
// REQ-55: month ends and no JavaScript date rollover
// ---------------------------------------------------------------------------

test('REQ-55 monthly from 31 January: 28 Feb, 31 Mar, 30 Apr (no drift)', () => {
  assert.deepEqual(series('2026-01-31', 'monthly', 6), [
    '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
  ]);
});

test('REQ-55 monthly from 31 January in a leap year uses 29 February', () => {
  assert.deepEqual(series('2028-01-31', 'monthly', 3), ['2028-01-31', '2028-02-29', '2028-03-31']);
});

test('REQ-55 monthly from the 29th and 30th clamp only where needed', () => {
  assert.deepEqual(series('2026-01-29', 'monthly', 3), ['2026-01-29', '2026-02-28', '2026-03-29']);
  assert.deepEqual(series('2026-01-30', 'monthly', 3), ['2026-01-30', '2026-02-28', '2026-03-30']);
});

test('REQ-55 quarterly from 30 November: 28 Feb, 30 May, 30 Aug, 30 Nov', () => {
  assert.deepEqual(series('2026-11-30', 'quarterly', 5), [
    '2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30', '2027-11-30',
  ]);
});

test('REQ-55 quarterly from 31 August: 30 Nov, 28 Feb, 31 May', () => {
  assert.deepEqual(series('2026-08-31', 'quarterly', 4), ['2026-08-31', '2026-11-30', '2027-02-28', '2027-05-31']);
});

test('REQ-55 yearly from 29 February: 28 Feb in common years, 29 Feb again in leap years', () => {
  assert.deepEqual(series('2024-02-29', 'yearly', 5), [
    '2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29',
  ]);
});

test('REQ-55 a long run never rolls into the following month', () => {
  const dates = upcomingDates(d('2026-01-31'), 'monthly', 0, 48);
  dates.forEach((date, k) => {
    assert.equal(date.getUTCMonth(), (k) % 12, `occurrence ${k} stays in its own month`);
  });
});

test('occurrenceDate rejects bad input', () => {
  assert.throws(() => occurrenceDate(d('2026-01-01'), 'fortnightly', 1), RangeError);
  assert.throws(() => occurrenceDate(d('2026-01-01'), 'daily', -1), RangeError);
  assert.throws(() => occurrenceDate(d('2026-01-01'), 'daily', 1.5), RangeError);
  assert.throws(() => occurrenceDate('2026-01-01', 'daily', 1), TypeError);
});

// ---------------------------------------------------------------------------
// Resume / re-anchor: first occurrence on or after a day
// ---------------------------------------------------------------------------

test('firstIndexOnOrAfter finds the exact occurrence for every frequency', () => {
  for (const freq of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
    for (const anchor of ['2026-01-31', '2024-02-29', '2026-11-04']) {
      for (const target of ['2026-01-01', '2026-03-01', '2027-02-28', '2030-07-15']) {
        const a = d(anchor);
        const t = d(target);
        const k = firstIndexOnOrAfter(a, freq, t);
        assert.ok(occurrenceDate(a, freq, k).getTime() >= t.getTime(), `${freq} ${anchor}->${target}`);
        if (k > 0) assert.ok(occurrenceDate(a, freq, k - 1).getTime() < t.getTime(), `${freq} ${anchor}->${target} minimal`);
      }
    }
  }
});

test('firstIndexOnOrAfter returns 0 when the anchor is already in the future', () => {
  assert.equal(firstIndexOnOrAfter(d('2027-01-01'), 'monthly', d('2026-01-01')), 0);
});

test('firstIndexOnOrAfter counts a due date equal to the target', () => {
  assert.equal(iso(occurrenceDate(d('2026-01-31'), 'monthly', firstIndexOnOrAfter(d('2026-01-31'), 'monthly', d('2026-02-28')))), '2026-02-28');
});

// ---------------------------------------------------------------------------
// Limits (REQ-52)
// ---------------------------------------------------------------------------

test('withinLimits: end date is inclusive; count caps processed occurrences', () => {
  assert.equal(withinLimits({ date: d('2026-12-01'), endDate: d('2026-12-01') }), true);
  assert.equal(withinLimits({ date: d('2026-12-02'), endDate: d('2026-12-01') }), false);
  assert.equal(withinLimits({ date: d('2026-12-02'), occurrenceCount: 3, occurrencesDone: 2 }), true);
  assert.equal(withinLimits({ date: d('2026-12-02'), occurrenceCount: 3, occurrencesDone: 3 }), false);
  assert.equal(withinLimits({ date: d('2099-01-01') }), true, 'no limit at all');
});

// ---------------------------------------------------------------------------
// REQ-54: 00:05 IST
// ---------------------------------------------------------------------------

test('REQ-54 a pass at 00:04 IST does not yet process the day; 00:05 does', () => {
  // 00:04 IST on 4 Nov 2026 = 18:34 UTC on 3 Nov.
  assert.equal(iso(dueCutoff(new Date('2026-11-03T18:34:00Z'), 'Asia/Kolkata')), '2026-11-03');
  // 00:05 IST exactly.
  assert.equal(iso(dueCutoff(new Date('2026-11-03T18:35:00Z'), 'Asia/Kolkata')), '2026-11-04');
  assert.equal(iso(dueCutoff(new Date('2026-11-03T18:36:00Z'), 'Asia/Kolkata')), '2026-11-04');
});

test('REQ-54 the IST day, not the UTC day, decides what is due', () => {
  // 23:50 UTC on 3 Nov is already 05:20 IST on 4 Nov.
  assert.equal(iso(dueCutoff(new Date('2026-11-03T23:50:00Z'), 'Asia/Kolkata')), '2026-11-04');
  // 10:00 UTC on 3 Nov is 15:30 IST, still 3 Nov.
  assert.equal(iso(dueCutoff(new Date('2026-11-03T10:00:00Z'), 'Asia/Kolkata')), '2026-11-03');
});

test('REQ-54 the cutoff crosses month and year ends correctly', () => {
  assert.equal(iso(dueCutoff(new Date('2026-12-31T18:34:00Z'), 'Asia/Kolkata')), '2026-12-31');
  assert.equal(iso(dueCutoff(new Date('2026-12-31T18:35:00Z'), 'Asia/Kolkata')), '2027-01-01');
});
