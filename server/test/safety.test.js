import { test, beforeEach } from 'node:test';
import FinancialOperation from '../src/models/FinancialOperation.js';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Goal from '../src/models/Goal.js';
import GoalContribution from '../src/models/GoalContribution.js';
import GoalWithdrawal from '../src/models/GoalWithdrawal.js';
import Account from '../src/models/Account.js';
import Category from '../src/models/Category.js';
import Transaction from '../src/models/Transaction.js';
import Transfer from '../src/models/Transfer.js';
import TransactionTag from '../src/models/TransactionTag.js';
import { deleteGoal, withdrawFromGoal, contributeToGoal } from '../src/services/goalService.js';
import { commitImport, rollback } from '../src/services/importService.js';
import accountsRouter from '../src/routes/accounts.js';
import { retentionDays } from '../src/services/backupService.js';

const id = () => new mongoose.Types.ObjectId();
const query = (value) => ({ select() { return this; }, lean: async () => value });

beforeEach((t) => {
  let operation;
  t.mock.method(FinancialOperation, 'create', async (data) => {
    operation = { _id: id(), state: 'pending', transactions: [], transfers: [], links: [], ...data, save: async () => {} };
    return operation;
  });
  t.mock.method(FinancialOperation, 'findById', async () => operation);
  t.mock.method(FinancialOperation, 'deleteOne', async () => ({}));
});

test('SAF-4 backup retention cannot be configured below seven days', (t) => {
  const original = process.env.BACKUP_RETENTION_DAYS;
  t.after(() => {
    if (original === undefined) delete process.env.BACKUP_RETENTION_DAYS;
    else process.env.BACKUP_RETENTION_DAYS = original;
  });
  for (const value of ['1', '0', '-1', '6.9', 'NaN', 'Infinity', '7']) {
    process.env.BACKUP_RETENTION_DAYS = value;
    assert.equal(retentionDays(), 7, value);
  }
});

test('SAF-5 failed contribution cleans up a possibly persisted ledger record and reverses the amount', async (t) => {
  const userId = id();
  const goal = { _id: id(), saved_amount: '0.00', status: 'active' };
  const account = { _id: id(), type: 'bank', currency: 'INR', opening_balance: '1000.00' };
  t.mock.method(Goal, 'findOne', async () => goal);
  t.mock.method(Account, 'findOne', async () => account);
  t.mock.method(Account, 'find', () => query([account]));
  for (const Model of [Transaction, Transfer, GoalContribution, GoalWithdrawal]) {
    t.mock.method(Model, 'aggregate', async () => []);
  }
  t.mock.method(Goal, 'findOneAndUpdate', async (filter, pipeline) => {
    assert.equal(filter.user_id, userId);
    assert.equal(pipeline[0].$set.saved_amount.$add[1].toString(), '20.00');
    assert.ok(pipeline[1].$set.status.$cond);
    return goal;
  });
  let recordId;
  const failure = new Error('lost acknowledgement');
  t.mock.method(GoalContribution, 'create', async (record) => { recordId = record._id; throw failure; });
  const remove = t.mock.method(GoalContribution, 'deleteOne', async (filter) => {
    assert.equal(filter._id, recordId);
    assert.equal(filter.user_id, userId);
  });
  const compensate = t.mock.method(Goal, 'updateOne', (filter, pipeline) => {
    assert.equal(filter.user_id, userId);
    assert.equal(pipeline[0].$set.saved_amount.$add[1].toString(), '-20.00');
    return { withDeleted: async () => ({ matchedCount: 1 }) };
  });
  await assert.rejects(contributeToGoal(userId, String(goal._id), { amount: '20', source_account_id: String(account._id) }), failure);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(compensate.mock.callCount(), 1);
});

for (const kind of ['contribution', 'withdrawal']) {
  test(`SAF-3 account used only by a goal ${kind} is retained and archiving is offered`, async (t) => {
    const userId = String(id());
    const account = { _id: id(), deleteOne: t.mock.fn() };
    t.mock.method(Account, 'findOne', async (filter) => {
      assert.equal(filter.user_id, userId);
      return account;
    });
    for (const Model of [Transaction, Transfer]) t.mock.method(Model, 'exists', async () => null);
    t.mock.method(GoalContribution, 'exists', async (filter) => {
      assert.equal(filter.user_id, userId);
      assert.equal(filter.source_account_id, account._id);
      return kind === 'contribution' ? { _id: id() } : null;
    });
    t.mock.method(GoalWithdrawal, 'exists', async (filter) => {
      assert.equal(filter.user_id, userId);
      assert.equal(filter.destination_account_id, account._id);
      return kind === 'withdrawal' ? { _id: id() } : null;
    });
    const route = accountsRouter.stack.find((layer) => layer.route?.methods.delete).route;
    let status;
    let body;
    const response = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
    await route.stack[0].handle({ params: { id: String(account._id) }, user: { id: userId }, query: { confirm: 'true' } }, response, (error) => { throw error; });
    assert.equal(status, 409);
    assert.equal(body.canArchive, true);
    assert.equal(account.deleteOne.mock.callCount(), 0);
  });
}

