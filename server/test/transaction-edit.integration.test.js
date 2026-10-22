import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApi, stopApi, createUser, createAccount, createCategory, apiAs,
  balancesOf, netWorthOf, isoDay, record, overallBudget,
} from './helpers/integration.js';
import Transaction from '../src/models/Transaction.js';
import Transfer from '../src/models/Transfer.js';
import TransactionTag from '../src/models/TransactionTag.js';
import Tag from '../src/models/Tag.js';
import AuditLog from '../src/models/AuditLog.js';

before(startApi);
after(stopApi);

const UNKNOWN_ID = '507f1f77bcf86cd799439011';

/** A user with a bank account (1000.00 opening) and one recorded expense of 500. */
async function setup({ amount = '500' } = {}) {
  const user = await createUser();
  const bank = await createAccount(user, { opening_balance: '10000.00' });
  const expense = await record(user, { type: 'expense', amount, account_id: bank.id });
  return { user, bank, expense, api: apiAs(user) };
}

// ---------------------------------------------------------------------------
// REQ-28 - successful edits recompute balance and budget immediately
// ---------------------------------------------------------------------------

test('UT_19 / IT_04: editing an expense from 500 to 800 updates the balance and the budget at once', async () => {
  const { user, bank, expense, api } = await setup();
  const spent = await overallBudget(user);

  assert.equal((await balancesOf(user))[bank.id], '9500.00');
  assert.equal(await spent(), '500.00');

  const res = await api.patch(`/api/transactions/${expense.id}`, { amount: '800' });

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Transaction updated successfully.');
  assert.equal(res.body.data.amount, '800.00');
  assert.equal((await balancesOf(user))[bank.id], '9200.00');
  assert.equal(await spent(), '800.00');
});

test('moving an expense to another account puts the money back on the first and takes it from the second', async () => {
  const { user, bank, expense, api } = await setup();
  const wallet = await createAccount(user, { type: 'wallet', opening_balance: '300.00' });

  const res = await api.patch(`/api/transactions/${expense.id}`, { account_id: wallet.id });

  assert.equal(res.status, 200);
  const balances = await balancesOf(user);
  assert.equal(balances[bank.id], '10000.00');
  assert.equal(balances[wallet.id], '-200.00');
});

