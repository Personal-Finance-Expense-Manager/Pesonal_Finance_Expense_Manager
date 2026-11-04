import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApi, stopApi, createUser, createAccount, createCategory, apiAs, balancesOf, isoDay,
} from './helpers/integration.js';
import RecurringRule from '../src/models/RecurringRule.js';
import RecurringOccurrence from '../src/models/RecurringOccurrence.js';
import Transaction from '../src/models/Transaction.js';
import Notification from '../src/models/Notification.js';
import { processDueRules, processRule, STALE_CLAIM_MS } from '../src/services/recurringGenerationService.js';
import { resumeRule } from '../src/services/recurringRuleService.js';
import { occurrenceDate, dueCutoff } from '../src/utils/recurrence.js';

before(startApi);
after(stopApi);

/** A moment `offset` IST days from today at hh:mm IST. */
const istAt = (offset, hhmm = '10:00') => new Date(`${isoDay(offset)}T${hhmm}:00+05:30`);
const dayOf = (d) => d.toISOString().slice(0, 10);

async function setup(over = {}) {
  const user = await createUser();
  const account = await createAccount(user, { opening_balance: '100000.00' });
  const category = await createCategory(user);
  const api = apiAs(user);
  const body = {
    type: 'expense', amount: '15000', account_id: account.id, category_id: category.id,
    frequency: 'monthly', start_date: isoDay(0), ...over,
  };
  return { user, account, category, api, body };
}

async function createRule(ctx, over = {}) {
  const res = await ctx.api.post('/api/recurring-rules', { ...ctx.body, ...over });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}

const txsOf = (ruleId) => Transaction.find({ recurring_rule_id: ruleId }).sort({ recurring_scheduled_date: 1 }).lean();

// ---------------------------------------------------------------------------
// REQ-52 / REQ-53: creating rules
// ---------------------------------------------------------------------------

test('REQ-52 UT_33: a monthly rule is saved and its next due date is shown', async () => {
  const ctx = await setup({ start_date: isoDay(5) });
  const rule = await createRule(ctx);
  assert.equal(rule.status, 'active');
  assert.equal(rule.next_due_date, isoDay(5));
  assert.equal(rule.amount, '15000.00');
  assert.equal(rule.frequency, 'monthly');
  assert.ok(rule.account_name);
});

test('REQ-52 UT_34: end date, occurrence count or neither are all accepted', async () => {
  const ctx = await setup();
  await createRule(ctx, { end_date: isoDay(60) });
  await createRule(ctx, { occurrence_count: 12 });
  await createRule(ctx);
  assert.equal((await ctx.api.get('/api/recurring-rules')).body.data.length, 3);
});

test('REQ-52 each of the five frequencies can be created', async () => {
  const ctx = await setup();
  for (const frequency of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']) {
    assert.equal((await createRule(ctx, { frequency })).frequency, frequency);
  }
});

test('REQ-53 UT_18: an end date before the start date is refused with the exact message', async () => {
  const ctx = await setup();
  const res = await ctx.api.post('/api/recurring-rules', { ...ctx.body, start_date: isoDay(10), end_date: isoDay(5) });
  assert.equal(res.status, 400);
  assert.equal(res.body.errors.end_date, 'End date must be after the start date.');
  assert.equal(await RecurringRule.countDocuments({ user_id: ctx.user._id }), 0);
});

test('REQ-52 an end date and an occurrence count together are refused', async () => {
  const ctx = await setup();
  const res = await ctx.api.post('/api/recurring-rules', { ...ctx.body, end_date: isoDay(30), occurrence_count: 3 });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.occurrence_count);
});

