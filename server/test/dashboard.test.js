import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { periodTotals, topCategories } from '../src/services/dashboardService.js';

// ---------------------------------------------------------------------------
// REQ-69 (UT_45): total income, total expense and net savings
// ---------------------------------------------------------------------------

test('REQ-69 UT_45 income 60000, expense 21500.50 -> net savings 38499.50', () => {
  assert.deepEqual(
    periodTotals([
      { _id: 'income', total: '60000' },
      { _id: 'expense', total: '21500.50' },
    ]),
    { total_income: '60000.00', total_expense: '21500.50', net_savings: '38499.50' },
  );
});

test('REQ-69 spending more than earning gives negative net savings', () => {
  assert.equal(
    periodTotals([{ _id: 'income', total: '1000' }, { _id: 'expense', total: '1500' }]).net_savings,
    '-500.00',
  );
});

test('REQ-69 a period with no transactions shows zeros', () => {
  assert.deepEqual(periodTotals([]), {
    total_income: '0.00', total_expense: '0.00', net_savings: '0.00',
  });
});

// ---------------------------------------------------------------------------
// Top spending categories on the dashboard
// ---------------------------------------------------------------------------

const id = () => new mongoose.Types.ObjectId();

test('top categories: largest first, with share of total expense', () => {
  const food = id();
  const rent = id();
  const fun = id();
  const names = new Map([[food.toString(), 'Food'], [rent.toString(), 'Rent'], [fun.toString(), 'Fun']]);
  const result = topCategories(
    [{ _id: food, total: '2500' }, { _id: rent, total: '15000' }, { _id: fun, total: '2500' }],
    names,
    '20000.00',
  );
  assert.deepEqual(result.map((c) => [c.name, c.amount, c.share_percent]), [
    ['Rent', '15000.00', 75],
    ['Food', '2500.00', 12.5],
    ['Fun', '2500.00', 12.5],
  ]);
});

test('top categories: shows at most five and labels uncategorised spending', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ _id: id(), total: String(100 + i) }));
  rows.push({ _id: null, total: '999' });
  const result = topCategories(rows, new Map(), '1720');
  assert.equal(result.length, 5);
  assert.equal(result[0].name, 'Uncategorised');
});

test('top categories: no expense means 0% shares, not a division error', () => {
  assert.deepEqual(topCategories([], new Map(), '0.00'), []);
});
