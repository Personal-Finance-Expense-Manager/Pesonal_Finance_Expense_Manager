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

test('tags that differ only by case are treated as one tag, keeping the first spelling', () => {
  const { data, errors } = validateTransactionInput({ ...validInput, tags: ['Food', 'food', ' FOOD ', 'trip'] });
  assert.equal(errors, undefined);
  assert.deepEqual(data.tags, ['Food', 'trip']);
});

// ---- Edit mode (US-09, REQ-28): allowPartial + currentType -------------------

const edit = (body, currentType = 'expense') =>
  validateTransactionInput(body, { allowPartial: true, currentType });

test('edit: only the fields sent are validated and returned', () => {
  const { data, errors } = edit({ amount: '800' });
  assert.equal(errors, undefined);
  assert.deepEqual(data, { amount: '800.00' });
});

test('edit: an empty body is rejected', () => {
  assert.equal(edit({}).errors.body, 'Provide at least one field to update.');
});

test('edit: fields are checked against the stored type even when type is not repeated', () => {
  // Without currentType these used to be silently ignored.
  assert.ok(edit({ account_id: 'nope' }).errors.account_id);
  assert.ok(edit({ category_id: 'nope' }).errors.category_id);
  assert.ok(edit({ payment_mode: 'bitcoin' }).errors.payment_mode);
  assert.ok(edit({ tags: 'food' }).errors.tags);
  assert.deepEqual(edit({ tags: [] }).data, { tags: [] });
  assert.deepEqual(edit({ category_id: null }).data, { category_id: null });
});

test('edit: an income or expense rejects transfer-only fields', () => {
  assert.ok(edit({ from_account_id: '507f1f77bcf86cd799439011' }).errors.from_account_id);
  assert.ok(edit({ to_account_id: '507f1f77bcf86cd799439011' }).errors.to_account_id);
});

test('edit: a transfer rejects income/expense-only fields and checks its accounts', () => {
  assert.ok(edit({ account_id: '507f1f77bcf86cd799439011' }, 'transfer').errors.account_id);
  assert.ok(edit({ category_id: null }, 'transfer').errors.category_id);
  assert.ok(edit({ payment_mode: 'cash' }, 'transfer').errors.payment_mode);
  assert.ok(edit({ tags: [] }, 'transfer').errors.tags);
  assert.ok(edit({ to_account_id: 'nope' }, 'transfer').errors.to_account_id);
  assert.deepEqual(
    edit({ to_account_id: '507f1f77bcf86cd799439012', note: 'x' }, 'transfer').data,
    { to_account_id: '507f1f77bcf86cd799439012', note: 'x' },
  );
});

test('edit: amount, date and note rules are the same as when recording (REQ-25, REQ-26, REQ-27)', () => {
  for (const amount of ['0', '-1', 'abc', '1.234', '']) {
    assert.equal(edit({ amount }).errors.amount, 'Enter an amount greater than 0 with up to 2 decimal places.', amount);
  }
  assert.ok(edit({ transaction_date: '2999-01-01' }).errors.transaction_date);
  assert.ok(edit({ transaction_date: 'yesterday' }).errors.transaction_date);
  assert.ok(edit({ note: 'x'.repeat(201) }).errors.note);
  assert.ok(edit({ user_id: 'abc' }).errors.user_id);
});

test('recording (not partial) behaves exactly as before: required fields are still required', () => {
  const { errors } = validateTransactionInput({ type: 'expense' });
  assert.ok(errors.amount && errors.transaction_date && errors.account_id);
});
