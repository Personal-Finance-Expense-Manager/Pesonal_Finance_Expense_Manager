import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransactionInput } from '../src/validators/transaction.js';

const validInput = {
  type: 'expense',
  amount: '10.25',
  transaction_date: '2026-10-21',
  account_id: '507f1f77bcf86cd799439011',
};

test('accepts a valid expense', () => {
  const { data, errors } = validateTransactionInput(validInput);
  assert.equal(errors, undefined);
  assert.equal(data.amount, '10.25');
  assert.equal(data.type, 'expense');
});

test('accepts a valid income', () => {
  const { data, errors } = validateTransactionInput({
    ...validInput,
    type: 'income',
  });
  assert.equal(errors, undefined);
  assert.equal(data.type, 'income');
});

test('accepts a valid transfer between different accounts', () => {
  const { data, errors } = validateTransactionInput({
    type: 'transfer',
    amount: '25.50',
    transaction_date: '2026-10-21',
    from_account_id: '507f1f77bcf86cd799439011',
    to_account_id: '507f1f77bcf86cd799439012',
    note: 'Moving savings',
  });
  assert.equal(errors, undefined);
  assert.equal(data.type, 'transfer');
  assert.equal(data.amount, '25.50');
});

test('rejects transfers between the same account', () => {
  const { errors } = validateTransactionInput({
    type: 'transfer',
    amount: '25',
    transaction_date: '2026-10-21',
    from_account_id: '507f1f77bcf86cd799439011',
    to_account_id: '507f1f77bcf86cd799439011',
  });
  assert.ok(errors.to_account_id);
});

test('rejects invalid amounts with the required message', () => {
  for (const amount of ['0', '-1', '1.234', 'abc']) {
    const { errors } = validateTransactionInput({ ...validInput, amount });
    assert.equal(
      errors.amount,
      'Enter an amount greater than 0 with up to 2 decimal places.',
    );
  }
});

test('rejects dates more than one day in the future', () => {
  const { errors } = validateTransactionInput({
    ...validInput,
    transaction_date: '2099-01-01',
  });
  assert.match(errors.transaction_date, /future/);
});

test('enforces note and tag limits', () => {
  assert.ok(
    validateTransactionInput({
      ...validInput,
      note: 'x'.repeat(201),
    }).errors.note,
  );

  assert.ok(
    validateTransactionInput({
      ...validInput,
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    }).errors.tags,
  );

  assert.ok(
    validateTransactionInput({
      ...validInput,
      tags: ['x'.repeat(21)],
    }).errors.tags,
  );
});

test('rejects unsupported transaction types', () => {
  const { errors } = validateTransactionInput({
    ...validInput,
    type: 'refund',
  });
  assert.ok(errors.type);
});
