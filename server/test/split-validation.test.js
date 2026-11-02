import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTransactionInput, MAX_SPLITS } from '../src/validators/transaction.js';

/**
 * US-11 (#27), SRS 5.3: REQ-32 and REQ-33.
 */

const CAT_A = 'a'.repeat(24);
const CAT_B = 'b'.repeat(24);
const CAT_C = 'c'.repeat(24);
const ACCOUNT = 'd'.repeat(24);

function expense(extra = {}) {
  return validateTransactionInput({
    type: 'expense',
    amount: '100.00',
    account_id: ACCOUNT,
    transaction_date: '2026-10-01',
    ...extra,
  });
}

function splits(...pairs) {
  return pairs.map(([category_id, amount]) => ({ category_id, amount }));
}

// ---------------------------------------------------------------------------
// REQ-32: up to five categories, summing exactly to the amount
// ---------------------------------------------------------------------------

test('REQ-32 a split that sums to the amount is accepted', () => {
  const result = expense({ splits: splits([CAT_A, '60.00'], [CAT_B, '40.00']) });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.splits.length, 2);
});

test('REQ-32 a split that is short of the amount is refused', () => {
  const result = expense({ splits: splits([CAT_A, '60.00'], [CAT_B, '30.00']) });
  assert.match(result.errors.splits, /add up to 90\.00.*is 100\.00/);
});

test('REQ-32 a split that overshoots the amount is refused', () => {
  const result = expense({ splits: splits([CAT_A, '60.00'], [CAT_B, '50.00']) });
  assert.match(result.errors.splits, /add up to 110\.00/);
});

test('REQ-32 a split off by one paisa is refused', () => {
  // Money is exact (BR-4): 99.99 is not 100.00.
  const result = expense({ splits: splits([CAT_A, '60.00'], [CAT_B, '39.99']) });
  assert.ok(result.errors.splits);
});

test('REQ-32 five categories are allowed', () => {
  const result = expense({
    amount: '50.00',
    splits: splits([CAT_A, '10.00'], [CAT_B, '10.00'], [CAT_C, '10.00'], [CAT_A, '10.00'], [CAT_B, '10.00']),
  });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.splits.length, MAX_SPLITS);
});

test('REQ-32 a sixth category is refused', () => {
  const result = expense({
    amount: '60.00',
    splits: splits([CAT_A, '10.00'], [CAT_B, '10.00'], [CAT_C, '10.00'], [CAT_A, '10.00'], [CAT_B, '10.00'], [CAT_C, '10.00']),
  });
  assert.match(result.errors.splits, /at most 5/);
});

test('REQ-32 a single category is not a split', () => {
  const result = expense({ splits: splits([CAT_A, '100.00']) });
  assert.match(result.errors.splits, /at least two/);
});

test('REQ-32 a split part must be a positive money amount', () => {
  assert.ok(expense({ splits: splits([CAT_A, '-60.00'], [CAT_B, '160.00']) }).errors.splits);
  assert.ok(expense({ splits: splits([CAT_A, '0.00'], [CAT_B, '100.00']) }).errors.splits);
  assert.ok(expense({ splits: splits([CAT_A, '60.005'], [CAT_B, '39.995']) }).errors.splits);
});

test('REQ-32 a split part needs a real category id', () => {
  const result = expense({ splits: splits(['not-an-id', '60.00'], [CAT_B, '40.00']) });
  assert.match(result.errors.splits, /valid category/);
});

test('REQ-32 splitting replaces the parent category, so there is one answer', () => {
  const result = expense({
    category_id: CAT_C,
    splits: splits([CAT_A, '60.00'], [CAT_B, '40.00']),
  });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.category_id, null);
});

test('REQ-32 only an expense can be split', () => {
  const result = validateTransactionInput({
    type: 'income',
    amount: '100.00',
    account_id: ACCOUNT,
    transaction_date: '2026-10-01',
    splits: splits([CAT_A, '60.00'], [CAT_B, '40.00']),
  });
  assert.match(result.errors.splits, /Only an expense/);
});

test('REQ-32 an empty list clears the splits', () => {
  const result = expense({ splits: [] });
  assert.equal(result.errors, undefined);
  assert.deepEqual(result.data.splits, []);
});

test('REQ-32 a transaction with no splits is unaffected', () => {
  const result = expense({ category_id: CAT_A });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.category_id, CAT_A);
  assert.equal(result.data.splits, undefined);
});

test('REQ-32 splits must be a list', () => {
  assert.match(expense({ splits: 'half and half' }).errors.splits, /must be a list/);
});

test('REQ-32 editing splits without the amount is refused', () => {
  // The parts are checked against the amount in the same body; without it
  // they could be stored against a total that is about to change.
  const result = validateTransactionInput(
    { splits: splits([CAT_A, '60.00'], [CAT_B, '40.00']) },
    { allowPartial: true, currentType: 'expense' }
  );
  assert.match(result.errors.splits, /Send the transaction amount/);
});

test('REQ-32 editing splits with the amount is accepted', () => {
  const result = validateTransactionInput(
    { amount: '100.00', splits: splits([CAT_A, '60.00'], [CAT_B, '40.00']) },
    { allowPartial: true, currentType: 'expense' }
  );
  assert.equal(result.errors, undefined);
  assert.equal(result.data.splits.length, 2);
});

// ---------------------------------------------------------------------------
// REQ-33: excluded from budgets
// ---------------------------------------------------------------------------

test('REQ-33 a transaction can be marked excluded from budgets', () => {
  const result = expense({ category_id: CAT_A, is_excluded_from_budget: true });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.is_excluded_from_budget, true);
});

test('REQ-33 the flag can be cleared', () => {
  const result = expense({ category_id: CAT_A, is_excluded_from_budget: false });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.is_excluded_from_budget, false);
});

test('REQ-33 the flag must be a boolean', () => {
  const result = expense({ category_id: CAT_A, is_excluded_from_budget: 'yes' });
  assert.match(result.errors.is_excluded_from_budget, /true or false/);
});

test('REQ-33 omitting the flag leaves it alone', () => {
  const result = expense({ category_id: CAT_A });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.is_excluded_from_budget, undefined);
});