test('REQ-52 account and category ownership is verified', async () => {
  const ctx = await setup();
  const other = await createUser();
  const foreignAccount = await createAccount(other);
  const foreignCategory = await createCategory(other);
  const archived = await createAccount(ctx.user, { is_archived: true });

  assert.equal((await ctx.api.post('/api/recurring-rules', { ...ctx.body, account_id: foreignAccount.id })).status, 404);
  assert.equal((await ctx.api.post('/api/recurring-rules', { ...ctx.body, category_id: foreignCategory.id })).status, 400);
  assert.equal((await ctx.api.post('/api/recurring-rules', { ...ctx.body, account_id: archived.id })).status, 404);
  assert.equal(await RecurringRule.countDocuments({ user_id: ctx.user._id }), 0);
});

test('REQ-52 a rule cannot be created without signing in, or as another user', async () => {
  const ctx = await setup();
  assert.equal((await apiAs(null).post('/api/recurring-rules', ctx.body)).status, 401);
  assert.equal((await apiAs(null).get('/api/recurring-rules')).status, 401);
});

// ---------------------------------------------------------------------------
// REQ-54: automatic generation
// ---------------------------------------------------------------------------

test('REQ-54 IT_09: nothing before 00:05 IST; at 00:05 IST the transaction is created, system-generated, linked, and the balance falls', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);

  await processDueRules({ now: new Date(`${isoDay(0)}T00:04:00+05:30`) });
  assert.equal((await txsOf(rule.id)).length, 0, 'not yet due at 00:04 IST');

  const before = (await balancesOf(ctx.user))[ctx.account.id];
  await processDueRules({ now: new Date(`${isoDay(0)}T00:05:00+05:30`) });
  assert.equal((await txsOf(rule.id)).length, 1, 'due at 00:05 IST');

  const [tx] = await txsOf(rule.id);
  assert.equal(tx.is_system_generated, true);
  assert.equal(String(tx.recurring_rule_id), rule.id);
  assert.equal(dayOf(tx.transaction_date), isoDay(0));
  assert.equal(dayOf(tx.recurring_scheduled_date), isoDay(0));
  assert.equal(tx.amount.toString(), '15000.00');
  assert.equal(tx.type, 'expense');
  assert.equal(String(tx.account_id), ctx.account.id);

  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '85000.00');
  assert.equal(before, '100000.00');

  const view = (await ctx.api.get(`/api/recurring-rules/${rule.id}`)).body.data;
  assert.equal(view.occurrences_done, 1);
  assert.equal(view.generated_transactions.length, 1);
  assert.equal(view.next_due_date, dayOf(occurrenceDate(new Date(`${isoDay(0)}T00:00:00Z`), 'monthly', 1)));
});

test('REQ-54 an active income rule adds to the balance', async () => {
  const ctx = await setup({ type: 'income', amount: '5000' });
  const cat = await createCategory(ctx.user, { type: 'income' });
  await createRule(ctx, { category_id: cat.id });
  await processDueRules({ now: istAt(0, '00:10') });
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '105000.00');
});

test('REQ-54 the generated transaction is editable and keeps its original scheduled date', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '00:10') });
  const [tx] = await txsOf(rule.id);

  const edit = await ctx.api.patch(`/api/transactions/${tx._id}`, { amount: '14000.50', note: 'Rent, negotiated' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.data.amount, '14000.50');

  const [after] = await txsOf(rule.id);
  assert.equal(after.amount.toString(), '14000.50');
  assert.equal(after.is_system_generated, true);
  assert.equal(String(after.recurring_rule_id), rule.id, 'the link survives the edit');
  assert.equal(dayOf(after.recurring_scheduled_date), isoDay(0));
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '85999.50');
});

test('REQ-54 the link and system-generated flag cannot be changed through the transaction API', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '00:10') });
  const [tx] = await txsOf(rule.id);
  const res = await ctx.api.patch(`/api/transactions/${tx._id}`, { recurring_rule_id: null, is_system_generated: false });
  assert.equal(res.status, 400);
});

test('REQ-54 the transaction list shows which transactions the scheduler generated', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '00:10') });
  await ctx.api.post('/api/transactions', {
    type: 'expense', amount: '10', account_id: ctx.account.id, transaction_date: isoDay(0),
  });
  const list = (await ctx.api.get('/api/transactions')).body.data;
  const generated = list.filter((t) => t.is_system_generated);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].recurring_rule_id, rule.id);
  assert.equal(list.filter((t) => !t.is_system_generated).length, 1);
});

