/**
 * Budget period date maths (US-14, #35).
 *
 * All dates are handled as calendar days. A day is stored as midnight UTC of
 * that calendar date ("2026-10-21" -> 2026-10-21T00:00:00.000Z), and a period
 * end is stored as the last millisecond of its final day, so a transaction on
 * the last day of the period is inside it.
 *
 * "Today" is taken in APP_TIMEZONE (default Asia/Kolkata), so a budget does
 * not roll over at 05:30 IST when the UTC date changes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse "YYYY-MM-DD" into a UTC-midnight Date, or return null if invalid. */
export function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject impossible dates such as 2026-02-30.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

/** Format a Date as "YYYY-MM-DD" using its UTC calendar date. */
export function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in the app time zone, as a UTC-midnight Date. */
export function today(timeZone = process.env.APP_TIMEZONE || 'Asia/Kolkata', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseDateOnly(parts);
}

function endOfDay(dayStart) {
  return new Date(dayStart.getTime() + DAY_MS - 1);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Clamp a month-start day to 1..28 as the SRS data dictionary requires. */
function safeStartDay(startDay) {
  const n = Number(startDay);
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : 1;
}

/**
 * The monthly budget period that contains `date`, beginning on the user's
 * month start day (BR-14). With startDay 25, 2026-10-21 falls in
 * 2026-09-25 .. 2026-10-24.
 */
export function monthlyPeriod(date, startDay = 1) {
  const day = safeStartDay(startDay);
  let year = date.getUTCFullYear();
  let month = date.getUTCMonth();

  if (date.getUTCDate() < day) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }

  const start = new Date(Date.UTC(year, month, day));
  const nextStart = new Date(Date.UTC(year, month + 1, day));
  return { start, end: endOfDay(addDays(nextStart, -1)) };
}

/** A seven-day period starting on `date`. */
export function weeklyPeriod(date) {
  return { start: date, end: endOfDay(addDays(date, 6)) };
}

/** A custom period from `start` to `endDay` inclusive. */
export function customPeriod(start, endDay) {
  return { start, end: endOfDay(endDay) };
}

/** Whole days in a period, counting both ends. */
export function periodLength(period) {
  return Math.round((period.end.getTime() + 1 - period.start.getTime()) / DAY_MS);
}

/**
 * Days left in the period, counting today (REQ-45).
 * Before the period starts this is the full length; after it ends, 0.
 */
export function daysLeft(period, onDay) {
  if (onDay.getTime() < period.start.getTime()) return periodLength(period);
  if (onDay.getTime() > period.end.getTime()) return 0;
  return Math.round((period.end.getTime() + 1 - onDay.getTime()) / DAY_MS);
}

/** True when two periods share at least one day (REQ-44, BR-5). */
export function periodsOverlap(a, b) {
  return a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime();
}
