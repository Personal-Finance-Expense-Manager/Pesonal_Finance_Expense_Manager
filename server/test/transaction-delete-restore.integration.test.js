import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApi, stopApi, createUser, createAccount, createCategory, apiAs,
  balancesOf, netWorthOf, isoDay, record, overallBudget,
} from './helpers/integration.js';
import Transaction from '../src/models/Transaction.js';
import Transfer from '../src/models/Transfer.js';
import TransactionTag from '../src/models/TransactionTag.js';
import Attachment from '../src/models/Attachment.js';
import AuditLog from '../src/models/AuditLog.js';
import { purgeExpired } from '../src/services/recycleBinService.js';

before(startApi);
after(stopApi);

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

async function setup() {
  const user = await createUser();
  const bank = await createAccount(user, { opening_balance: '10000.00' });
  return { user, bank, api: apiAs(user) };
}

async function addAttachment(user, transactionId) {
  return Attachment.create({
    user_id: user._id, transaction_id: transactionId,
    object_key: `receipts/${transactionId}.jpg`, file_name: 'receipt.jpg',
    mime_type: 'image/jpeg', size_bytes: 1234,
  });
}

// ---------------------------------------------------------------------------
// REQ-29 - soft delete
// ---------------------------------------------------------------------------

test('UT_20: deleting an expense restores the balance and budget at once and moves it to the recycle bin', async () => {
  const { user, bank, api } = await setup();
  const expense = await record(user, { type: 'expense', amount: '500', account_id: bank.id });
  const spent = await overallBudget(user);
  assert.equal((await balancesOf(user))[bank.id], '9500.00');
  assert.equal(await spent(), '500.00');

  const res = await api.delete(`/api/transactions/${expense.id}`);

  assert.equal(res.status, 200);
  assert.match(res.body.message, /recycle bin.*30 days/);
  assert.equal(res.body.data.id, expense.id);
  assert.equal(res.body.data.type, 'expense');
  const deletedAt = new Date(res.body.data.deleted_at).getTime();
  assert.equal(new Date(res.body.data.restorable_until).getTime() - deletedAt, 30 * DAY);

  assert.equal((await balancesOf(user))[bank.id], '10000.00');
  assert.equal(await spent(), '0.00');

  // Soft delete: the row is still there, flagged.
  const stored = await Transaction.findById(expense.id);
  assert.equal(stored.is_deleted, true);
  assert.ok(stored.deleted_at);

  const bin = await api.get('/api/transactions/recycle-bin');
  assert.equal(bin.status, 200);
  assert.equal(bin.body.retention_days, 30);
  assert.deepEqual(bin.body.items.map((i) => i.id), [expense.id]);
  assert.equal(bin.body.items[0].amount, '500.00');
});

test('deleting an income reduces the balance it had increased', async () => {
  const { user, bank, api } = await setup();
  const income = await record(user, { type: 'income', amount: '1200.75', account_id: bank.id });
  assert.equal((await balancesOf(user))[bank.id], '11200.75');

  assert.equal((await api.delete(`/api/transactions/${income.id}`)).status, 200);

  assert.equal((await balancesOf(user))[bank.id], '10000.00');
});