test('changing an expense into income flips its effect on the balance and removes it from the budget', async () => {
  const { user, bank, expense, api } = await setup({ amount: '100' });
  const spent = await overallBudget(user);
  assert.equal((await balancesOf(user))[bank.id], '9900.00');

  const res = await api.patch(`/api/transactions/${expense.id}`, { type: 'income' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.type, 'income');
  assert.equal((await balancesOf(user))[bank.id], '10100.00');
  assert.equal(await spent(), '0.00');
});

test('editing a credit card expense changes the outstanding amount', async () => {
  const user = await createUser();
  const card = await createAccount(user, {
    type: 'credit_card', opening_balance: '0.00', credit_limit: '50000.00',
  });
  const expense = await record(user, { type: 'expense', amount: '1000', account_id: card.id });
  assert.equal((await balancesOf(user))[card.id], '1000.00');

  await apiAs(user).patch(`/api/transactions/${expense.id}`, { amount: '250.50' });

  assert.equal((await balancesOf(user))[card.id], '250.50');
});

test('a partial edit changes only the fields sent', async () => {
  const user = await createUser();
  const bank = await createAccount(user);
  const category = await createCategory(user);
  const created = await record(user, {
    type: 'expense', amount: '42.10', account_id: bank.id, category_id: category.id,
    payment_mode: 'upi', note: 'lunch', tags: ['food'],
  });

  const res = await apiAs(user).patch(`/api/transactions/${created.id}`, { note: 'team lunch' });

  assert.equal(res.status, 200);
  assert.deepEqual(
    { ...res.body.data, id: undefined, transaction_date: undefined },
    {
      id: undefined, type: 'expense', amount: '42.10', transaction_date: undefined,
      account_id: bank.id, category_id: category.id, payment_mode: 'upi',
      note: 'team lunch', tags: ['food'],
    },
  );
});

test('date, category, payment mode and note can all be edited', async () => {
  const { user, expense, api } = await setup();
  const category = await createCategory(user);

  const res = await api.patch(`/api/transactions/${expense.id}`, {
    transaction_date: isoDay(-3), category_id: category.id, payment_mode: 'card', note: '  moved  ',
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.transaction_date.slice(0, 10), isoDay(-3));
  assert.equal(res.body.data.category_id, category.id);
  assert.equal(res.body.data.payment_mode, 'card');
  assert.equal(res.body.data.note, 'moved');

  const cleared = await api.patch(`/api/transactions/${expense.id}`, { category_id: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.category_id, null);
});

test('tags can be replaced, reuse existing tags case-insensitively, and be cleared', async () => {
  const user = await createUser();
  const bank = await createAccount(user);
  const created = await record(user, { type: 'expense', amount: '10', account_id: bank.id, tags: ['Food', 'trip'] });
  const api = apiAs(user);

  const replaced = await api.patch(`/api/transactions/${created.id}`, { tags: ['FOOD', 'gift'] });
  assert.equal(replaced.status, 200);
  assert.deepEqual([...replaced.body.data.tags].sort(), ['FOOD', 'gift']);

  assert.equal(await TransactionTag.countDocuments({ transaction_id: created.id }), 2);
  assert.equal(await Tag.countDocuments({ user_id: user._id, name: /^food$/i }), 1, 'Food tag reused, not duplicated');

  // Tags that differ only by case in one edit are one tag, not a server error.
  const mixedCase = await api.patch(`/api/transactions/${created.id}`, { tags: ['Gift', 'gift', 'GIFT'] });
  assert.equal(mixedCase.status, 200);
  assert.deepEqual(mixedCase.body.data.tags, ['Gift']);
  assert.equal(await TransactionTag.countDocuments({ transaction_id: created.id }), 1);

  const cleared = await api.patch(`/api/transactions/${created.id}`, { tags: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.data.tags, []);
  assert.equal(await TransactionTag.countDocuments({ transaction_id: created.id }), 0);
});

test('an edit may set tomorrow\'s date (REQ-26 allows one day ahead)', async () => {
  const { expense, api } = await setup();
  assert.equal((await api.patch(`/api/transactions/${expense.id}`, { transaction_date: isoDay(1) })).status, 200);
});

// ---------------------------------------------------------------------------
// Invalid payloads: 400, the record is unchanged, balances are unchanged
// ---------------------------------------------------------------------------

const AMOUNT_MESSAGE = 'Enter an amount greater than 0 with up to 2 decimal places.';

test('REQ-25: invalid amounts are rejected with the required message and nothing changes', async () => {
  const { user, bank, expense, api } = await setup();

  for (const amount of ['0', 0, '-5', -5, 'abc', '10.123', '', null, [], {}, '1e3', '1,000']) {
    const res = await api.patch(`/api/transactions/${expense.id}`, { amount });
    assert.equal(res.status, 400, `amount ${JSON.stringify(amount)}`);
    assert.equal(res.body.errors.amount, AMOUNT_MESSAGE);
  }

  assert.equal((await Transaction.findById(expense.id)).amount.toString(), '500.00');
  assert.equal((await balancesOf(user))[bank.id], '9500.00');
});

test('invalid dates, notes, tags, payment modes, types and ids in the body are rejected', async () => {
  const { expense, api } = await setup();
  const url = `/api/transactions/${expense.id}`;
  const cases = [
    [{ transaction_date: '21/10/2026' }, 'transaction_date'],
    [{ transaction_date: '2026-02-30' }, 'transaction_date'],
    [{ transaction_date: isoDay(2) }, 'transaction_date'],
    [{ transaction_date: 20261021 }, 'transaction_date'],
    [{ note: 'x'.repeat(201) }, 'note'],
    [{ note: 42 }, 'note'],
    [{ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'tags'],
    [{ tags: ['x'.repeat(21)] }, 'tags'],
    [{ tags: [''] }, 'tags'],
    [{ tags: 'food' }, 'tags'],
    [{ payment_mode: 'bitcoin' }, 'payment_mode'],
    [{ type: 'refund' }, 'type'],
    [{ account_id: 'not-an-id' }, 'account_id'],
    [{ category_id: 'not-an-id' }, 'category_id'],
    [{ from_account_id: UNKNOWN_ID }, 'from_account_id'],
  ];

  for (const [body, field] of cases) {
    const res = await api.patch(url, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.errors?.[field], `expected an error on ${field} for ${JSON.stringify(body)}`);
  }
});

test('fields that cannot be edited, and an empty body, are rejected', async () => {
  const { user, expense, api } = await setup();
  const other = await createUser();
  const url = `/api/transactions/${expense.id}`;

  for (const body of [{ user_id: other.id }, { is_deleted: true }, { deleted_at: '2020-01-01' }, { currency: 'USD' }]) {
    const res = await api.patch(url, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(Object.values(res.body.errors)[0], 'This field cannot be changed.');
  }

  const empty = await api.patch(url, {});
  assert.equal(empty.status, 400);
  assert.equal(empty.body.errors.body, 'Provide at least one field to update.');

  const stored = await Transaction.findById(expense.id);
  assert.equal(String(stored.user_id), user.id);
  assert.equal(stored.is_deleted, false);
  assert.equal(stored.currency, 'INR');
});

test('a body that is not a JSON object is rejected', async () => {
  const { expense, api } = await setup();
  for (const body of [[], 'amount=5']) {
    const res = await api.patch(`/api/transactions/${expense.id}`, body);
    assert.equal(res.status, 400);
  }
});

test('account references must exist, be the caller\'s own, and be active', async () => {
  const { user, expense, api } = await setup();
  const other = await createUser();
  const theirs = await createAccount(other);
  const archived = await createAccount(user, { is_archived: true });
  const url = `/api/transactions/${expense.id}`;

  for (const accountId of [UNKNOWN_ID, theirs.id, archived.id]) {
    const res = await api.patch(url, { account_id: accountId });
    assert.equal(res.status, 404, accountId);
    assert.equal(res.body.message, 'Account not found or unavailable.');
  }
  assert.equal(String((await Transaction.findById(expense.id)).account_id), String(expense.account_id));
});

test('a category must be the caller\'s own', async () => {
  const { user, expense, api } = await setup();
  const other = await createUser();
  const theirs = await createCategory(other);

  for (const id of [UNKNOWN_ID, theirs.id]) {
    const res = await api.patch(`/api/transactions/${expense.id}`, { category_id: id });
    assert.equal(res.status, 400);
    assert.equal(res.body.message, 'Select a valid category.');
  }
  assert.equal((await Transaction.findById(expense.id)).category_id, null);
});

test('an income or expense cannot be turned into a transfer, and a transfer cannot be turned into either', async () => {
  const { user, bank, expense, api } = await setup();
  const cash = await createAccount(user, { type: 'cash' });
  const transfer = await record(user, {
    type: 'transfer', amount: '100', from_account_id: bank.id, to_account_id: cash.id,
  });

  const toTransfer = await api.patch(`/api/transactions/${expense.id}`, {
    type: 'transfer', from_account_id: bank.id, to_account_id: cash.id,
  });
  assert.equal(toTransfer.status, 400);
  assert.match(toTransfer.body.errors.type, /cannot be changed/);

  const fromTransfer = await api.patch(`/api/transactions/${transfer.id}`, { type: 'expense', account_id: bank.id });
  assert.equal(fromTransfer.status, 400);

  assert.equal((await Transaction.findById(expense.id)).type, 'expense');
  assert.equal(await Transfer.countDocuments({ user_id: user._id }), 1);
});

// ---------------------------------------------------------------------------
// Transfers: one linked record, both balances move together, net worth fixed
// ---------------------------------------------------------------------------

async function transferSetup() {
  const user = await createUser();
  const bank = await createAccount(user, { opening_balance: '5000.00' });
  const cash = await createAccount(user, { type: 'cash', opening_balance: '100.00' });
  const savings = await createAccount(user, { opening_balance: '0.00' });
  const transfer = await record(user, {
    type: 'transfer', amount: '2000', from_account_id: bank.id, to_account_id: cash.id,
  });
  return { user, bank, cash, savings, transfer, api: apiAs(user), worth: await netWorthOf(user) };
}

test('ST_03: editing a transfer amount moves BOTH balances and leaves net worth unchanged', async () => {
  const { user, bank, cash, transfer, api, worth } = await transferSetup();
  assert.deepEqual(
    [(await balancesOf(user))[bank.id], (await balancesOf(user))[cash.id]],
    ['3000.00', '2100.00'],
  );

  const res = await api.patch(`/api/transactions/${transfer.id}`, { amount: '2500.50' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.type, 'transfer');
  assert.equal(res.body.data.amount, '2500.50');
  const balances = await balancesOf(user);
  assert.equal(balances[bank.id], '2499.50');
  assert.equal(balances[cash.id], '2600.50');
  assert.equal(await netWorthOf(user), worth);
  assert.equal(await Transfer.countDocuments({ user_id: user._id }), 1, 'still a single linked record');
});

test('re-pointing a transfer to another destination keeps debit and credit together', async () => {
  const { user, bank, cash, savings, transfer, api, worth } = await transferSetup();

  const res = await api.patch(`/api/transactions/${transfer.id}`, { to_account_id: savings.id });

  assert.equal(res.status, 200);
  const balances = await balancesOf(user);
  assert.equal(balances[bank.id], '3000.00');
  assert.equal(balances[cash.id], '100.00');
  assert.equal(balances[savings.id], '2000.00');
  assert.equal(await netWorthOf(user), worth);
});

test('a transfer edit that would make source and destination the same is rejected', async () => {
  const { user, bank, cash, transfer, api } = await transferSetup();

  for (const body of [{ to_account_id: bank.id }, { from_account_id: cash.id }, { from_account_id: bank.id, to_account_id: bank.id }]) {
    const res = await api.patch(`/api/transactions/${transfer.id}`, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.errors.to_account_id, 'Source and destination accounts must be different.');
  }
  assert.equal((await balancesOf(user))[bank.id], '3000.00');
});

test('transfer edits reject income/expense-only fields, foreign, archived and other-currency accounts', async () => {
  const { user, bank, transfer, api } = await transferSetup();
  const other = await createUser();
  const theirs = await createAccount(other);
  const archived = await createAccount(user, { is_archived: true });
  const usd = await createAccount(user, { currency: 'USD' });
  const url = `/api/transactions/${transfer.id}`;

  for (const body of [{ category_id: UNKNOWN_ID }, { payment_mode: 'cash' }, { tags: ['x'] }, { account_id: bank.id }]) {
    assert.equal((await api.patch(url, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await api.patch(url, { to_account_id: theirs.id })).status, 404);
  assert.equal((await api.patch(url, { to_account_id: archived.id })).status, 404);
  assert.equal((await api.patch(url, { to_account_id: UNKNOWN_ID })).status, 404);
  assert.equal((await api.patch(url, { to_account_id: usd.id })).status, 400);

  const stored = await Transfer.findById(transfer.id);
  assert.equal(String(stored.from_account_id), bank.id);
  assert.equal(stored.amount.toString(), '2000.00');
});

test('a transfer\'s note and date can be edited even after one of its accounts is archived', async () => {
  const { bank, cash, transfer, api } = await transferSetup();
  const Account = (await import('../src/models/Account.js')).default;
  await Account.updateOne({ _id: cash._id }, { is_archived: true });

  const res = await api.patch(`/api/transactions/${transfer.id}`, { note: 'savings top-up', transaction_date: isoDay(-1) });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.note, 'savings top-up');
  assert.equal(res.body.data.from_account_id, bank.id);
});

// ---------------------------------------------------------------------------
// Missing / invalid ids, other users' records, sign-in
// ---------------------------------------------------------------------------

test('invalid, unknown and missing ids give 404 and change nothing', async () => {
  const { api, expense } = await setup();

  for (const id of ['not-an-id', '123', UNKNOWN_ID, '%20', 'recycle-bin']) {
    const patch = await api.patch(`/api/transactions/${id}`, { amount: '5' });
    assert.equal(patch.status, 404, `PATCH ${id}`);
    assert.equal(patch.body.message ?? patch.body.error, patch.body.message ? 'Transaction not found.' : 'Not found');
    assert.equal((await api.delete(`/api/transactions/${id}`)).status, 404, `DELETE ${id}`);
    assert.equal((await api.post(`/api/transactions/${id}/restore`)).status, 404, `restore ${id}`);
  }

  // No id at all: there is no PATCH/DELETE on the collection route.
  assert.equal((await api.patch('/api/transactions', { amount: '5' })).status, 404);
  assert.equal((await api.delete('/api/transactions')).status, 404);
  assert.equal((await Transaction.findById(expense.id)).amount.toString(), '500.00');
});

test('a user cannot edit, delete or restore another user\'s transactions or transfers', async () => {
  const { user, bank, expense, api } = await setup();
  const cash = await createAccount(user, { type: 'cash' });
  const transfer = await record(user, { type: 'transfer', amount: '10', from_account_id: bank.id, to_account_id: cash.id });
  const deleted = await record(user, { type: 'expense', amount: '7', account_id: bank.id });
  await api.delete(`/api/transactions/${deleted.id}`);

  const intruder = apiAs(await createUser());

  for (const id of [expense.id, transfer.id]) {
    const edit = await intruder.patch(`/api/transactions/${id}`, { amount: '999' });
    assert.equal(edit.status, 404);
    assert.equal(edit.body.message, 'Transaction not found.');
    assert.equal((await intruder.delete(`/api/transactions/${id}`)).status, 404);
  }
  assert.equal((await intruder.post(`/api/transactions/${deleted.id}/restore`)).status, 404);

  assert.equal((await Transaction.findById(expense.id)).amount.toString(), '500.00');
  assert.equal((await Transaction.findById(expense.id)).is_deleted, false);
  assert.equal((await Transfer.findById(transfer.id)).is_deleted, false);
  assert.equal((await Transaction.findById(deleted.id)).is_deleted, true, 'still in the owner\'s bin');
  assert.deepEqual((await intruder.get('/api/transactions/recycle-bin')).body.items, []);
});

test('every US-09 endpoint requires sign-in', async () => {
  const { expense } = await setup();
  const anon = apiAs(null);

  for (const res of [
    await anon.patch(`/api/transactions/${expense.id}`, { amount: '5' }),
    await anon.delete(`/api/transactions/${expense.id}`),
    await anon.post(`/api/transactions/${expense.id}/restore`),
    await anon.get('/api/transactions/recycle-bin'),
  ]) {
    assert.equal(res.status, 401);
  }
  assert.equal((await Transaction.findById(expense.id)).amount.toString(), '500.00');
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

test('an edit writes an audit entry with only the changed fields; a no-op edit writes none', async () => {
  const { user, expense, api } = await setup();

  await api.patch(`/api/transactions/${expense.id}`, { amount: '800', note: 'bigger' });
  await api.patch(`/api/transactions/${expense.id}`, { amount: '800' });

  const entries = await AuditLog.find({ entity_id: expense.id, action: 'update' }).lean();
  assert.equal(entries.length, 1);
  assert.equal(String(entries[0].user_id), user.id);
  assert.deepEqual(entries[0].old_value, { amount: '500.00', note: '' });
  assert.deepEqual(entries[0].new_value, { amount: '800.00', note: 'bigger' });
});
