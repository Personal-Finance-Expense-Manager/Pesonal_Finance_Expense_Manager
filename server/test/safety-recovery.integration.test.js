import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { startApi, stopApi, createUser, createAccount, createCategory, apiAs, record, isoDay, balancesOf } from './helpers/integration.js';
import FinancialOperation from '../src/models/FinancialOperation.js';
import Goal from '../src/models/Goal.js';
import GoalContribution from '../src/models/GoalContribution.js';
import Transaction from '../src/models/Transaction.js';
import Account from '../src/models/Account.js';
import Budget from '../src/models/Budget.js';
import Category from '../src/models/Category.js';
import Reminder from '../src/models/Reminder.js';
import RecurringRule from '../src/models/RecurringRule.js';
import { reconcileFinancialOperation, withFinancialOperation, saveOperationIntent } from '../src/services/financialOperationService.js';
import { softDeleteResource, restoreResource } from '../src/services/resourceRecoveryService.js';
import { backupIsDue } from '../src/services/backupScheduler.js';
import { assertIsolatedTestDatabase } from './helpers/testIsolation.js';

before(startApi);
after(stopApi);

test('test database safety rejects development names, missing run IDs and mismatched run ownership', () => {
  for (const [uri, token] of [['mongodb://localhost/pfem', 'a'.repeat(24)], ['mongodb://localhost/pfem_test', undefined], ['mongodb://localhost/pfem_us29_test_' + 'a'.repeat(24), 'b'.repeat(24)]]) {
    assert.throws(() => assertIsolatedTestDatabase(uri, token), /Refusing destructive tests/);
  }
});

test('SAF-4 polling begins at 23h45m so polling itself does not extend the daily deadline', () => {
  const created = new Date('2026-01-01T00:00:00Z');
  assert.equal(backupIsDue(created, +created + 23.75 * 3600000 - 1), false);
  assert.equal(backupIsDue(created, +created + 23.75 * 3600000), true);
});

