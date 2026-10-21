import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import {
  parseDateOnly,
  monthlyPeriod,
  weeklyPeriod,
  customPeriod,
  periodLength,
} from '../utils/period.js';

/**
 * Validation for a new budget (US-14, #35, REQ-43).
 *
 * Pure function - no database access - so it is unit tested in
 * server/test/budget-validation.test.js. The overlap rule (REQ-44) and the
 * "category must exist" check need the database and live in the route.
 */

// REQ-43 names weekly, monthly and custom. The model also allows "yearly",
// which the SRS does not ask for, so the API does not accept it.
export const PERIOD_TYPES = ['weekly', 'monthly', 'custom'];

const MAX_CUSTOM_DAYS = 366;

function parseBudgetAmount(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'Budget amount is required.' };
  }
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return { error: 'Budget amount must be a number.' };
  }
  const text = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return { error: 'Budget amount must be a number, for example 6000 or 6000.50.' };
  }
  const amount = new Decimal(text);
  if (amount.decimalPlaces() > 2) {
    return { error: 'Budget amount can have at most two decimal places.' };
  }
  if (amount.lessThanOrEqualTo(0)) {
    return { error: 'Budget amount must be greater than zero.' };
  }
  if (amount.greaterThan('999999999999.99')) {
    return { error: 'Budget amount is too large.' };
  }
  return { value: amount.toFixed(2) };
}

/**
 * @param body          request body
 * @param options.today UTC-midnight Date for "today" (used when no start is given)
 * @param options.monthStartDay the user's month start day (BR-14)
 * @returns { data } or { errors: { field: message } }
 */
export function validateNewBudget(body, { today, monthStartDay = 1 }) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};
  const data = {};

  // Category: an id, or null / "" / "overall" for overall spending.
  const rawCategory = input.category_id;
  if (rawCategory === undefined || rawCategory === null || rawCategory === '' || rawCategory === 'overall') {
    data.category_id = null;
  } else if (typeof rawCategory === 'string' && mongoose.isValidObjectId(rawCategory)) {
    data.category_id = rawCategory;
  } else {
    errors.category_id = 'Choose a category, or "Overall spending".';
  }

  const amount = parseBudgetAmount(input.amount);
  if (amount.error) errors.amount = amount.error;
  else data.amount = amount.value;

  if (!PERIOD_TYPES.includes(input.period_type)) {
    errors.period_type = 'Period must be weekly, monthly or custom.';
  } else {
    data.period_type = input.period_type;
  }

  let start = today;
  if (input.period_start !== undefined && input.period_start !== '') {
    start = parseDateOnly(input.period_start);
    if (!start) errors.period_start = 'Start date must be a valid date (YYYY-MM-DD).';
  } else if (data.period_type === 'custom') {
    errors.period_start = 'A custom period needs a start date.';
    start = null;
  }

  if (start && data.period_type) {
    let period;
    if (data.period_type === 'monthly') {
      period = monthlyPeriod(start, monthStartDay);
    } else if (data.period_type === 'weekly') {
      period = weeklyPeriod(start);
    } else {
      const endDay = parseDateOnly(input.period_end);
      if (!endDay) {
        errors.period_end = 'A custom period needs a valid end date (YYYY-MM-DD).';
      } else if (endDay.getTime() < start.getTime()) {
        errors.period_end = 'End date must be on or after the start date.';
      } else {
        period = customPeriod(start, endDay);
        if (periodLength(period) > MAX_CUSTOM_DAYS) {
          errors.period_end = 'A custom period can be at most one year long.';
          period = null;
        }
      }
    }
    if (period) {
      data.period_start = period.start;
      data.period_end = period.end;
    }
  }

  return Object.keys(errors).length ? { errors } : { data };
}