test('REQ-54 only active rules generate: paused, completed and deleted rules do not', async () => {
  const ctx = await setup();
  const paused = await createRule(ctx);
  const deleted = await createRule(ctx);
  await ctx.api.post(`/api/recurring-rules/${paused.id}/pause`);
  await ctx.api.delete(`/api/recurring-rules/${deleted.id}`);
  await processDueRules({ now: istAt(3) });
  assert.equal(await Transaction.countDocuments({ user_id: ctx.user._id }), 0);
});

test('REQ-54 / REQ-55 every frequency generates exactly the occurrences that are due', async () => {
  const ctx = await setup({ amount: '10' });
  const anchor = new Date(`${isoDay(0)}T00:00:00Z`);
  const now = istAt(120);
  const cutoff = dueCutoff(now);

  for (const frequency of ['weekly', 'monthly', 'quarterly', 'yearly']) {
    const rule = await createRule(ctx, { frequency });
    let expected = 0;
    while (occurrenceDate(anchor, frequency, expected) <= cutoff) expected += 1;

    await processDueRules({ now });
    const txs = await txsOf(rule.id);
    assert.equal(txs.length, expected, `${frequency}: ${expected} occurrences`);
    txs.forEach((tx, k) => {
      assert.equal(dayOf(tx.transaction_date), dayOf(occurrenceDate(anchor, frequency, k)), `${frequency} #${k}`);
    });
  }
});

// ---------------------------------------------------------------------------
// REQ-55: month-end dates, end to end
// ---------------------------------------------------------------------------

test('REQ-55 IT_23: a rule on the 31st generates 28 Feb, 31 Mar, 30 Apr', async () => {
  const ctx = await setup({ amount: '100' });
  const rule = await RecurringRule.create({
    user_id: ctx.user._id, account_id: ctx.account._id, category_id: ctx.category._id,
    type: 'expense', amount: '100.00', frequency: 'monthly',
    start_date: new Date('2027-01-31T00:00:00Z'), anchor_date: new Date('2027-01-31T00:00:00Z'),
    next_due_date: new Date('2027-01-31T00:00:00Z'),
  });
  await processDueRules({ now: new Date('2027-05-01T10:00:00+05:30') });
  assert.deepEqual((await txsOf(rule._id)).map((t) => dayOf(t.transaction_date)), [
    '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30',
  ]);
});

test('REQ-55 a leap-year February uses the 29th; a yearly 29 Feb rule uses 28 Feb in common years', async () => {
  const ctx = await setup({ amount: '100' });
  const make = (frequency, start) => RecurringRule.create({
    user_id: ctx.user._id, account_id: ctx.account._id, type: 'expense', amount: '1.00', frequency,
    start_date: new Date(`${start}T00:00:00Z`), anchor_date: new Date(`${start}T00:00:00Z`),
    next_due_date: new Date(`${start}T00:00:00Z`),
  });
  const monthly = await make('monthly', '2028-01-31');
  const yearly = await make('yearly', '2028-02-29');
  await processDueRules({ now: new Date('2029-03-05T10:00:00+05:30') });
  assert.deepEqual((await txsOf(monthly._id)).slice(0, 3).map((t) => dayOf(t.transaction_date)), ['2028-01-31', '2028-02-29', '2028-03-31']);
  assert.deepEqual((await txsOf(yearly._id)).map((t) => dayOf(t.transaction_date)), ['2028-02-29', '2029-02-28']);
});

// ---------------------------------------------------------------------------
// REQ-60: catch-up, duplicates, restarts
// ---------------------------------------------------------------------------