async function crashChild(user, goal, account, stage) {
  const source = `
    import mongoose from 'mongoose';
    import { withFinancialOperation, saveOperationIntent } from './src/services/financialOperationService.js';
    import Goal from './src/models/Goal.js';
    import GoalContribution from './src/models/GoalContribution.js';
    import Transaction from './src/models/Transaction.js';
    await mongoose.connect(process.env.TEST_MONGO_URI);
    const userId = new mongoose.Types.ObjectId('${user.id}');
    await withFinancialOperation(userId, '${stage === 'import' ? 'import' : 'goal'}', async () => {
      const recordId = new mongoose.Types.ObjectId();
      if ('${stage}' === 'import') {
        await saveOperationIntent({ transactions: [recordId] });
        await Transaction.create({ _id: recordId, user_id: userId, account_id: '${account.id}', type: 'income', amount: '10', currency: 'INR', transaction_date: new Date() });
        process.exit(17);
      }
      const op = await saveOperationIntent({ goal_id: '${goal.id}', record_id: recordId, record_model: 'GoalContribution', delta: '10.00' });
      await Goal.updateOne({ _id: '${goal.id}' }, { $inc: { saved_amount: mongoose.Types.Decimal128.fromString('10.00') }, $set: { safety_operation_id: op._id } });
      if ('${stage}' === 'goal-update') process.exit(17);
      await GoalContribution.create({ _id: recordId, user_id: userId, goal_id: '${goal.id}', source_account_id: '${account.id}', amount: '10.00', contribution_date: new Date() });
      if ('${stage}' === 'committed') { op.state = 'committed'; await op.save(); }
      process.exit(17);
    });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: process.env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 17, stderr);
}

for (const stage of ['goal-update', 'goal-record', 'committed', 'import']) {
  test(`SAF-5 real child-process interruption at ${stage}: durable reconciliation is idempotent and owner data is gated`, async () => {
    const user = await createUser('crash');
    const other = await createUser('unaffected');
    const account = await createAccount(user);
    const goal = await Goal.create({ user_id: user._id, name: 'Recovery fixture', target_amount: '200', saved_amount: '100.00' });
    await crashChild(user, goal, account, stage);
    const operation = await FinancialOperation.findOne({ user_id: user._id });
    assert.ok(operation, 'journal survived process termination');
    assert.equal((await apiAs(user).get('/api/accounts')).status, 503);
    assert.equal((await apiAs(other).get('/api/accounts')).status, 200);
    await reconcileFinancialOperation(operation);
    await reconcileFinancialOperation(operation);
    assert.equal(await FinancialOperation.countDocuments({ user_id: user._id }), 0);
    const saved = await Goal.findById(goal._id);
    assert.equal(saved.saved_amount.toString(), stage === 'committed' ? '110.00' : '100.00');
    assert.equal(await GoalContribution.countDocuments({ user_id: user._id }), stage === 'committed' ? 1 : 0);
    assert.equal(await Transaction.countDocuments({ user_id: user._id }), 0);
    assert.equal((await apiAs(user).get('/api/accounts')).status, 200);
  });
}

test('SAF-5 journal acquisition failure never executes the financial write', async () => {
  const user = await createUser();
  await FinancialOperation.create({ user_id: user._id, kind: 'import' });
  let called = false;
  await assert.rejects(withFinancialOperation(user.id, 'import', async () => { called = true; }), { status: 503 });
  assert.equal(called, false);
  const execute = promisify(execFile);
  const env = { ...process.env, MONGO_URI: process.env.TEST_MONGO_URI };
  const inventory = await execute(process.execPath, ['scripts/reconcile-financial.js'], { env });
  assert.match(inventory.stdout, /"pending_operations":1,"apply":false/);
  assert.equal(await FinancialOperation.countDocuments({ user_id: user._id }), 1, 'read-only CLI leaves the journal intact');
  await assert.rejects(execute(process.execPath, ['scripts/reconcile-financial.js', '--apply'], { env }), /Command failed/);
  assert.equal(await FinancialOperation.countDocuments({ user_id: user._id }), 1, 'CLI refuses writes without the offline acknowledgement');
  await reconcileFinancialOperation(await FinancialOperation.findOne({ user_id: user._id }));
});

test('SAF-5 failures after a goal update lost its acknowledgement are compensated from the marker', async (t) => {
  const user = await createUser();
  const goal = await Goal.create({ user_id: user._id, name: 'Lost ack', target_amount: '200', saved_amount: '100.00' });
  await assert.rejects(withFinancialOperation(user.id, 'goal', async () => {
    const operation = await saveOperationIntent({ goal_id: goal._id, record_id: new mongoose.Types.ObjectId(), record_model: 'GoalContribution', delta: '10.00' });
    await Goal.updateOne({ _id: goal._id }, { $inc: { saved_amount: mongoose.Types.Decimal128.fromString('10.00') }, $set: { safety_operation_id: operation._id } });
    throw new Error('lost acknowledgement');
  }), /lost acknowledgement/);
  assert.equal((await Goal.findById(goal._id)).saved_amount.toString(), '100.00');
});

test('SAF-3 funded goal soft deletion and restoration preserve every account balance and ledger record', async () => {
  const user = await createUser();
  const account = await createAccount(user);
  const goal = await Goal.create({ user_id: user._id, name: 'Funded', target_amount: '500', saved_amount: '100.00' });
  await GoalContribution.create({ user_id: user._id, goal_id: goal._id, source_account_id: account._id, amount: '100', contribution_date: new Date() });
  const balances = await balancesOf(user);
  assert.equal((await apiAs(user).delete(`/api/goals/${goal.id}?confirm=true`)).status, 200);
  assert.equal(await Goal.findById(goal._id), null);
  assert.equal(await GoalContribution.countDocuments({ goal_id: goal._id }), 1);
  assert.deepEqual(await balancesOf(user), balances);
  assert.equal((await apiAs(user).post(`/api/recovery/goals/${goal.id}/restore`)).status, 200);
  assert.deepEqual(await balancesOf(user), balances);
});

test('SAF-3 categories retain transaction associations across deletion and recovery', async () => {
  const user = await createUser();
  const account = await createAccount(user);
  const category = await createCategory(user);
  const transaction = await record(user, { type: 'expense', account_id: account.id, category_id: category.id, amount: '5' });
  assert.equal((await apiAs(user).delete(`/api/categories/${category.id}?confirm=true`)).status, 200);
  assert.equal(String((await Transaction.findById(transaction.id)).category_id), category.id);
  assert.equal((await apiAs(user).post(`/api/recovery/categories/${category.id}/restore`)).status, 200);
  assert.equal(String((await Transaction.findById(transaction.id)).category_id), category.id);
});

test('SAF-3/8 each recovery type is owner scoped and expires after exactly 30 days', async () => {
  const user = await createUser();
  const other = await createUser();
  const account = await createAccount(user);
  const docs = [
    ['accounts', Account, account],
    ['categories', Category, await createCategory(user)],
    ['budgets', Budget, await Budget.create({ user_id: user._id, amount: '100', period_type: 'monthly', period_start: new Date('2026-01-01'), period_end: new Date('2026-01-31') })],
    ['goals', Goal, await Goal.create({ user_id: user._id, name: 'Goal', target_amount: '100' })],
    ['reminders', Reminder, await Reminder.create({ user_id: user._id, name: 'Bill', amount: '10', due_date: new Date() })],
    ['recurring-rules', RecurringRule, await RecurringRule.create({ user_id: user._id, account_id: account._id, amount: '10', type: 'expense', frequency: 'monthly', anchor_date: new Date(), start_date: new Date(), next_due_date: new Date() })],
  ];
  const deleted = new Date();
  for (const [resource, Model, doc] of docs) {
    await softDeleteResource(doc, deleted);
    assert.equal(await Model.findById(doc._id), null);
    assert.equal((await apiAs(other).post(`/api/recovery/${resource}/${doc.id}/restore`)).status, 404);
    if (resource === 'recurring-rules') {
      // Old versions retained status=deleted without the new tombstone field.
      await Model.collection.updateOne({ _id: doc._id }, { $set: { status: 'deleted' }, $unset: { is_deleted: '' } });
      const listing = await apiAs(user).get('/api/recovery');
      assert.ok(listing.body.items.some((item) => item.id === doc.id));
    }
    await assert.rejects(restoreResource(user.id, resource, doc.id, new Date(+deleted + 30 * 86400000 + 1)), { status: 404 });
    await restoreResource(user.id, resource, doc.id, new Date(+deleted + 30 * 86400000));
    assert.ok(await Model.findById(doc._id));
    if (resource === 'recurring-rules') assert.equal((await Model.findById(doc._id)).status, 'paused');
  }
});

test('SAF-3 an account name reused after deletion blocks conflicting restoration', async () => {
  const user = await createUser();
  const deleted = await createAccount(user, { name: 'Bank' });
  assert.equal((await apiAs(user).delete(`/api/accounts/${deleted.id}?confirm=true`)).status, 200);
  assert.ok(await Account.findById(deleted._id).withDeleted());
  await createAccount(user, { name: 'Bank' });
  assert.equal((await apiAs(user).post(`/api/recovery/accounts/${deleted.id}/restore`)).status, 409);
});

test('SAF-3 deletion endpoints retain recoverable budgets and reminders instead of destroying documents', async () => {
  const user = await createUser();
  const budget = await Budget.create({ user_id: user._id, amount: '10', period_type: 'monthly', period_start: new Date('2026-02-01'), period_end: new Date('2026-02-28') });
  const reminder = await Reminder.create({ user_id: user._id, name: 'Rent', due_date: new Date() });
  for (const [path, resource, Model, doc] of [['budgets', 'budgets', Budget, budget], ['bill-reminders', 'reminders', Reminder, reminder]]) {
    assert.equal((await apiAs(user).delete(`/api/${path}/${doc.id}`)).status, 200);
    assert.equal(await Model.findById(doc._id), null);
    assert.ok((await Model.findById(doc._id).withDeleted()).deleted_at);
    assert.equal((await apiAs(user).post(`/api/recovery/${resource}/${doc.id}/restore`)).status, 200);
    assert.ok(await Model.findById(doc._id));
  }
});

test('SAF-5 cleanup failure leaves a durable journal and the user unavailable until offline reconciliation succeeds', async (t) => {
  const user = await createUser();
  const account = await createAccount(user);
  const goal = await Goal.create({ user_id: user._id, name: 'Failed cleanup', target_amount: '200', saved_amount: '100.00' });
  await crashChild(user, goal, account, 'goal-record');
  const operation = await FinancialOperation.findOne({ user_id: user._id });
  const deletion = t.mock.method(GoalContribution, 'deleteOne', async () => { throw new Error('database unavailable'); });
  await assert.rejects(reconcileFinancialOperation(operation), /database unavailable/);
  assert.equal((await apiAs(user).get('/api/accounts')).status, 503);
  assert.ok(await FinancialOperation.findById(operation._id));
  deletion.mock.restore();
  await reconcileFinancialOperation(operation);
  assert.equal((await Goal.findById(goal._id)).saved_amount.toString(), '100.00');
  assert.equal((await apiAs(user).get('/api/accounts')).status, 200);
  const createFailure = t.mock.method(GoalContribution, 'create', async () => { throw new Error('write failed'); });
  const cleanupFailure = t.mock.method(Goal, 'updateOne', () => ({ withDeleted: async () => { throw new Error('cleanup failed'); } }));
  const response = await apiAs(user).post(`/api/goals/${goal.id}/contributions`, { amount: '10', source_account_id: account.id });
  assert.equal(response.status, 503);
  assert.match(response.body.message, /reconciliation/);
  createFailure.mock.restore();
  cleanupFailure.mock.restore();
  await reconcileFinancialOperation(await FinancialOperation.findOne({ user_id: user._id }));
  assert.equal((await Goal.findById(goal._id)).saved_amount.toString(), '100.00');
});
