/**
 * Recurring schedule maths - US-16 (#43), REQ-55.
 *
 * Every date is a calendar day held as UTC midnight (see utils/period.js).
 * Occurrence k is computed from the ANCHOR date, never from the previous
 * occurrence, and the day of month is clamped to the length of the target
 * month. So a rule anchored on 31 January runs
 *   31 Jan -> 28/29 Feb -> 31 Mar -> 30 Apr
 * and does not drift to the 28th after February. Nothing here uses
 * Date(year, month + 1, 31) style construction, which would roll over into the
 * next month.
 */

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS_PER_STEP = { monthly: 1, quarterly: 3, yearly: 12 };

function daysInMonth(year, month) {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The date of occurrence `k` (0 = the anchor itself) of a schedule. */
export function occurrenceDate(anchor, frequency, k) {
  if (!(anchor instanceof Date) || Number.isNaN(anchor.getTime())) {
    throw new TypeError('anchor must be a valid Date.');
  }
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError('k must be a non-negative integer.');
  }

  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const d = anchor.getUTCDate();

  if (frequency === 'daily') return new Date(Date.UTC(y, m, d + k));
  if (frequency === 'weekly') return new Date(Date.UTC(y, m, d + 7 * k));

  const step = MONTHS_PER_STEP[frequency];
  if (!step) throw new RangeError(`Unsupported frequency: ${frequency}`);

  const totalMonths = m + step * k;
  const year = y + Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  return new Date(Date.UTC(year, month, Math.min(d, daysInMonth(year, month))));
}

/**
 * The smallest index k whose occurrence falls on or after `onOrAfter`.
 * Used when a rule is resumed or re-anchored, so nothing before that day is
 * back-filled.
 */
export function firstIndexOnOrAfter(anchor, frequency, onOrAfter) {
  const target = onOrAfter.getTime();
  if (anchor.getTime() >= target) return 0;

  // Start from a lower bound estimate, then step forward; the schedule is
  // monotonic so this always lands on the exact index.
  let k;
  if (frequency === 'daily') k = Math.floor((target - anchor.getTime()) / DAY_MS);
  else if (frequency === 'weekly') k = Math.floor((target - anchor.getTime()) / (7 * DAY_MS));
  else {
    const months = (onOrAfter.getUTCFullYear() - anchor.getUTCFullYear()) * 12
      + (onOrAfter.getUTCMonth() - anchor.getUTCMonth());
    k = Math.max(0, Math.floor(months / MONTHS_PER_STEP[frequency]) - 1);
  }

  while (occurrenceDate(anchor, frequency, k).getTime() < target) k += 1;
  return k;
}

/**
 * Whether the occurrence at index `k` is still inside the rule's limits.
 * `occurrencesDone` is the number already processed in the rule's life.
 */
export function withinLimits({ date, endDate = null, occurrenceCount = null, occurrencesDone = 0 }) {
  if (endDate && date.getTime() > endDate.getTime()) return false;
  if (occurrenceCount != null && occurrencesDone >= occurrenceCount) return false;
  return true;
}

/**
 * The latest due date the scheduler may process at `now`.
 *
 * Occurrences become due at 00:05 in the app time zone (REQ-54). Before 00:05
 * the current day is not yet due, so the cutoff is yesterday.
 */
export function dueCutoff(now = new Date(), timeZone = process.env.APP_TIMEZONE || 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);

  const day = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
  const minutes = get('hour') * 60 + get('minute');
  return minutes >= 5 ? day : new Date(day.getTime() - DAY_MS);
}

/** Upcoming occurrence dates, for previews. */
export function upcomingDates(anchor, frequency, fromIndex, count) {
  return Array.from({ length: count }, (_, i) => occurrenceDate(anchor, frequency, fromIndex + i));
}