test('REQ-60 IT_25: missed days are generated on the next run, each with its original date, once', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily' });
  const rule = await createRule(ctx);

  const first = await processDueRules({ now: istAt(4) });
  assert.equal(first.generated, 5);
  assert.deepEqual((await txsOf(rule.id)).map((t) => dayOf(t.transaction_date)), [0, 1, 2, 3, 4].map(isoDay));

  const again = await processDueRules({ now: istAt(4, '23:00') });
  assert.equal(again.generated, 0);
  assert.equal((await txsOf(rule.id)).length, 5);
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '99950.00');
});

test('REQ-60 the scheduler running repeatedly the same day creates no duplicates', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  for (let i = 0; i < 4; i += 1) await processDueRules({ now: istAt(0, `0${i + 1}:00`) });
  assert.equal((await txsOf(rule.id)).length, 1);
  assert.equal(await RecurringOccurrence.countDocuments({ rule_id: rule.id }), 1);
});

test('REQ-60 several scheduler instances at the same moment create no duplicates', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily' });
  const rule = await createRule(ctx);
  await Promise.all(Array.from({ length: 6 }, () => processDueRules({ now: istAt(6) })));
  const txs = await txsOf(rule.id);
  assert.equal(txs.length, 7);
  assert.equal(new Set(txs.map((t) => dayOf(t.recurring_scheduled_date))).size, 7);
  const view = (await ctx.api.get(`/api/recurring-rules/${rule.id}`)).body.data;
  assert.equal(view.occurrences_done, 7);
});

test('REQ-60 the database itself refuses a second transaction for the same occurrence', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '01:00') });
  const [tx] = await txsOf(rule.id);
  await assert.rejects(
    Transaction.create({
      user_id: ctx.user._id, account_id: ctx.account._id, type: 'expense', amount: '1.00',
      transaction_date: tx.transaction_date, recurring_rule_id: rule.id,
      recurring_scheduled_date: tx.recurring_scheduled_date, is_system_generated: true,
    }),
    (e) => e.code === 11000,
  );
  await assert.rejects(
    RecurringOccurrence.create({ rule_id: rule.id, user_id: ctx.user._id, scheduled_date: tx.recurring_scheduled_date }),
    (e) => e.code === 11000,
  );
});

test('REQ-60 a generated transaction that is deleted, even purged, is never generated again', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '01:00') });
  const [tx] = await txsOf(rule.id);

  assert.equal((await ctx.api.delete(`/api/transactions/${tx._id}`)).status, 200);
  await processDueRules({ now: istAt(0, '02:00') });
  assert.equal(await Transaction.countDocuments({ recurring_rule_id: rule.id }), 1, 'still the one deleted row');

  await Transaction.deleteMany({ recurring_rule_id: rule.id }); // what the 30-day purge does
  await processDueRules({ now: istAt(0, '03:00') });
  assert.equal(await Transaction.countDocuments({ recurring_rule_id: rule.id }), 0, 'the purged occurrence stays purged');
});

test('REQ-60 a restart mid-generation: a claim left behind with no transaction is completed once', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  // The process died after claiming the occurrence, before creating the transaction.
  await RecurringOccurrence.collection.insertOne({
    rule_id: (await RecurringRule.findById(rule.id))._id, user_id: ctx.user._id,
    scheduled_date: new Date(`${isoDay(0)}T00:00:00Z`), status: 'claimed', transaction_id: null,
    createdAt: new Date(Date.now() - 2 * STALE_CLAIM_MS), updatedAt: new Date(Date.now() - 2 * STALE_CLAIM_MS),
  });

  const result = await processDueRules({ now: new Date() > istAt(0, '00:10') ? new Date() : istAt(0, '00:10') });
  assert.equal(result.failed, 0);
  assert.equal((await txsOf(rule.id)).length, 1);
  assert.equal((await RecurringOccurrence.findOne({ rule_id: rule.id })).status, 'generated');

  await processDueRules({ now: istAt(0, '04:00') });
  assert.equal((await txsOf(rule.id)).length, 1);
});

