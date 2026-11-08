import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transactionDeletionWarning, financialTotalLabel, goalDeletionWarning } from '../src/financialSafety.js';

test('SAF-3 deletion confirmation identifies the selected financial record and recovery period', () => {
  const warning = transactionDeletionWarning({ id: 'record-42', type: 'expense', amount: '45.00', currency: 'INR', transaction_date: '2026-11-08', note: 'Lunch' });
  for (const part of ['record-42', 'expense', '45.00', 'INR', '2026-11-08', 'Lunch', '30 days', 'permanently purged']) assert.ok(warning.includes(part), part);
});

test('SAF-6 unknown totals are unavailable while a successfully computed zero stays zero', () => {
  assert.equal(financialTotalLabel(null), 'Unavailable');
  assert.equal(financialTotalLabel(undefined), 'Unavailable');
  assert.equal(financialTotalLabel('0.00'), '0.00');
  assert.equal(financialTotalLabel('123.45'), '123.45');
});

test('SAF-3 funded-goal confirmation explains recovery and retained history without promising refunds', () => {
  const warning = goalDeletionWarning({ name: 'Emergency fund', saved_amount: '500.00' });
  assert.match(warning, /Emergency fund/);
  assert.match(warning, /30 days/);
  assert.match(warning, /history and account balances will be retained/);
  assert.doesNotMatch(warning, /refund|permanently delete|empty goal/i);
});
