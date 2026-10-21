import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount,
  validateNewAccount,
  validateAccountUpdate,
} from '../src/validators/account.js';

// ---------------------------------------------------------------------------
// REQ-13: name and type are mandatory; type is one of the four SRS types
// ---------------------------------------------------------------------------

test('REQ-13 creates a valid bank account', () => {
  const { data, errors } = validateNewAccount({
    name: '  HDFC   Savings ',
    type: 'bank',
    opening_balance: '2500.50',
    currency: 'inr',
  });
  assert.equal(errors, undefined);
  assert.deepEqual(data, {
    name: 'HDFC Savings',
    type: 'bank',
    opening_balance: '2500.50',
    currency: 'INR',
    credit_limit: '0.00',
    statement_due_day: null,
  });
});

test('REQ-13 rejects a missing name and a missing type', () => {
  const { errors } = validateNewAccount({ opening_balance: '10' });
  assert.match(errors.name, /required/);
  assert.match(errors.type, /required/);
});

test('REQ-13 rejects a type outside Cash, Bank, Credit Card, Wallet', () => {
  const { errors } = validateNewAccount({ name: 'Stocks', type: 'investment' });
  assert.match(errors.type, /Cash, Bank, Credit Card, Wallet/);
});

test('REQ-13 defaults currency to the user base currency', () => {
  const { data } = validateNewAccount({ name: 'Cash', type: 'cash' }, 'USD');
  assert.equal(data.currency, 'USD');
  assert.equal(data.opening_balance, '0.00');
});

// ---------------------------------------------------------------------------
// REQ-15: opening balance zero or more, numeric, at most two decimals
// ---------------------------------------------------------------------------

test('REQ-15 accepts zero and whole numbers', () => {
  assert.deepEqual(parseAmount('0', 'Opening balance'), { value: '0.00' });
  assert.deepEqual(parseAmount(1500, 'Opening balance'), { value: '1500.00' });
});

test('REQ-15 rejects non-numeric values', () => {
  for (const bad of ['abc', '12abc', '1,000', '1e5', '₹100', '']) {
    assert.ok(parseAmount(bad, 'Opening balance').error, `expected "${bad}" to fail`);
  }
});

test('REQ-15 rejects more than two decimal places', () => {
  assert.match(parseAmount('10.123', 'Opening balance').error, /two decimal/);
});

test('REQ-15 rejects a negative opening balance', () => {
  assert.match(parseAmount('-5', 'Opening balance').error, /negative/);
});

test('REQ-15 credit card opening balance is the outstanding amount', () => {
  const { errors } = validateNewAccount({
    name: 'Visa',
    type: 'credit_card',
    opening_balance: 'oops',
  });
  assert.match(errors.opening_balance, /^Outstanding amount/);
});

test('REQ-15 credit card keeps its credit limit, other types do not', () => {
  const card = validateNewAccount({
    name: 'Visa', type: 'credit_card', opening_balance: '1200', credit_limit: '50000',
  });
  assert.equal(card.data.credit_limit, '50000.00');

  const wallet = validateNewAccount({
    name: 'Paytm', type: 'wallet', credit_limit: '50000',
  });
  assert.equal(wallet.data.credit_limit, '0.00');
});

// ---------------------------------------------------------------------------
// REQ-16: edit name, type, currency, credit limit - never the balance
// ---------------------------------------------------------------------------

test('REQ-16 allows editing the name and currency', () => {
  const { data, errors } = validateAccountUpdate(
    { name: 'Main Bank', currency: 'usd' },
    'bank',
  );
  assert.equal(errors, undefined);
  assert.deepEqual(data, { name: 'Main Bank', currency: 'USD' });
});

test('REQ-16 refuses to edit the balance directly', () => {
  for (const field of ['balance', 'current_balance', 'opening_balance']) {
    const { errors } = validateAccountUpdate({ [field]: '999' }, 'bank');
    assert.match(errors[field], /cannot be edited directly/);
  }
});

test('REQ-16 refuses unknown fields such as user_id', () => {
  const { errors } = validateAccountUpdate({ user_id: 'someone-else' }, 'bank');
  assert.ok(errors.user_id);
});

test('REQ-16 credit limit only applies to credit cards', () => {
  assert.ok(validateAccountUpdate({ credit_limit: '100' }, 'bank').errors.credit_limit);
  assert.equal(
    validateAccountUpdate({ credit_limit: '100' }, 'credit_card').data.credit_limit,
    '100.00',
  );
});

test('REQ-16 changing a card to another type clears its limit', () => {
  const { data } = validateAccountUpdate({ type: 'bank' }, 'credit_card');
  assert.equal(data.credit_limit, '0.00');
});

test('REQ-16 an empty update is rejected', () => {
  assert.ok(validateAccountUpdate({}, 'bank').errors.body);
});

// ---------------------------------------------------------------------------
// REQ-21: statement due day for credit cards (US-07)
// ---------------------------------------------------------------------------

test('REQ-21 credit card keeps a statement due day, other types do not', () => {
  const card = validateNewAccount({
    name: 'Visa', type: 'credit_card', credit_limit: '100000', statement_due_day: '5',
  });
  assert.equal(card.data.statement_due_day, 5);

  const bank = validateNewAccount({ name: 'HDFC', type: 'bank', statement_due_day: 5 });
  assert.equal(bank.data.statement_due_day, null);
});

test('REQ-21 statement due day must be 1 to 31', () => {
  for (const bad of ['0', '32', 'abc', '5.5']) {
    const { errors } = validateNewAccount({
      name: 'Visa', type: 'credit_card', statement_due_day: bad,
    });
    assert.ok(errors.statement_due_day, `expected "${bad}" to fail`);
  }
});

test('REQ-21 statement due day can be edited on a card only', () => {
  assert.equal(validateAccountUpdate({ statement_due_day: 20 }, 'credit_card').data.statement_due_day, 20);
  assert.ok(validateAccountUpdate({ statement_due_day: 20 }, 'bank').errors.statement_due_day);
});