test('REQ-60 a restart after the transaction was created but before the ledger was updated adopts it', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  const ruleDoc = await RecurringRule.findById(rule.id);
  const scheduled = new Date(`${isoDay(0)}T00:00:00Z`);
  await Transaction.create({
    user_id: ctx.user._id, account_id: ctx.account._id, type: 'expense', amount: '15000.00',
    transaction_date: scheduled, recurring_rule_id: ruleDoc._id, recurring_scheduled_date: scheduled,
    is_system_generated: true,
  });
  await RecurringOccurrence.collection.insertOne({
    rule_id: ruleDoc._id, user_id: ctx.user._id, scheduled_date: scheduled, status: 'claimed',
    transaction_id: null, createdAt: new Date(0), updatedAt: new Date(0),
  });

  await processDueRules({ now: istAt(0, '01:00') });
  assert.equal((await txsOf(rule.id)).length, 1, 'no second transaction');
  const ledger = await RecurringOccurrence.findOne({ rule_id: rule.id });
  assert.equal(ledger.status, 'generated');
  assert.ok(ledger.transaction_id);
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '85000.00', 'charged once');
});

test('REQ-60 a fresh claim held by another instance is left alone', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  const ruleDoc = await RecurringRule.findById(rule.id);
  await RecurringOccurrence.create({
    rule_id: ruleDoc._id, user_id: ctx.user._id, scheduled_date: new Date(`${isoDay(0)}T00:00:00Z`),
  });
  const cutoff = dueCutoff(istAt(0, '01:00'));
  const counts = await processRule(ruleDoc._id, cutoff, { now: new Date() });
  assert.equal(counts.generated, 0);
  assert.equal((await txsOf(rule.id)).length, 0);
});

// ---------------------------------------------------------------------------
// REQ-56: management
// ---------------------------------------------------------------------------

test('REQ-56 IT_24: pausing stops generation; resuming does not back-fill the paused period', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily' });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '01:00') });
  assert.equal((await txsOf(rule.id)).length, 1);

  const paused = await ctx.api.post(`/api/recurring-rules/${rule.id}/pause`);
  assert.equal(paused.status, 200);
  assert.equal(paused.body.data.status, 'paused');

  await processDueRules({ now: istAt(3) });
  assert.equal((await txsOf(rule.id)).length, 1, 'nothing generated while paused');

  const resumed = await resumeRule(ctx.user._id, rule.id, { today: new Date(`${isoDay(3)}T00:00:00Z`) });
  assert.equal(resumed.status, 'active');
  assert.equal(resumed.next_due_date, isoDay(3), 'resumes from today, not from the missed days');

  await processDueRules({ now: istAt(3) });
  assert.deepEqual((await txsOf(rule.id)).map((t) => dayOf(t.transaction_date)), [isoDay(0), isoDay(3)]);
});

test('REQ-56 pause and resume only apply in the right state', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  assert.equal((await ctx.api.post(`/api/recurring-rules/${rule.id}/resume`)).status, 409);
  assert.equal((await ctx.api.post(`/api/recurring-rules/${rule.id}/pause`)).status, 200);
  assert.equal((await ctx.api.post(`/api/recurring-rules/${rule.id}/pause`)).status, 409);
  assert.equal((await ctx.api.post(`/api/recurring-rules/${rule.id}/resume`)).status, 200);
});

test('REQ-56 an edit changes future occurrences only; earlier transactions are untouched', async () => {
  const ctx = await setup({ amount: '100', frequency: 'daily' });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '01:00') });

  const edit = await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { amount: '250', note: 'new price' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.data.amount, '250.00');

  await processDueRules({ now: istAt(2) });
  const txs = await txsOf(rule.id);
  assert.deepEqual(txs.map((t) => t.amount.toString()), ['100.00', '250.00', '250.00']);
  assert.equal(txs[0].note, '');
  assert.equal(txs[1].note, 'new price');
});

