import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareOf, sumAmounts } from '../src/services/totalsService.js';

// ---------------------------------------------------------------------------
// REQ-42: category-wise and tag-wise totals, with each row's share
// ---------------------------------------------------------------------------

const names = new Map([
  ['aaaaaaaaaaaaaaaaaaaaaaa1', 'Food'],
  ['aaaaaaaaaaaaaaaaaaaaaaa2', 'Transport'],
]);

const rows = [
  { _id: 'aaaaaaaaaaaaaaaaaaaaaaa2', total: '250.00', count: 2 },
  { _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', total: '750.00', count: 5 },
];

test('REQ-42 totals are ordered from largest to smallest', () => {
  const result = shareOf(rows, names, '1000.00');
  assert.deepEqual(result.map((r) => r.name), ['Food', 'Transport']);
});

test('REQ-42 each row carries its share of the total', () => {
  const result = shareOf(rows, names, '1000.00');
  assert.equal(result[0].share_percent, 75);
  assert.equal(result[1].share_percent, 25);
});

test('REQ-42 amounts are money to exactly two decimal places (BR-4)', () => {
  const result = shareOf([{ _id: null, total: '12.5', count: 1 }], names, '12.5');
  assert.equal(result[0].amount, '12.50');
});

test('REQ-42 shares are rounded to one decimal place', () => {
  const result = shareOf([{ _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', total: '333.33', count: 1 }], names, '1000.00');
  assert.equal(result[0].share_percent, 33.3);
});

test('REQ-42 a zero total does not divide by zero', () => {
  const result = shareOf([{ _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', total: '0', count: 0 }], names, '0.00');
  assert.equal(result[0].share_percent, 0);
  assert.equal(result[0].amount, '0.00');
});

test('REQ-42 a transaction with no category is reported as Uncategorised', () => {
  const result = shareOf([{ _id: null, total: '100.00', count: 1 }], names, '100.00');
  assert.equal(result[0].name, 'Uncategorised');
  assert.equal(result[0].id, null);
});

test('REQ-42 a category deleted since the transaction is labelled, not dropped', () => {
  const result = shareOf([{ _id: 'bbbbbbbbbbbbbbbbbbbbbbb9', total: '40.00', count: 1 }], names, '40.00');
  assert.equal(result[0].name, 'Deleted');
});

test('REQ-42 the fallback name is configurable for tags', () => {
  const result = shareOf([{ _id: null, total: '10.00', count: 1 }], names, '10.00', 'Untagged');
  assert.equal(result[0].name, 'Untagged');
});

test('REQ-42 transaction counts are carried through', () => {
  const result = shareOf(rows, names, '1000.00');
  assert.equal(result[0].transaction_count, 5);
  assert.equal(result[1].transaction_count, 2);
});

test('REQ-42 an empty period produces no rows', () => {
  assert.deepEqual(shareOf([], names, '0.00'), []);
});

// ---------------------------------------------------------------------------
// Tag subtotal
// ---------------------------------------------------------------------------

test('REQ-42 tag amounts sum with decimal precision, not floating point', () => {
  const tagRows = [{ amount: '0.10' }, { amount: '0.20' }];
  assert.equal(sumAmounts(tagRows), '0.30');
});

test('REQ-42 summing no tags gives zero', () => {
  assert.equal(sumAmounts([]), '0.00');
});
