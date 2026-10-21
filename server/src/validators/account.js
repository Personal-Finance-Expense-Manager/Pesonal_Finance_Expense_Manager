import Decimal from 'decimal.js';

/**
 * Validation for account input (US-06, #20).
 *
 * These are plain functions with no database access, so they can be unit
 * tested on their own (server/test/account-validation.test.js). Rules that
 * need the database - unique names (REQ-14) and "no transactions" before a
 * delete (REQ-18) - live in routes/accounts.js.
 */

// SRS REQ-13 lists exactly these four account types.
export const ACCOUNT_TYPES = ['cash', 'bank', 'credit_card', 'wallet'];

export const NAME_MAX_LENGTH = 60;

// Fields the user may change on an existing account (REQ-16).
const EDITABLE_FIELDS = ['name', 'type', 'currency', 'credit_limit', 'statement_due_day'];

// The current balance is derived, never typed in (REQ-16).
const READ_ONLY_FIELDS = ['balance', 'current_balance', 'opening_balance'];

/**
 * Check a money value: a number or numeric string, zero or more, with at
 * most two decimal places (REQ-15).
 *
 * Returns { value: '123.45' } on success or { error: '...' } on failure.
 */
export function parseAmount(raw, label) {
  if (raw === undefined || raw === null || raw === '') {
    return { error: `${label} is required.` };
  }

  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return { error: `${label} must be a number.` };
  }

  const text = String(raw).trim();

  // Plain decimal only: no exponents, no commas, no currency symbols.
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    return { error: `${label} must be a number, for example 2500 or 2500.50.` };
  }

  const amount = new Decimal(text);

  if (amount.decimalPlaces() > 2) {
    return { error: `${label} can have at most two decimal places.` };
  }

  if (amount.isNegative()) {
    return { error: `${label} cannot be negative.` };
  }

  if (amount.greaterThan('999999999999.99')) {
    return { error: `${label} is too large.` };
  }

  return { value: amount.toFixed(2) };
}

function checkName(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { error: 'Account name is required.' };
  }

  const name = raw.trim().replace(/\s+/g, ' ');

  if (name.length > NAME_MAX_LENGTH) {
    return { error: `Account name can be at most ${NAME_MAX_LENGTH} characters.` };
  }

  return { value: name };
}

function checkType(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'Account type is required.' };
  }

  if (!ACCOUNT_TYPES.includes(raw)) {
    return { error: 'Account type must be one of: Cash, Bank, Credit Card, Wallet.' };
  }

  return { value: raw };
}

/**
 * Day of the month a credit card statement is due (REQ-21): 1 to 31, or
 * empty for "not set". In short months the due date falls on the last day.
 */
export function parseDueDay(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const text = String(raw).trim();
  if (!/^\d{1,2}$/.test(text) || Number(text) < 1 || Number(text) > 31) {
    return { error: 'Statement due day must be a day of the month from 1 to 31.' };
  }
  return { value: Number(text) };
}

function checkCurrency(raw) {
  if (typeof raw !== 'string' || !/^[A-Za-z]{3}$/.test(raw.trim())) {
    return { error: 'Currency must be a three-letter code such as INR or USD.' };
  }

  return { value: raw.trim().toUpperCase() };
}

/**
 * Validate the body of POST /api/accounts (REQ-13, REQ-15).
 *
 * Returns { data } ready to save, or { errors: { field: message } }.
 */
export function validateNewAccount(body, defaultCurrency = 'INR') {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};
  const data = {};

  const name = checkName(input.name);
  if (name.error) errors.name = name.error;
  else data.name = name.value;

  const type = checkType(input.type);
  if (type.error) errors.type = type.error;
  else data.type = type.value;

  // For a credit card the opening balance is the amount already owed.
  const balanceLabel = data.type === 'credit_card'
    ? 'Outstanding amount'
    : 'Opening balance';
  const opening = parseAmount(
    input.opening_balance === undefined ? '0' : input.opening_balance,
    balanceLabel,
  );
  if (opening.error) errors.opening_balance = opening.error;
  else data.opening_balance = opening.value;

  const currency = checkCurrency(input.currency ?? defaultCurrency);
  if (currency.error) errors.currency = currency.error;
  else data.currency = currency.value;

  if (data.type === 'credit_card') {
    const limit = parseAmount(input.credit_limit ?? '0', 'Credit limit');
    if (limit.error) errors.credit_limit = limit.error;
    else data.credit_limit = limit.value;

    const dueDay = parseDueDay(input.statement_due_day);
    if (dueDay.error) errors.statement_due_day = dueDay.error;
    else data.statement_due_day = dueDay.value;
  } else {
    data.credit_limit = '0.00';
    data.statement_due_day = null;
  }

  return Object.keys(errors).length ? { errors } : { data };
}

/**
 * Validate the body of PATCH /api/accounts/:id (REQ-16).
 *
 * Only name, type, currency, credit limit and statement due day may change. Trying to set a
 * balance directly is rejected with an explanation rather than ignored.
 */
export function validateAccountUpdate(body, existingType) {
  const input = body && typeof body === 'object' ? body : {};
  const errors = {};
  const data = {};

  for (const field of READ_ONLY_FIELDS) {
    if (field in input) {
      errors[field] =
        'The balance cannot be edited directly. It is worked out from the ' +
        'opening balance and your transactions.';
    }
  }

  const unknown = Object.keys(input).filter(
    (key) => !EDITABLE_FIELDS.includes(key) && !READ_ONLY_FIELDS.includes(key),
  );
  for (const key of unknown) {
    errors[key] = 'This field cannot be changed.';
  }

  if ('name' in input) {
    const name = checkName(input.name);
    if (name.error) errors.name = name.error;
    else data.name = name.value;
  }

  if ('type' in input) {
    const type = checkType(input.type);
    if (type.error) errors.type = type.error;
    else data.type = type.value;
  }

  if ('currency' in input) {
    const currency = checkCurrency(input.currency);
    if (currency.error) errors.currency = currency.error;
    else data.currency = currency.value;
  }

  const finalType = data.type || existingType;

  if ('credit_limit' in input) {
    if (finalType !== 'credit_card') {
      errors.credit_limit = 'Only a credit card account has a credit limit.';
    } else {
      const limit = parseAmount(input.credit_limit, 'Credit limit');
      if (limit.error) errors.credit_limit = limit.error;
      else data.credit_limit = limit.value;
    }
  } else if (data.type && data.type !== 'credit_card') {
    // Moving away from credit card clears the limit and due day.
    data.credit_limit = '0.00';
    data.statement_due_day = null;
  }

  if ('statement_due_day' in input) {
    if (finalType !== 'credit_card') {
      errors.statement_due_day = 'Only a credit card account has a statement due date.';
    } else {
      const dueDay = parseDueDay(input.statement_due_day);
      if (dueDay.error) errors.statement_due_day = dueDay.error;
      else data.statement_due_day = dueDay.value;
    }
  }

  if (!Object.keys(errors).length && !Object.keys(data).length) {
    errors.body = 'Nothing to update. Send name, type, currency, credit_limit or statement_due_day.';
  }

  return Object.keys(errors).length ? { errors } : { data };
}
