import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApi, stopApi, createUser, createAccount, apiAs, balancesOf, netWorthOf, isoDay,
} from './helpers/integration.js';
import Transfer from '../src/models/Transfer.js';
import Transaction from '../src/models/Transaction.js';

before(startApi);
after(stopApi);

test('REQ-24: recording a transfer creates ONE linked record and moves the balances', async () => {
  const user = await createUser();
  const bank = await createAccount(user, { opening_balance: '5000.00' });
  const cash = await createAccount(user, { type: 'cash', opening_balance: '100.00' });
  const before = await netWorthOf(user);

  const res = await apiAs(user).post('/api/transactions', {
    type: 'transfer',
    amount: '1500',
    transaction_date: isoDay(),
    from_account_id: bank.id,
    to_account_id: cash.id,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.data.type, 'transfer');
  assert.equal(res.body.data.amount, '1500.00');
  assert.equal(await Transfer.countDocuments({ user_id: user._id }), 1);
  assert.equal(await Transaction.countDocuments({ user_id: user._id }), 0, 'no income/expense rows');

  const balances = await balancesOf(user);
  assert.equal(balances[bank.id], '3500.00');
  assert.equal(balances[cash.id], '1600.00');
  assert.equal(await netWorthOf(user), before, 'net worth unchanged');
});

test('a transfer cannot use another user\'s account, an archived account or mixed currencies', async () => {
  const user = await createUser();
  const other = await createUser();
  const mine = await createAccount(user);
  const theirs = await createAccount(other);
  const archived = await createAccount(user, { is_archived: true });
  const usd = await createAccount(user, { currency: 'USD' });
  const body = (from, to) => ({
    type: 'transfer', amount: '10', transaction_date: isoDay(), from_account_id: from.id, to_account_id: to.id,
  });

  assert.equal((await apiAs(user).post('/api/transactions', body(mine, theirs))).status, 404);
  assert.equal((await apiAs(user).post('/api/transactions', body(mine, archived))).status, 404);
  assert.equal((await apiAs(user).post('/api/transactions', body(mine, usd))).status, 400);
  assert.equal(await Transfer.countDocuments({ user_id: user._id }), 0);
});