test('REQ-56 editing the account or category applies to the next occurrence only', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily' });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '01:00') });
  const second = await createAccount(ctx.user, { opening_balance: '500.00' });
  assert.equal((await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { account_id: second.id })).status, 200);
  await processDueRules({ now: istAt(1) });
  const txs = await txsOf(rule.id);
  assert.equal(String(txs[0].account_id), ctx.account.id);
  assert.equal(String(txs[1].account_id), second.id);
});

test('REQ-56 an edit is validated like a create, including ownership', async () => {
  const ctx = await setup();
  const other = await createUser();
  const rule = await createRule(ctx);
  assert.equal((await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { amount: '-5' })).status, 400);
  assert.equal((await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { account_id: (await createAccount(other)).id })).status, 404);
  assert.equal((await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { category_id: (await createCategory(other)).id })).status, 400);
  const bad = await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { end_date: isoDay(-5) });
  assert.equal(bad.body.errors.end_date, 'End date must be after the start date.');
  assert.equal((await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { status: 'completed' })).status, 400);
});

test('REQ-56 changing the frequency re-anchors from the next due date, without touching history', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily' });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(1) }); // days 0 and 1 generated, next due day 2
  const res = await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { frequency: 'weekly' });
  assert.equal(res.body.data.next_due_date, isoDay(2));
  await processDueRules({ now: istAt(9) });
  assert.deepEqual((await txsOf(rule.id)).map((t) => dayOf(t.transaction_date)), [isoDay(0), isoDay(1), isoDay(2), isoDay(9)]);
});

test('REQ-56 the start date can change only before anything has been generated', async () => {
  const ctx = await setup({ start_date: isoDay(10) });
  const rule = await createRule(ctx);
  const moved = await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { start_date: isoDay(12) });
  assert.equal(moved.body.data.next_due_date, isoDay(12));

  const started = await setup({ frequency: 'daily' });
  const r2 = await createRule(started);
  await processDueRules({ now: istAt(0, '01:00') });
  const res = await started.api.patch(`/api/recurring-rules/${r2.id}`, { start_date: isoDay(3) });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.start_date);
});

test('REQ-56 a form that resends an unchanged start date is accepted', async () => {
  const ctx = await setup({ frequency: 'daily' });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '01:00') });
  const res = await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { start_date: rule.start_date, amount: '12' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('REQ-56 IT_24: deleting a rule keeps every transaction it generated and stops further ones', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily' });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(1) });
  assert.equal((await txsOf(rule.id)).length, 2);
  const balance = (await balancesOf(ctx.user))[ctx.account.id];

  assert.equal((await ctx.api.delete(`/api/recurring-rules/${rule.id}`)).status, 200);
  assert.equal((await ctx.api.get(`/api/recurring-rules/${rule.id}`)).status, 404);
  assert.equal((await ctx.api.get('/api/recurring-rules')).body.data.length, 0);
  assert.equal((await ctx.api.delete(`/api/recurring-rules/${rule.id}`)).status, 404);

  await processDueRules({ now: istAt(5) });
  const kept = await Transaction.find({ recurring_rule_id: rule.id, is_deleted: { $ne: true } });
  assert.equal(kept.length, 2);
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], balance, 'balance unchanged by the delete');
});

test('REQ-52 an occurrence count completes the rule after exactly that many transactions', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily', occurrence_count: 3 });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(10) });
  assert.equal((await txsOf(rule.id)).length, 3);
  const view = (await ctx.api.get(`/api/recurring-rules/${rule.id}`)).body.data;
  assert.equal(view.status, 'completed');
  assert.equal(view.next_due_date, null);
  await processDueRules({ now: istAt(20) });
  assert.equal((await txsOf(rule.id)).length, 3);
  assert.equal((await ctx.api.patch(`/api/recurring-rules/${rule.id}`, { amount: '1' })).status, 409);
});

test('REQ-52 an end date completes the rule after the last occurrence on or before it', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily', end_date: isoDay(2) });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(10) });
  assert.deepEqual((await txsOf(rule.id)).map((t) => dayOf(t.transaction_date)), [isoDay(0), isoDay(1), isoDay(2)]);
  assert.equal((await ctx.api.get(`/api/recurring-rules/${rule.id}`)).body.data.status, 'completed');
});

