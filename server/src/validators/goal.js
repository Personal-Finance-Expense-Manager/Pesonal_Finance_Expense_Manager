import Decimal from 'decimal.js';
import mongoose from 'mongoose';
import { parseDateOnly, today } from '../utils/period.js';

function parseTargetAmount(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'Target amount is required.' };
  }

  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return { error: 'Target amount must be a number.' };
  }

  const text = String(raw).trim();

  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { error: 'Target amount must be a valid positive number.' };
  }

  const amount = new Decimal(text);

  if (amount.decimalPlaces() > 2) {
    return { error: 'Target amount can have at most two decimal places.' };
  }

  if (amount.lessThanOrEqualTo(0)) {
    return { error: 'Target amount must be greater than zero.' };
  }

  if (amount.greaterThan('999999999999.99')) {
    return { error: 'Target amount is too large.' };
  }

  return { value: amount.toFixed(2) };
}

export function validateNewGoal(body, { onDay = today() } = {}) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};
  const data = {};

  // Goal name
  if (typeof input.name !== 'string' || !input.name.trim()) {
    errors.name = 'Goal name is required.';
  } else if (input.name.trim().length > 120) {
    errors.name = 'Goal name cannot exceed 120 characters.';
  } else {
    data.name = input.name.trim();
  }

  // Target amount
  const amount = parseTargetAmount(input.target_amount);

  if (amount.error) {
    errors.target_amount = amount.error;
  } else {
    data.target_amount = amount.value;
  }

  // Target date must be a valid future calendar date.
  const targetDate = parseDateOnly(input.target_date);

  if (!targetDate) {
    errors.target_date = 'Enter a valid target date (YYYY-MM-DD).';
  } else if (targetDate.getTime() <= onDay.getTime()) {
    errors.target_date = 'Target date must be in the future.';
  } else {
    data.target_date = targetDate;
  }

  // Optional linked account.
  const accountId = input.linked_account_id;

  if (accountId === undefined || accountId === null || accountId === '') {
    data.linked_account_id = null;
  } else if (
    typeof accountId === 'string' &&
    mongoose.isValidObjectId(accountId)
  ) {
    data.linked_account_id = accountId;
  } else {
    errors.linked_account_id = 'Select a valid account.';
  }

  return Object.keys(errors).length ? { errors } : { data };
}