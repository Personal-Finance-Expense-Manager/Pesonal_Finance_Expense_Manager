import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Transaction from '../src/models/Transaction.js';
import Transfer from '../src/models/Transfer.js';
import Budget from '../src/models/Budget.js';
import { isPositiveDecimal } from '../src/utils/money.js';

const userId = new mongoose.Types.ObjectId();
const accountId = new mongoose.Types.ObjectId();
const otherAccountId = new mongoose.Types.ObjectId();

let passed = 0;

async function isValid(document) {
  try {
    await document.validate();
    return true;
  } catch {
    return false;
  }
}

function transaction(amount, extra = {}) {
  return new Transaction({
    user_id: userId,
    account_id: accountId,
    type: 'expense',
    amount,
    transaction_date: new Date('2026-10-20T10:00:00Z'),
    ...extra,
  });
}

async function test(name, assertion) {
  await assertion();
  passed += 1;
  console.log(`PASS: ${name}`);
}

async function runTests() {
  await test('Valid transaction amount', async () => {
    assert.equal(await isValid(transaction('12.50')), true);
  });

  await test('Zero transaction amount rejected', async () => {
    assert.equal(await isValid(transaction('0.00')), false);
  });

  await test('Negative transaction amount rejected', async () => {
    assert.equal(await isValid(transaction('-1.00')), false);
  });

  await test('More than two decimal places rejected for amount', async () => {
    assert.equal(await isValid(transaction('12.345')), false);
  });

  await test('High-precision positive exchange rate accepted', async () => {
    assert.equal(
      await isValid(
        transaction('12.50', { exchange_rate: '83.4567' }),
      ),
      true,
    );
  });

  await test('Zero exchange rate rejected', async () => {
    assert.equal(
      await isValid(
        transaction('12.50', { exchange_rate: '0' }),
      ),
      false,
    );
  });

  await test('Negative exchange rate rejected', async () => {
    assert.equal(
      await isValid(
        transaction('12.50', { exchange_rate: '-1.25' }),
      ),
      false,
    );
  });

  await test('Non-finite exchange rate rejected by validator', async () => {
    assert.equal(isPositiveDecimal('Infinity'), false);
    assert.equal(isPositiveDecimal('NaN'), false);
  });

  await test('Valid converted amount accepted', async () => {
    assert.equal(
      await isValid(
        transaction('12.50', { converted_amount: '1039.25' }),
      ),
      true,
    );
  });

  await test('Converted amount with excess decimal places rejected', async () => {
    assert.equal(
      await isValid(
        transaction('12.50', { converted_amount: '1039.257' }),
      ),
      false,
    );
  });

  await test('Zero converted amount rejected', async () => {
    assert.equal(
      await isValid(
        transaction('12.50', { converted_amount: '0.00' }),
      ),
      false,
    );
  });

  await test('Valid transfer', async () => {
    const transfer = new Transfer({
      user_id: userId,
      from_account_id: accountId,
      to_account_id: otherAccountId,
      amount: '25.50',
      transfer_date: new Date('2026-10-20T10:00:00Z'),
    });

    assert.equal(await isValid(transfer), true);
  });

  await test('Transfer between same account rejected', async () => {
    const transfer = new Transfer({
      user_id: userId,
      from_account_id: accountId,
      to_account_id: accountId,
      amount: '25.50',
      transfer_date: new Date('2026-10-20T10:00:00Z'),
    });

    assert.equal(await isValid(transfer), false);
  });

  await test('Valid budget period', async () => {
    const budget = new Budget({
      user_id: userId,
      amount: '100.00',
      period_type: 'monthly',
      period_start: new Date('2026-10-01T00:00:00Z'),
      period_end: new Date('2026-10-31T23:59:59Z'),
    });

    assert.equal(await isValid(budget), true);
  });

  await test('Invalid budget period rejected', async () => {
    const budget = new Budget({
      user_id: userId,
      amount: '100.00',
      period_type: 'monthly',
      period_start: new Date('2026-10-31T00:00:00Z'),
      period_end: new Date('2026-10-01T00:00:00Z'),
    });

    assert.equal(await isValid(budget), false);
  });

  console.log(`\nAll ${passed} validation tests passed.`);
}

runTests().catch(error => {
  console.error('Validation tests failed:', error);
  process.exitCode = 1;
});
