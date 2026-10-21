
import Decimal from 'decimal.js';
import mongoose from 'mongoose';

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});

function parseMoney(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Money must be provided as a non-empty string.');
  }

  let amount;

  try {
    amount = new Decimal(value.trim());
  } catch {
    throw new TypeError('Money must be a valid decimal value.');
  }

  if (!amount.isFinite()) {
    throw new TypeError('Money must be a finite decimal value.');
  }

  return amount;
}

export function money(value) {
  return parseMoney(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function toDecimal128(value) {
  return mongoose.Types.Decimal128.fromString(money(value).toFixed(2));
}

export function moneyString(value) {
  return money(value).toFixed(2);
}

export function hasAtMostTwoDecimalPlaces(value) {
  if (value == null) return true;

  try {
    const amount = new Decimal(value.toString());
    return amount.isFinite() && amount.decimalPlaces() <= 2;
  } catch {
    return false;
  }
}

export function isPositiveMoney(value) {
  if (value == null) return false;

  try {
    const amount = new Decimal(value.toString());

    return (
      amount.isFinite() &&
      amount.greaterThan(0) &&
      amount.decimalPlaces() <= 2
    );
  } catch {
    return false;
  }
}

export function isNonNegativeMoney(value) {
  if (value == null) return false;

  try {
    const amount = new Decimal(value.toString());

    return (
      amount.isFinite() &&
      amount.greaterThanOrEqualTo(0) &&
      amount.decimalPlaces() <= 2
    );
  } catch {
    return false;
  }
}
export function isPositiveDecimal(value) {
  if (value == null) return false;

  try {
    const amount = new Decimal(value.toString());

    return amount.isFinite() && amount.greaterThan(0);
  } catch {
    return false;
  }
}