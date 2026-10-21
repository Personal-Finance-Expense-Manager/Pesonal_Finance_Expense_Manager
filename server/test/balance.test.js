import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  computeBalance,
  cardPosition,
  netWorth,
  nextDueDate,
} from '../src/services/balanceService.js';
import { parseDateOnly, formatDateOnly } from '../src/utils/period.js';

const TODAY = parseDateOnly('2026-10-21');
const account = (type, opening, extra = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  name: `${type} account`,
  type,
  currency: 'INR',
  opening_balance: opening,
  ...extra,
});

// ---------------------------------------------------------------------------
// REQ-19 / BR-2 / BR-3: balance = opening + income - expenses +/- transfers
// ---------------------------------------------------------------------------

test('REQ-19 IT_03 bank balance: opening 5000, expense 500 -> 4500', () => {
  assert.equal(computeBalance(account('bank', '5000'), { expense: '500' }).toFixed(2), '4500.00');
});

test('REQ-19 income adds, expenses subtract, transfers move money', () => {
  const balance = computeBalance(account('bank', '10000'), {
    income: '25000',
    expense: '3200.50',
    transfersOut: '1500',
    transfersIn: '200',
  });
  assert.equal(balance.toFixed(2), '30499.50');
});

test('REQ-19 an account with no transactions shows its opening balance', () => {
  assert.equal(computeBalance(account('cash', '750.25')).toFixed(2), '750.25');
});

test('BR-2 a transfer of 1500 from bank to cash leaves the total unchanged', () => {
  const bank = computeBalance(account('bank', '5000'), { transfersOut: '1500' });
  const cash = computeBalance(account('cash', '0'), { transfersIn: '1500' });
  assert.equal(bank.plus(cash).toFixed(2), '5000.00');
});

test('REQ-19 credit card: spending raises the outstanding, payments lower it', () => {
  const card = account('credit_card', '4200');
  const outstanding = computeBalance(card, {
    expense: '3000', // card purchases
    income: '200', // a refund
    transfersIn: '5000', // bill paid from the bank
  });
  assert.equal(outstanding.toFixed(2), '2000.00');
});

// ---------------------------------------------------------------------------
// REQ-20 / DR-5: net worth = assets - credit card outstanding
// ---------------------------------------------------------------------------

test('REQ-20 UT_13 bank 50000 + cash 10000 - card 5000 = 55000', () => {
  const result = netWorth([
    { account: account('bank', '0'), balance: computeBalance(account('bank', '50000')) },
    { account: account('cash', '0'), balance: computeBalance(account('cash', '10000')) },
    { account: account('credit_card', '0'), balance: computeBalance(account('credit_card', '5000')) },
  ], 'INR');
  assert.deepEqual(result, {
    currency: 'INR',
    total_assets: '60000.00',
    total_liabilities: '5000.00',
    net_worth: '55000.00',
    accounts_not_included: [],
  });
});

test('REQ-20 a transfer between own accounts does not change net worth', () => {
  const before = netWorth([
    { account: account('bank', '0'), balance: computeBalance(account('bank', '5000')) },
    { account: account('cash', '0'), balance: computeBalance(account('cash', '0')) },
  ], 'INR');
  const after = netWorth([
    { account: account('bank', '0'), balance: computeBalance(account('bank', '5000'), { transfersOut: '1500' }) },
    { account: account('cash', '0'), balance: computeBalance(account('cash', '0'), { transfersIn: '1500' }) },
  ], 'INR');
  assert.equal(before.net_worth, after.net_worth);
});

test('REQ-20 accounts in another currency are listed, not silently added', () => {
  const usd = account('bank', '0', { currency: 'USD', name: 'US account' });
  const result = netWorth([
    { account: account('bank', '0'), balance: computeBalance(account('bank', '1000')) },
    { account: usd, balance: computeBalance(account('bank', '300')) },
  ], 'INR');
  assert.equal(result.net_worth, '1000.00');
  assert.deepEqual(result.accounts_not_included.map((a) => a.currency), ['USD']);
});

// ---------------------------------------------------------------------------
// REQ-21: credit card position and the 80% warning
// ---------------------------------------------------------------------------

test('REQ-21 ST_45 limit 100000, outstanding 85000 -> warning, 15000 available', () => {
  const card = cardPosition('85000', '100000', 5, TODAY);
  assert.equal(card.outstanding, '85000.00');
  assert.equal(card.credit_limit, '100000.00');
  assert.equal(card.available_credit, '15000.00');
  assert.equal(card.utilisation_percent, 85);
  assert.equal(card.high_utilisation_warning, true);
  assert.equal(card.next_statement_due_date, '2026-11-05');
});

test('REQ-21 exactly 80% does not warn; just above 80% does', () => {
  assert.equal(cardPosition('80000', '100000', null, TODAY).high_utilisation_warning, false);
  assert.equal(cardPosition('80000.01', '100000', null, TODAY).high_utilisation_warning, true);
});

test('REQ-21 over the limit shows zero available and how much over', () => {
  const card = cardPosition('105000', '100000', null, TODAY);
  assert.equal(card.available_credit, '0.00');
  assert.equal(card.over_limit_by, '5000.00');
});

test('REQ-21 a card with no limit set never warns', () => {
  assert.equal(cardPosition('5000', '0', null, TODAY).high_utilisation_warning, false);
});

test('REQ-21 next statement due date', () => {
  const on = (day, date) => formatDateOnly(nextDueDate(day, parseDateOnly(date)));
  assert.equal(on(25, '2026-10-21'), '2026-10-25'); // later this month
  assert.equal(on(21, '2026-10-21'), '2026-10-21'); // due today
  assert.equal(on(5, '2026-10-21'), '2026-11-05'); // already passed -> next month
  assert.equal(on(31, '2026-11-10'), '2026-11-30'); // short month -> last day
  assert.equal(on(10, '2026-12-15'), '2027-01-10'); // across the year end
  assert.equal(nextDueDate(null, TODAY), null);
});