for (const kind of ['savings', 'contribution', 'withdrawal']) {
  test(`SAF-3 goal deletion preserves ${kind} and never removes ledger history`, async (t) => {
    const userId = id();
    const goal = { _id: id(), saved_amount: kind === 'savings' ? '1.00' : '0.00', save: t.mock.fn(async () => {}) };
    t.mock.method(Goal, 'findOne', async () => goal);
    t.mock.method(GoalContribution, 'exists', async (filter) => {
      assert.equal(filter.user_id, userId);
      return kind === 'contribution' ? { _id: id() } : null;
    });
    t.mock.method(GoalWithdrawal, 'exists', async () => kind === 'withdrawal' ? { _id: id() } : null);
    await deleteGoal(userId, String(goal._id));
    assert.equal(goal.is_deleted, true);
    assert.ok(goal.deleted_at instanceof Date);
    assert.equal(goal.save.mock.callCount(), 1);
  });
}

test('SAF-3 empty goal without financial history can be deleted', async (t) => {
  const goal = { _id: id(), saved_amount: '0.00', save: t.mock.fn(async () => {}) };
  t.mock.method(Goal, 'findOne', async () => goal);
  t.mock.method(GoalContribution, 'exists', async () => null);
  t.mock.method(GoalWithdrawal, 'exists', async () => null);
  assert.deepEqual(await deleteGoal(id(), String(goal._id)), { id: String(goal._id) });
  assert.equal(goal.save.mock.callCount(), 1);
});

for (const cleanupFails of [false, true]) {
  test(`SAF-5 withdrawal lost acknowledgement: cleanup ${cleanupFails ? 'failure is explicit' : 'uses the known record ID and restores savings'}`, async (t) => {
    const userId = id();
    const goal = { _id: id(), saved_amount: '100.00', status: 'completed' };
    const account = { _id: id(), type: 'bank' };
    let recordId;
    const writeFailure = new Error('lost acknowledgement');
    t.mock.method(Goal, 'findOne', async () => goal);
    t.mock.method(Account, 'findOne', async () => account);
    t.mock.method(Goal, 'findOneAndUpdate', async (filter, pipeline) => {
      assert.equal(filter.user_id, userId);
      assert.equal(pipeline[0].$set.saved_amount.$add[1].toString(), '-20.00');
      assert.ok(pipeline[1].$set.status.$cond);
      return goal;
    });
    t.mock.method(GoalWithdrawal, 'create', async (record) => { recordId = record._id; throw writeFailure; });
    t.mock.method(GoalWithdrawal, 'deleteOne', async (filter) => {
      assert.equal(filter._id, recordId);
      assert.equal(filter.user_id, userId);
      if (cleanupFails) throw new Error('database unavailable');
    });
    const compensate = t.mock.method(Goal, 'updateOne', (filter, pipeline) => {
      assert.equal(filter.user_id, userId);
      assert.equal(pipeline[0].$set.saved_amount.$add[1].toString(), '20.00');
      return { withDeleted: async () => ({ matchedCount: 1 }) };
    });
    await assert.rejects(withdrawFromGoal(userId, String(goal._id), { amount: '20', destination_account_id: String(account._id) }),
      cleanupFails ? { status: 503, message: /reconciliation/i } : writeFailure);
    assert.equal(compensate.mock.callCount(), cleanupFails ? 0 : 1);
  });
}

test('SAF-5 partial ordered CSV insert is removed using IDs assigned before the write', async (t) => {
  const userId = id();
  const account = { _id: id(), name: 'Bank', currency: 'INR', is_archived: false };
  t.mock.method(Account, 'find', () => query([account]));
  t.mock.method(Category, 'find', () => query([]));
  t.mock.method(Transaction, 'find', () => query([]));
  t.mock.method(Transfer, 'find', () => query([]));
  let attempted;
  const failure = new Error('ordered insert failed after first row');
  t.mock.method(Transaction, 'insertMany', async (docs) => { attempted = docs; throw failure; });
  const removed = t.mock.method(Transaction, 'deleteMany', async (filter) => {
    assert.equal(filter.user_id, userId);
    assert.deepEqual(filter._id.$in, attempted.map((doc) => doc._id));
  });
  t.mock.method(TransactionTag, 'deleteMany', async () => ({}));
  await assert.rejects(commitImport(userId, { csv: 'date,type,amount,account\n2026-01-01,income,10,Bank\n2026-01-02,income,20,Bank' }), failure);
  assert.equal(attempted.length, 2);
  assert.equal(removed.mock.callCount(), 1);
});

test('SAF-5 import cleanup attempts every collection even when one cleanup fails', async (t) => {
  const userId = id();
  const links = t.mock.method(TransactionTag, 'deleteMany', async () => { throw new Error('unavailable'); });
  const transactions = t.mock.method(Transaction, 'deleteMany', async () => ({}));
  const transfers = t.mock.method(Transfer, 'deleteMany', async () => ({}));
  await assert.rejects(rollback(userId, { transactions: [id()], transfers: [id()], links: [id()] }), { status: 503 });
  assert.equal(links.mock.callCount(), 2);
  assert.equal(transactions.mock.callCount(), 1);
  assert.equal(transfers.mock.callCount(), 1);
});