test('deleting a transfer reverses BOTH sides, leaves net worth unchanged, and leaves no orphan', async () => {
  const { user, bank, api } = await setup();
  const cash = await createAccount(user, { type: 'cash', opening_balance: '50.00' });
  const worth = await netWorthOf(user);
  const transfer = await record(user, { type: 'transfer', amount: '1500', from_account_id: bank.id, to_account_id: cash.id });
  assert.equal((await balancesOf(user))[bank.id], '8500.00');
  assert.equal((await balancesOf(user))[cash.id], '1550.00');

  const res = await api.delete(`/api/transactions/${transfer.id}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.type, 'transfer');
  const balances = await balancesOf(user);
  assert.equal(balances[bank.id], '10000.00');
  assert.equal(balances[cash.id], '50.00');
  assert.equal(await netWorthOf(user), worth);

  // One record, flagged as a whole: nothing half-deleted, no stray expense/income.
  assert.equal(await Transfer.countDocuments({ user_id: user._id }), 1);
  assert.equal((await Transfer.findById(transfer.id)).is_deleted, true);
  assert.equal(await Transaction.countDocuments({ user_id: user._id }), 0);

  const bin = (await api.get('/api/transactions/recycle-bin')).body.items;
  assert.deepEqual(bin.map((i) => [i.id, i.type]), [[transfer.id, 'transfer']]);
});

test('a deleted transaction cannot be deleted again or edited', async () => {
  const { user, bank, api } = await setup();
  const expense = await record(user, { type: 'expense', amount: '30', account_id: bank.id });
  await api.delete(`/api/transactions/${expense.id}`);

  assert.equal((await api.delete(`/api/transactions/${expense.id}`)).status, 404);
  const edit = await api.patch(`/api/transactions/${expense.id}`, { amount: '99' });
  assert.equal(edit.status, 404);
  assert.equal((await Transaction.findById(expense.id)).amount.toString(), '30.00');
});

test('two simultaneous deletes: exactly one succeeds', async () => {
  const { user, bank, api } = await setup();
  const expense = await record(user, { type: 'expense', amount: '30', account_id: bank.id });

  const results = await Promise.all([
    api.delete(`/api/transactions/${expense.id}`),
    api.delete(`/api/transactions/${expense.id}`),
    api.delete(`/api/transactions/${expense.id}`),
  ]);

  assert.deepEqual(results.map((r) => r.status).sort(), [200, 404, 404]);
  assert.equal(await AuditLog.countDocuments({ entity_id: expense.id, action: 'soft_delete' }), 1);
});

test('deleting keeps tags and receipt attachments, and restoring brings them back', async () => {
  const { user, bank, api } = await setup();
  const expense = await record(user, { type: 'expense', amount: '80', account_id: bank.id, tags: ['trip', 'food'] });
  await addAttachment(user, expense.id);

  await api.delete(`/api/transactions/${expense.id}`);
  assert.equal(await TransactionTag.countDocuments({ transaction_id: expense.id }), 2);
  assert.equal(await Attachment.countDocuments({ transaction_id: expense.id }), 1);
  const inBin = (await api.get('/api/transactions/recycle-bin')).body.items[0];
  assert.deepEqual([...inBin.tags].sort(), ['food', 'trip']);

  const restored = await api.post(`/api/transactions/${expense.id}/restore`);
  assert.equal(restored.status, 200);
  assert.deepEqual([...restored.body.data.tags].sort(), ['food', 'trip']);
  assert.equal(await Attachment.countDocuments({ transaction_id: expense.id }), 1);
});

// ---------------------------------------------------------------------------
// REQ-29 - restore within 30 days
// ---------------------------------------------------------------------------

test('UT_20: restoring re-applies the balance and budget at once and empties the bin', async () => {
  const { user, bank, api } = await setup();
  const expense = await record(user, { type: 'expense', amount: '500', account_id: bank.id });
  const spent = await overallBudget(user);
  await api.delete(`/api/transactions/${expense.id}`);

  const res = await api.post(`/api/transactions/${expense.id}/restore`);

  assert.equal(res.status, 200);
  assert.equal(res.body.message, 'Transaction restored successfully.');
  assert.equal(res.body.data.amount, '500.00');
  assert.equal((await balancesOf(user))[bank.id], '9500.00');
  assert.equal(await spent(), '500.00');
  assert.deepEqual((await api.get('/api/transactions/recycle-bin')).body.items, []);

  const stored = await Transaction.findById(expense.id);
  assert.equal(stored.is_deleted, false);
  assert.equal(stored.deleted_at, null);

  // A live transaction cannot be "restored" again, and it can be edited again.
  assert.equal((await api.post(`/api/transactions/${expense.id}/restore`)).status, 404);
  assert.equal((await api.patch(`/api/transactions/${expense.id}`, { amount: '600' })).status, 200);
});

test('restoring a transfer re-applies both sides', async () => {
  const { user, bank, api } = await setup();
  const cash = await createAccount(user, { type: 'cash', opening_balance: '0.00' });
  const transfer = await record(user, { type: 'transfer', amount: '700', from_account_id: bank.id, to_account_id: cash.id });
  await api.delete(`/api/transactions/${transfer.id}`);

  const res = await api.post(`/api/transactions/${transfer.id}/restore`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.type, 'transfer');
  const balances = await balancesOf(user);
  assert.equal(balances[bank.id], '9300.00');
  assert.equal(balances[cash.id], '700.00');
});

test('the 30-day window: 29 days is still restorable, 31 days is not (410) and is hidden from the bin', async () => {
  const { user, bank, api } = await setup();
  const recent = await record(user, { type: 'expense', amount: '100', account_id: bank.id });
  const stale = await record(user, { type: 'expense', amount: '200', account_id: bank.id });
  await api.delete(`/api/transactions/${recent.id}`);
  await api.delete(`/api/transactions/${stale.id}`);
  await Transaction.updateOne({ _id: recent.id }, { deleted_at: daysAgo(29) });
  await Transaction.updateOne({ _id: stale.id }, { deleted_at: daysAgo(31) });

  assert.deepEqual((await api.get('/api/transactions/recycle-bin')).body.items.map((i) => i.id), [recent.id]);

  const tooLate = await api.post(`/api/transactions/${stale.id}/restore`);
  assert.equal(tooLate.status, 410);
  assert.match(tooLate.body.message, /30-day restore period has ended/);
  assert.equal((await balancesOf(user))[bank.id], '10000.00', 'expired record does not come back');
  assert.equal((await Transaction.findById(stale.id)).is_deleted, true);

  assert.equal((await api.post(`/api/transactions/${recent.id}/restore`)).status, 200);
  assert.equal((await balancesOf(user))[bank.id], '9900.00');
});

test('ST_13: an expired TRANSFER cannot be restored either', async () => {
  const { user, bank, api } = await setup();
  const cash = await createAccount(user, { type: 'cash' });
  const transfer = await record(user, { type: 'transfer', amount: '10', from_account_id: bank.id, to_account_id: cash.id });
  await api.delete(`/api/transactions/${transfer.id}`);
  await Transfer.updateOne({ _id: transfer.id }, { deleted_at: daysAgo(45) });

  assert.equal((await api.post(`/api/transactions/${transfer.id}/restore`)).status, 410);
  assert.equal((await balancesOf(user))[bank.id], '10000.00');
});

test('the recycle bin lists newest deletions first and only the caller\'s items', async () => {
  const { user, bank, api } = await setup();
  const a = await record(user, { type: 'expense', amount: '1', account_id: bank.id });
  const b = await record(user, { type: 'expense', amount: '2', account_id: bank.id });
  await api.delete(`/api/transactions/${a.id}`);
  await new Promise((r) => setTimeout(r, 15));
  await api.delete(`/api/transactions/${b.id}`);

  assert.deepEqual((await api.get('/api/transactions/recycle-bin')).body.items.map((i) => i.id), [b.id, a.id]);

  const stranger = await createUser();
  assert.deepEqual((await apiAs(stranger).get('/api/transactions/recycle-bin')).body.items, []);
});

// ---------------------------------------------------------------------------
// REQ-29 - permanent purge after 30 days
// ---------------------------------------------------------------------------

test('ST_13: the purge removes expired records with their tags and attachments and keeps everything else', async () => {
  await purgeExpired(); // the purge is global: clear expired records left by earlier tests
  const { user, bank, api } = await setup();
  const cash = await createAccount(user, { type: 'cash' });
  const expired = await record(user, { type: 'expense', amount: '10', account_id: bank.id, tags: ['old'] });
  const expiredTransfer = await record(user, { type: 'transfer', amount: '20', from_account_id: bank.id, to_account_id: cash.id });
  const recentlyDeleted = await record(user, { type: 'expense', amount: '30', account_id: bank.id, tags: ['new'] });
  const live = await record(user, { type: 'expense', amount: '40', account_id: bank.id, tags: ['live'] });
  await addAttachment(user, expired.id);
  await addAttachment(user, recentlyDeleted.id);
  await addAttachment(user, live.id);

  for (const id of [expired.id, expiredTransfer.id, recentlyDeleted.id]) await api.delete(`/api/transactions/${id}`);
  await Transaction.updateOne({ _id: expired.id }, { deleted_at: daysAgo(31) });
  await Transfer.updateOne({ _id: expiredTransfer.id }, { deleted_at: daysAgo(40) });
  await Transaction.updateOne({ _id: recentlyDeleted.id }, { deleted_at: daysAgo(5) });

  const result = await purgeExpired();

  assert.deepEqual(result, { transactions: 1, transfers: 1, attachments: 1 });
  assert.equal(await Transaction.countDocuments({ _id: expired.id }), 0);
  assert.equal(await Transfer.countDocuments({ _id: expiredTransfer.id }), 0);
  assert.equal(await TransactionTag.countDocuments({ transaction_id: expired.id }), 0, 'no orphaned tag links');
  assert.equal(await Attachment.countDocuments({ transaction_id: expired.id }), 0, 'no orphaned attachment records');

  // Untouched: recently deleted (still restorable) and live records.
  assert.equal(await Transaction.countDocuments({ _id: { $in: [recentlyDeleted.id, live.id] } }), 2);
  assert.equal(await TransactionTag.countDocuments({ transaction_id: { $in: [recentlyDeleted.id, live.id] } }), 2);
  assert.equal(await Attachment.countDocuments({ transaction_id: { $in: [recentlyDeleted.id, live.id] } }), 2);
  assert.equal((await api.post(`/api/transactions/${recentlyDeleted.id}/restore`)).status, 200);

  // A purged record is gone for good.
  assert.equal((await api.post(`/api/transactions/${expired.id}/restore`)).status, 404);
  assert.equal(await AuditLog.countDocuments({ action: 'purge', entity_id: { $in: [expired.id, expiredTransfer.id] } }), 2);

  // Safe to run again.
  assert.deepEqual(await purgeExpired(), { transactions: 0, transfers: 0, attachments: 0 });
});

// ---------------------------------------------------------------------------
// Audit trail and account safety
// ---------------------------------------------------------------------------

test('delete and restore are written to the audit log with the actor', async () => {
  const { user, bank, api } = await setup();
  const expense = await record(user, { type: 'expense', amount: '5', account_id: bank.id });

  await api.delete(`/api/transactions/${expense.id}`);
  await api.post(`/api/transactions/${expense.id}/restore`);

  const entries = await AuditLog.find({ entity_id: expense.id }).sort({ timestamp: 1 }).lean();
  assert.deepEqual(entries.map((e) => e.action), ['soft_delete', 'restore']);
  assert.ok(entries.every((e) => String(e.user_id) === user.id && e.entity_type === 'transaction'));
});

test('an account whose only transactions are in the recycle bin cannot be deleted (they must stay restorable)', async () => {
  const { user, api } = await setup();
  const account = await createAccount(user, { opening_balance: '0.00' });
  const expense = await record(user, { type: 'expense', amount: '5', account_id: account.id });
  await api.delete(`/api/transactions/${expense.id}`);

  const res = await api.delete(`/api/accounts/${account.id}`);

  assert.ok([400, 409].includes(res.status), `status ${res.status}`);
  assert.equal(await (await import('../src/models/Account.js')).default.countDocuments({ _id: account.id }), 1);
});

// ---------------------------------------------------------------------------
// Regression: US-08 recording, validation, accounts and budgets still behave
// ---------------------------------------------------------------------------

test('US-08 regression: recording expenses and income, with tags and category, still works', async () => {
  const { user, bank, api } = await setup();
  const category = await createCategory(user);

  const expense = await api.post('/api/transactions', {
    type: 'expense', amount: '12.50', transaction_date: isoDay(), account_id: bank.id,
    category_id: category.id, payment_mode: 'upi', note: ' coffee ', tags: ['Food', 'food', 'daily'],
  });
  assert.equal(expense.status, 201);
  assert.equal(expense.body.message, 'Transaction created successfully.');
  assert.equal(expense.body.data.amount, '12.50');
  assert.equal(expense.body.data.note, 'coffee');
  // "Food" and "food" are the same tag: one is kept (this request used to fail with a 500).
  assert.deepEqual(expense.body.data.tags, ['Food', 'daily']);
  assert.equal(await TransactionTag.countDocuments({ transaction_id: expense.body.data.id }), 2);

  const income = await api.post('/api/transactions', {
    type: 'income', amount: '100', transaction_date: isoDay(), account_id: bank.id,
  });
  assert.equal(income.status, 201);
  assert.equal(income.body.data.payment_mode, 'other');

  assert.equal((await balancesOf(user))[bank.id], '10087.50');

  // The tag helper is shared with edits: a second transaction re-uses the same Tag rows.
  await record(user, { type: 'expense', amount: '1', account_id: bank.id, tags: ['FOOD'] });
  assert.equal(await (await import('../src/models/Tag.js')).default.countDocuments({ user_id: user._id, name: /^food$/i }), 1);
});

test('US-08 regression: create-time validation is unchanged', async () => {
  const { user, bank, api } = await setup();
  const other = await createUser();
  const theirs = await createAccount(other);
  const base = { type: 'expense', amount: '10', transaction_date: isoDay(), account_id: bank.id };

  const bad = await api.post('/api/transactions', { ...base, amount: '0' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.message, 'Invalid transaction details.');
  assert.equal(bad.body.errors.amount, 'Enter an amount greater than 0 with up to 2 decimal places.');

  assert.equal((await api.post('/api/transactions', { ...base, transaction_date: isoDay(2) })).status, 400);
  assert.equal((await api.post('/api/transactions', { ...base, account_id: theirs.id })).status, 404);
  assert.equal((await api.post('/api/transactions', { ...base, category_id: '507f1f77bcf86cd799439011' })).status, 400);
  assert.equal((await api.post('/api/transactions', { ...base, type: 'bogus' })).status, 400);
  assert.equal(await Transaction.countDocuments({ user_id: user._id }), 0);
});

test('US-07 / US-14 regression: account summary, net worth and budgets agree with the transaction list', async () => {
  const { user, bank, api } = await setup();
  const spent = await overallBudget(user, '1000');
  await record(user, { type: 'expense', amount: '250', account_id: bank.id });
  const gone = await record(user, { type: 'expense', amount: '100', account_id: bank.id });
  await api.delete(`/api/transactions/${gone.id}`);

  const summary = (await api.get('/api/accounts/summary')).body;
  assert.equal(summary.net_worth.net_worth, '9750.00');
  assert.equal(await spent(), '250.00');
  const budgets = (await api.get('/api/budgets')).body.budgets;
  assert.equal(budgets[0].percent_used, 25);
});
