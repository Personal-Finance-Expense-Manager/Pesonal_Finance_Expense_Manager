import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { validateNewGoal } from '../src/validators/goal.js';
import { parseDateOnly } from '../src/utils/period.js';

const TODAY = parseDateOnly('2026-11-04');

const validGoal = {
  name: 'New Bike',
  target_amount: '100000',
  target_date: '2027-06-30',
};

test('valid goal data is accepted', () => {
  const result = validateNewGoal(validGoal, { onDay: TODAY });

  assert.ok(result.data);
  assert.equal(result.data.name, 'New Bike');
  assert.equal(result.data.target_amount, '100000.00');
  assert.equal(result.data.linked_account_id, null);
});

test('goal name is required', () => {
  const result = validateNewGoal(
    { ...validGoal, name: '   ' },
    { onDay: TODAY },
  );

  assert.equal(result.errors.name, 'Goal name is required.');
});

test('goal name cannot exceed 120 characters', () => {
  const result = validateNewGoal(
    { ...validGoal, name: 'A'.repeat(121) },
    { onDay: TODAY },
  );

  assert.ok(result.errors.name);
});

test('target amount must be positive', () => {
  for (const amount of ['0', '-100', 'abc']) {
    const result = validateNewGoal(
      { ...validGoal, target_amount: amount },
      { onDay: TODAY },
    );

    assert.ok(result.errors.target_amount);
  }
});

test('target amount allows at most two decimal places', () => {
  const result = validateNewGoal(
    { ...validGoal, target_amount: '100.999' },
    { onDay: TODAY },
  );

  assert.ok(result.errors.target_amount);
});

test('target date must be a valid future date', () => {
  for (const date of ['2026-11-04', '2026-10-01', '2027-02-30']) {
    const result = validateNewGoal(
      { ...validGoal, target_date: date },
      { onDay: TODAY },
    );

    assert.ok(result.errors.target_date);
  }
});

test('optional linked account accepts a valid ObjectId', () => {
  const accountId = new mongoose.Types.ObjectId().toString();

  const result = validateNewGoal(
    { ...validGoal, linked_account_id: accountId },
    { onDay: TODAY },
  );

  assert.equal(result.data.linked_account_id, accountId);
});

test('invalid linked account id is rejected', () => {
  const result = validateNewGoal(
    { ...validGoal, linked_account_id: 'invalid-id' },
    { onDay: TODAY },
  );

  assert.ok(result.errors.linked_account_id);
});

test('multiple invalid fields return field-specific errors', () => {
  const result = validateNewGoal(
    {
      name: '',
      target_amount: '0',
      target_date: '2026-01-01',
      linked_account_id: 'invalid',
    },
    { onDay: TODAY },
  );

  assert.ok(result.errors.name);
  assert.ok(result.errors.target_amount);
  assert.ok(result.errors.target_date);
  assert.ok(result.errors.linked_account_id);
});