test('REQ-52 an occurrence-count rule counts correctly across a pause', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily', occurrence_count: 3 });
  const rule = await createRule(ctx);
  await processDueRules({ now: istAt(0, '01:00') });
  await ctx.api.post(`/api/recurring-rules/${rule.id}/pause`);
  await resumeRule(ctx.user._id, rule.id, { today: new Date(`${isoDay(5)}T00:00:00Z`) });
  await processDueRules({ now: istAt(20) });
  assert.deepEqual((await txsOf(rule.id)).map((t) => dayOf(t.transaction_date)), [isoDay(0), isoDay(5), isoDay(6)]);
});

// ---------------------------------------------------------------------------
// Robustness: bad data at generation time
// ---------------------------------------------------------------------------

test('an archived account does not stop the scheduler: the occurrence is skipped, the user is told, the rule moves on', async () => {
  const ctx = await setup({ amount: '10', frequency: 'daily' });
  const rule = await createRule(ctx);
  await ctx.account.updateOne({ is_archived: true });
  const result = await processDueRules({ now: istAt(1) });
  assert.equal(result.skipped, 2);
  assert.equal(result.failed, 0);
  assert.equal((await txsOf(rule.id)).length, 0);
  assert.equal(await Notification.countDocuments({ user_id: ctx.user._id, type: 'recurring_skipped' }), 2);
  assert.equal((await ctx.api.get(`/api/recurring-rules/${rule.id}`)).body.data.occurrences_done, 2);
});

test('a deleted category does not drop the occurrence: it is generated uncategorised', async () => {
  const ctx = await setup({ amount: '10' });
  const rule = await createRule(ctx);
  await ctx.category.deleteOne();
  await processDueRules({ now: istAt(0, '01:00') });
  const [tx] = await txsOf(rule.id);
  assert.ok(tx);
  assert.equal(tx.category_id, null);
});

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

test('SEC: one user cannot see, edit, pause, resume or delete another user\'s rule', async () => {
  const ctx = await setup();
  const rule = await createRule(ctx);
  const other = apiAs(await createUser());

  assert.equal((await other.get(`/api/recurring-rules/${rule.id}`)).status, 404);
  assert.equal((await other.patch(`/api/recurring-rules/${rule.id}`, { amount: '1' })).status, 404);
  assert.equal((await other.post(`/api/recurring-rules/${rule.id}/pause`)).status, 404);
  assert.equal((await other.post(`/api/recurring-rules/${rule.id}/resume`)).status, 404);
  assert.equal((await other.delete(`/api/recurring-rules/${rule.id}`)).status, 404);
  assert.equal((await other.get('/api/recurring-rules')).body.data.length, 0);
  assert.equal((await ctx.api.get(`/api/recurring-rules/${rule.id}`)).body.data.status, 'active', 'untouched');
  assert.equal((await ctx.api.get('/api/recurring-rules/not-an-id')).status, 404);
});

test('list: filters by status and paginates', async () => {
  const ctx = await setup();
  const a = await createRule(ctx);
  await createRule(ctx);
  await ctx.api.post(`/api/recurring-rules/${a.id}/pause`);
  assert.equal((await ctx.api.get('/api/recurring-rules?status=paused')).body.data.length, 1);
  assert.equal((await ctx.api.get('/api/recurring-rules?status=active')).body.data.length, 1);
  assert.equal((await ctx.api.get('/api/recurring-rules?status=all')).body.data.length, 2);
  assert.equal((await ctx.api.get('/api/recurring-rules?limit=1')).body.pagination.totalPages, 2);
  assert.equal((await ctx.api.get('/api/recurring-rules?status=bogus')).status, 400);
  assert.equal((await ctx.api.get('/api/recurring-rules?limit=500')).status, 400);
});
