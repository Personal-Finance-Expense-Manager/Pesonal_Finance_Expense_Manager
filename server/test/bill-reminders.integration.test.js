import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApi, stopApi, createUser, createAccount, createCategory, apiAs, balancesOf, isoDay,
} from './helpers/integration.js';
import Reminder from '../src/models/Reminder.js';
import Transaction from '../src/models/Transaction.js';
import Notification from '../src/models/Notification.js';
import NotificationDelivery from '../src/models/NotificationDelivery.js';
import PushSubscription from '../src/models/PushSubscription.js';
import { markPaid } from '../src/services/billReminderService.js';
import { markOverdue, dispatchDueNotifications, runBillScheduler } from '../src/services/billSchedulerService.js';
import { inAppChannel, emailChannel, pushChannel, setEmailTransportFactory, setPushProvider } from '../src/services/notifications/channels.js';

before(startApi);
after(stopApi);

const day = (offset) => new Date(`${isoDay(offset)}T00:00:00Z`);
const istAt = (offset, hhmm = '10:00') => new Date(`${isoDay(offset)}T${hhmm}:00+05:30`);

async function setup() {
  const user = await createUser();
  const account = await createAccount(user, { opening_balance: '50000.00' });
  const category = await createCategory(user);
  return { user, account, category, api: apiAs(user) };
}
const bill = (ctx, over = {}) => ctx.api.post('/api/bill-reminders', {
  name: 'Electricity', amount: '3000', due_date: isoDay(10), ...over,
});
const expensesFor = (id) => Transaction.find({ linked_reminder_id: id }).lean();

// ---------------------------------------------------------------------------
// REQ-57: create, view, edit, delete
// ---------------------------------------------------------------------------

test('REQ-57 UT_37: a reminder is created with a three-day lead time by default', async () => {
  const ctx = await setup();
  const res = await bill(ctx);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.notify_days_before, 3);
  assert.equal(res.body.data.status, 'pending');
  assert.equal(res.body.data.amount, '3000.00');
  assert.equal(res.body.data.notify_date, isoDay(7));
  assert.equal(res.body.data.days_until_due, 10);
});

test('REQ-57 a custom lead time is stored; invalid input is refused with field messages', async () => {
  const ctx = await setup();
  assert.equal((await bill(ctx, { notify_days_before: 7 })).body.data.notify_days_before, 7);
  const bad = await ctx.api.post('/api/bill-reminders', { name: '', amount: '-1', due_date: 'tomorrow', notify_days_before: 999 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.name && bad.body.errors.amount && bad.body.errors.due_date && bad.body.errors.notify_days_before);
  assert.equal(await Reminder.countDocuments({ user_id: ctx.user._id }), 1);
});

test('REQ-57 a reminder cannot be created with another user\'s account or category', async () => {
  const ctx = await setup();
  const other = await createUser();
  assert.equal((await bill(ctx, { account_id: (await createAccount(other)).id })).status, 404);
  assert.equal((await bill(ctx, { category_id: (await createCategory(other)).id })).status, 400);
});

test('REQ-57 reminders can be listed, viewed, edited and deleted', async () => {
  const ctx = await setup();
  const created = (await bill(ctx)).body.data;
  await bill(ctx, { name: 'Water', due_date: isoDay(4) });

  const list = (await ctx.api.get('/api/bill-reminders')).body.data;
  assert.deepEqual(list.map((b) => b.name), ['Water', 'Electricity'], 'soonest due first');
  assert.equal((await ctx.api.get(`/api/bill-reminders/${created.id}`)).body.data.name, 'Electricity');

  const edit = await ctx.api.patch(`/api/bill-reminders/${created.id}`, { amount: '3500', notify_days_before: 5 });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.data.amount, '3500.00');
  assert.equal(edit.body.data.notify_date, isoDay(5));

  assert.equal((await ctx.api.delete(`/api/bill-reminders/${created.id}`)).status, 200);
  assert.equal((await ctx.api.get(`/api/bill-reminders/${created.id}`)).status, 404);
});

test('REQ-57 a reminder cannot be used without signing in', async () => {
  assert.equal((await apiAs(null).get('/api/bill-reminders')).status, 401);
});

test('SEC: one user cannot see, edit, delete or pay another user\'s reminder', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;
  const other = apiAs(await createUser());
  assert.equal((await other.get(`/api/bill-reminders/${created.id}`)).status, 404);
  assert.equal((await other.patch(`/api/bill-reminders/${created.id}`, { name: 'x' })).status, 404);
  assert.equal((await other.delete(`/api/bill-reminders/${created.id}`)).status, 404);
  assert.equal((await other.post(`/api/bill-reminders/${created.id}/pay`, {})).status, 404);
  assert.equal((await other.get('/api/bill-reminders')).body.data.length, 0);
  assert.equal(await Transaction.countDocuments({ linked_reminder_id: created.id }), 0);
  assert.equal((await ctx.api.get('/api/bill-reminders/zzz')).status, 404);
});

// ---------------------------------------------------------------------------
// REQ-58: mark as paid
// ---------------------------------------------------------------------------

test('REQ-58 UT_38: marking paid creates a linked expense, updates the balance and sets PAID', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id, category_id: ctx.category.id })).body.data;

  const res = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.reminder.status, 'paid');
  assert.ok(res.body.data.reminder.paid_at);
  assert.equal(res.body.data.reminder.linked_transaction_id, res.body.data.transaction.id);

  const [tx] = await expensesFor(created.id);
  assert.equal(tx.type, 'expense');
  assert.equal(tx.amount.toString(), '3000.00');
  assert.equal(String(tx.account_id), ctx.account.id);
  assert.equal(String(tx.category_id), ctx.category.id);
  assert.equal(tx.transaction_date.toISOString().slice(0, 10), isoDay(0));
  assert.equal(String(tx._id), res.body.data.transaction.id);
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '47000.00');

  const view = (await ctx.api.get(`/api/bill-reminders/${created.id}`)).body.data;
  assert.equal(view.status, 'paid');
  assert.equal(view.linked_transaction_id, String(tx._id));
});

test('REQ-58 the account can be chosen at payment time, with a different amount and date', async () => {
  const ctx = await setup();
  const created = (await bill(ctx)).body.data;
  const res = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {
    account_id: ctx.account.id, amount: '2950.50', paid_date: isoDay(0),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.transaction.amount, '2950.50');
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '47049.50');
});

test('REQ-58 without any account the payment is refused and nothing is created', async () => {
  const ctx = await setup();
  const created = (await bill(ctx)).body.data;
  const res = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {});
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.account_id);
  assert.equal((await expensesFor(created.id)).length, 0);
  assert.equal((await ctx.api.get(`/api/bill-reminders/${created.id}`)).body.data.status, 'pending');
});

test('REQ-58 UT_39: paying twice is refused and creates no second expense', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;
  assert.equal((await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {})).status, 200);
  const again = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {});
  assert.equal(again.status, 409);
  assert.match(again.body.message, /already been paid/);
  assert.equal((await expensesFor(created.id)).length, 1);
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '47000.00');
});

test('REQ-58 simultaneous pay requests create exactly one expense', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;
  const results = await Promise.all(Array.from({ length: 8 }, () => ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {})));
  assert.equal(results.filter((r) => r.status === 200).length, 1, 'one winner');
  assert.ok(results.every((r) => [200, 409].includes(r.status)));
  assert.equal((await expensesFor(created.id)).length, 1);
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '47000.00');
  assert.equal((await Reminder.findById(created.id)).status, 'paid');
});

test('REQ-58 another user\'s account cannot be charged, and the bill stays payable', async () => {
  const ctx = await setup();
  const other = await createUser();
  const created = (await bill(ctx)).body.data;
  const bad = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, { account_id: (await createAccount(other)).id });
  assert.equal(bad.status, 404);
  assert.equal((await expensesFor(created.id)).length, 0);
  const ok = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, { account_id: ctx.account.id });
  assert.equal(ok.status, 200, 'the failed attempt released its claim');
});

test('REQ-58 an archived account is refused', async () => {
  const ctx = await setup();
  const archived = await createAccount(ctx.user, { is_archived: true });
  const created = (await bill(ctx)).body.data;
  assert.equal((await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, { account_id: archived.id })).status, 404);
});

test('REQ-58 invalid payment details are refused field by field', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;
  const res = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, { amount: '-5', paid_date: 'x', account_id: 'bad', status: 'paid' });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.amount && res.body.errors.paid_date && res.body.errors.account_id && res.body.errors.status);
});

test('REQ-58 the paid expense is a normal transaction: it can be edited and appears in the list', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;
  const paid = (await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {})).body.data;
  assert.equal((await ctx.api.patch(`/api/transactions/${paid.transaction.id}`, { note: 'checked' })).status, 200);
  const row = (await ctx.api.get('/api/transactions')).body.data.find((t) => t.id === paid.transaction.id);
  assert.equal(row.linked_reminder_id, created.id);
});

test('REQ-58 a paid bill cannot be edited; deleting it keeps the expense', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;
  await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {});
  assert.equal((await ctx.api.patch(`/api/bill-reminders/${created.id}`, { name: 'x' })).status, 409);
  assert.equal((await ctx.api.delete(`/api/bill-reminders/${created.id}`)).status, 200);
  assert.equal((await expensesFor(created.id)).length, 1);
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '47000.00');
});

test('REQ-58 recovery: a request that died after creating the expense is completed by the retry, with no second expense', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;
  const reminder = await Reminder.findById(created.id);
  await Transaction.create({
    user_id: ctx.user._id, account_id: ctx.account._id, type: 'expense', amount: '3000.00',
    transaction_date: day(0), linked_reminder_id: reminder._id,
  });
  await Reminder.updateOne({ _id: reminder._id }, { $set: { payment_claimed_at: new Date() } });
  assert.equal((await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {})).status, 409, 'a fresh claim is respected');

  await Reminder.updateOne({ _id: reminder._id }, { $set: { payment_claimed_at: new Date(Date.now() - 10 * 60 * 1000) } });
  const res = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.reminder.status, 'paid');
  assert.equal((await expensesFor(created.id)).length, 1);
  assert.equal((await balancesOf(ctx.user))[ctx.account.id], '47000.00');
});

test('REQ-58 recovery: a stale claim with no expense is taken over; a fresh one is respected', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;

  await Reminder.updateOne({ _id: created.id }, { $set: { payment_claimed_at: new Date() } });
  assert.equal((await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {})).status, 409, 'someone is mid-payment');

  await Reminder.updateOne({ _id: created.id }, { $set: { payment_claimed_at: new Date(Date.now() - 10 * 60 * 1000) } });
  assert.equal((await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {})).status, 200);
  assert.equal((await expensesFor(created.id)).length, 1);
});

test('REQ-58 the database itself refuses two expenses for one reminder', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { account_id: ctx.account.id })).body.data;
  const make = () => Transaction.create({
    user_id: ctx.user._id, account_id: ctx.account._id, type: 'expense', amount: '1.00',
    transaction_date: day(0), linked_reminder_id: created.id,
  });
  await make();
  await assert.rejects(make(), (e) => e.code === 11000);
});

// ---------------------------------------------------------------------------
// REQ-59: overdue
// ---------------------------------------------------------------------------

test('REQ-59 ST_19: a bill created with a past due date is overdue straight away', async () => {
  const ctx = await setup();
  const res = await bill(ctx, { due_date: isoDay(-2) });
  assert.equal(res.body.data.status, 'overdue');
  assert.equal(res.body.data.days_until_due, -2);
});

test('REQ-59 the scheduler turns unpaid past-due bills into OVERDUE and never touches paid ones', async () => {
  const ctx = await setup();
  const dueYesterday = await Reminder.create({ user_id: ctx.user._id, name: 'Late', amount: '10.00', due_date: day(-1), status: 'pending' });
  const dueToday = await Reminder.create({ user_id: ctx.user._id, name: 'Today', amount: '10.00', due_date: day(0), status: 'pending' });
  const future = await Reminder.create({ user_id: ctx.user._id, name: 'Later', amount: '10.00', due_date: day(5), status: 'pending' });
  const paid = await Reminder.create({ user_id: ctx.user._id, name: 'Done', amount: '10.00', due_date: day(-30), status: 'paid' });

  await markOverdue({ today: day(0) });

  assert.equal((await Reminder.findById(dueYesterday._id)).status, 'overdue');
  assert.equal((await Reminder.findById(dueToday._id)).status, 'pending', 'due today is not overdue');
  assert.equal((await Reminder.findById(future._id)).status, 'pending');
  assert.equal((await Reminder.findById(paid._id)).status, 'paid', 'a paid bill is never overdue');

  await markOverdue({ today: day(0) });
  assert.equal((await Reminder.findById(dueYesterday._id)).status, 'overdue', 'idempotent');
});

test('REQ-59 a bill becomes overdue the day after its due date', async () => {
  const ctx = await setup();
  const r = await Reminder.create({ user_id: ctx.user._id, name: 'Edge', amount: '10.00', due_date: day(3), status: 'pending' });
  await markOverdue({ today: day(3) });
  assert.equal((await Reminder.findById(r._id)).status, 'pending');
  await markOverdue({ today: day(4) });
  assert.equal((await Reminder.findById(r._id)).status, 'overdue');
});

test('REQ-59 an overdue bill can still be paid, and is then PAID', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { due_date: isoDay(-3), account_id: ctx.account.id })).body.data;
  assert.equal(created.status, 'overdue');
  const res = await ctx.api.post(`/api/bill-reminders/${created.id}/pay`, {});
  assert.equal(res.body.data.reminder.status, 'paid');
  await markOverdue({ today: day(5) });
  assert.equal((await Reminder.findById(created.id)).status, 'paid');
});

test('REQ-59 moving the due date of an overdue bill into the future makes it pending again', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { due_date: isoDay(-3) })).body.data;
  const res = await ctx.api.patch(`/api/bill-reminders/${created.id}`, { due_date: isoDay(5) });
  assert.equal(res.body.data.status, 'pending');
});

test('REQ-59 the list can be filtered by status and shows pending past-due bills as overdue even before the scheduler runs', async () => {
  const ctx = await setup();
  await Reminder.create({ user_id: ctx.user._id, name: 'Stale pending', amount: '10.00', due_date: day(-2), status: 'pending' });
  await bill(ctx, { name: 'Future' });
  const paid = (await bill(ctx, { name: 'Paid one', account_id: ctx.account.id })).body.data;
  await ctx.api.post(`/api/bill-reminders/${paid.id}/pay`, {});

  assert.deepEqual((await ctx.api.get('/api/bill-reminders?status=overdue')).body.data.map((b) => b.name), ['Stale pending']);
  assert.equal((await ctx.api.get('/api/bill-reminders?status=overdue')).body.data[0].status, 'overdue');
  assert.deepEqual((await ctx.api.get('/api/bill-reminders?status=pending')).body.data.map((b) => b.name), ['Future']);
  assert.deepEqual((await ctx.api.get('/api/bill-reminders?status=paid')).body.data.map((b) => b.name), ['Paid one']);
  assert.equal((await ctx.api.get('/api/bill-reminders?status=all')).body.data.length, 3);
  assert.equal((await ctx.api.get('/api/bill-reminders?status=nope')).status, 400);
});

test('REQ-59 IT_26: the dashboard lists overdue bills, with a count and a total, for the owner only', async () => {
  const ctx = await setup();
  await bill(ctx, { name: 'Rent', amount: '1000', due_date: isoDay(-5) });
  await Reminder.create({ user_id: ctx.user._id, name: 'Internet', amount: '499.50', due_date: day(-1), status: 'pending' });
  await bill(ctx, { name: 'Not yet', due_date: isoDay(2) });
  const paid = (await bill(ctx, { name: 'Settled', due_date: isoDay(-9), account_id: ctx.account.id })).body.data;
  await ctx.api.post(`/api/bill-reminders/${paid.id}/pay`, {});

  const dash = (await ctx.api.get('/api/reports/dashboard')).body;
  assert.equal(dash.overdue_bills.count, 2);
  assert.equal(dash.overdue_bills.total, '1499.50');
  assert.deepEqual(dash.overdue_bills.items.map((b) => b.name), ['Rent', 'Internet'], 'oldest first');
  assert.equal(dash.overdue_bills.items[0].days_overdue, 5);

  const other = apiAs(await createUser());
  const empty = (await other.get('/api/reports/dashboard')).body;
  assert.deepEqual(empty.overdue_bills, { count: 0, total: '0.00', items: [] });
});

test('REQ-59 the existing dashboard fields are unchanged by the addition', async () => {
  const ctx = await setup();
  const dash = (await ctx.api.get('/api/reports/dashboard')).body;
  for (const key of ['budgets']) assert.ok(key in dash, key);
  assert.ok('overdue_bills' in dash);
});

// ---------------------------------------------------------------------------
// REQ-57: notifications
// ---------------------------------------------------------------------------

/** The real in-app channel plus recording fakes for the other two. */
function channels(sent, { emailFails = 0 } = {}) {
  let failures = emailFails;
  return [
    inAppChannel,
    { name: 'email', async send(m) { if (failures > 0) { failures -= 1; throw new Error('smtp down'); } sent.push(m); return { status: 'sent' }; } },
  ];
}

test('REQ-57 UT_36: a reminder is sent on the notification date and not before', async () => {
  const ctx = await setup();
  await bill(ctx, { due_date: isoDay(10), notify_days_before: 3 });
  const sent = [];

  await dispatchDueNotifications({ now: istAt(6), channels: channels(sent) });
  assert.equal(sent.filter((m) => m.user.email === ctx.user.email).length, 0, 'four days early');

  await dispatchDueNotifications({ now: new Date(`${isoDay(7)}T00:04:00+05:30`), channels: channels(sent) });
  assert.equal(sent.filter((m) => m.user.email === ctx.user.email).length, 0, 'before 00:05 IST');

  await dispatchDueNotifications({ now: new Date(`${isoDay(7)}T00:05:00+05:30`), channels: channels(sent) });
  const mine = sent.filter((m) => m.user.email === ctx.user.email);
  assert.equal(mine.length, 1);
  assert.match(mine[0].title, /Electricity/);
  assert.match(mine[0].body, /3000\.00/);
  assert.equal(await Notification.countDocuments({ user_id: ctx.user._id, type: 'bill_reminder' }), 1);
});

test('REQ-57 duplicates are prevented: repeated and concurrent passes notify once per channel', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { due_date: isoDay(10) })).body.data;
  const sent = [];
  await Promise.all(Array.from({ length: 5 }, () => dispatchDueNotifications({ now: istAt(8), channels: channels(sent) })));
  await dispatchDueNotifications({ now: istAt(9), channels: channels(sent) });

  assert.equal(sent.filter((m) => m.user.email === ctx.user.email).length, 1);
  assert.equal(await Notification.countDocuments({ user_id: ctx.user._id, type: 'bill_reminder' }), 1);
  assert.equal(await NotificationDelivery.countDocuments({ reminder_id: created.id }), 2, 'one row per channel');
});

test('REQ-57 a reminder created after its notification date is still sent once, on the next pass', async () => {
  const ctx = await setup();
  await bill(ctx, { due_date: isoDay(1), notify_days_before: 3 });
  const sent = [];
  await dispatchDueNotifications({ now: istAt(0), channels: channels(sent) });
  assert.equal(sent.filter((m) => m.user.email === ctx.user.email).length, 1);
});

test('REQ-57 paid, overdue and past-due bills are not notified', async () => {
  const ctx = await setup();
  const paid = (await bill(ctx, { due_date: isoDay(2), account_id: ctx.account.id })).body.data;
  await ctx.api.post(`/api/bill-reminders/${paid.id}/pay`, {});
  await bill(ctx, { name: 'Gone', due_date: isoDay(-4) });
  const sent = [];
  await dispatchDueNotifications({ now: istAt(0), channels: channels(sent) });
  assert.equal(sent.filter((m) => m.user.email === ctx.user.email).length, 0);
  assert.equal(await Notification.countDocuments({ user_id: ctx.user._id }), 0);
});

test('REQ-57 changing the due date schedules a fresh notification for the new date', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { due_date: isoDay(2) })).body.data;
  const sent = [];
  await dispatchDueNotifications({ now: istAt(0), channels: channels(sent) });
  await ctx.api.patch(`/api/bill-reminders/${created.id}`, { due_date: isoDay(6) });
  await dispatchDueNotifications({ now: istAt(3), channels: channels(sent) });
  assert.equal(sent.filter((m) => m.user.email === ctx.user.email).length, 2);
});

test('REQ-57 retries: a failed email is retried with backoff, three attempts at most, and the failure is recorded', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { due_date: isoDay(5) })).body.data;
  const sent = [];
  const ch = channels(sent, { emailFails: 99 });
  const row = () => NotificationDelivery.findOne({ reminder_id: created.id, channel: 'email' });

  await dispatchDueNotifications({ now: istAt(2, '10:00'), channels: ch });
  assert.equal((await row()).status, 'failed');
  assert.equal((await row()).attempts, 1);
  assert.match((await row()).last_error, /smtp down/);

  await dispatchDueNotifications({ now: istAt(2, '10:00:30'.slice(0, 5)), channels: ch });
  assert.equal((await row()).attempts, 1, 'too soon: the backoff has not elapsed');

  await dispatchDueNotifications({ now: new Date(istAt(2, '10:00').getTime() + 2 * 60 * 1000), channels: ch });
  assert.equal((await row()).attempts, 2);

  await dispatchDueNotifications({ now: new Date(istAt(2, '10:00').getTime() + 10 * 60 * 1000), channels: ch });
  assert.equal((await row()).attempts, 3);

  await dispatchDueNotifications({ now: new Date(istAt(2, '10:00').getTime() + 60 * 60 * 1000), channels: ch });
  assert.equal((await row()).attempts, 3, 'gives up after three');
  assert.equal((await row()).status, 'failed');
  assert.equal(sent.length, 0);
});

test('REQ-57 a retry that succeeds is recorded as sent, and the in-app notice is not repeated', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { due_date: isoDay(5) })).body.data;
  const sent = [];
  const ch = channels(sent, { emailFails: 1 });
  await dispatchDueNotifications({ now: istAt(2), channels: ch });
  await dispatchDueNotifications({ now: new Date(istAt(2).getTime() + 2 * 60 * 1000), channels: ch });
  const row = await NotificationDelivery.findOne({ reminder_id: created.id, channel: 'email' });
  assert.equal(row.status, 'sent');
  assert.ok(row.sent_at);
  assert.equal(sent.filter((m) => m.user.email === ctx.user.email).length, 1);
  assert.equal(await Notification.countDocuments({ user_id: ctx.user._id }), 1);
});

test('REQ-57 with no email or push provider the log says so honestly: skipped, never sent', async () => {
  const ctx = await setup();
  const created = (await bill(ctx, { due_date: isoDay(5) })).body.data;
  const saved = { ...process.env };
  for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'DEV_EMAIL_CONSOLE']) delete process.env[k];
  process.env.NODE_ENV = 'production';
  setPushProvider(null);
  try {
    await dispatchDueNotifications({ now: istAt(2), channels: [inAppChannel, emailChannel, pushChannel] });
  } finally {
    process.env.NODE_ENV = saved.NODE_ENV;
    Object.assign(process.env, saved);
  }
  const rows = Object.fromEntries((await NotificationDelivery.find({ reminder_id: created.id })).map((r) => [r.channel, r.status]));
  assert.deepEqual(rows, { in_app: 'sent', email: 'skipped_not_configured', push: 'skipped_not_configured' });
});

test('REQ-57 with SMTP configured an email really goes through the transport, once', async () => {
  const ctx = await setup();
  await bill(ctx, { name: 'Broadband', due_date: isoDay(5) });
  const mails = [];
  setEmailTransportFactory(() => ({ sendMail: async (m) => { mails.push(m); } }));
  const saved = { ...process.env };
  Object.assign(process.env, { SMTP_HOST: 'smtp.test', SMTP_USER: 'u', SMTP_PASS: 'p', EMAIL_FROM: 'noreply@pfem.test' });
  try {
    await dispatchDueNotifications({ now: istAt(2), channels: [emailChannel] });
    await dispatchDueNotifications({ now: istAt(2), channels: [emailChannel] });
  } finally {
    for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM']) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
  const mine = mails.filter((m) => m.to === ctx.user.email);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].from, 'noreply@pfem.test');
  assert.match(mine[0].subject, /Broadband/);
});

test('REQ-57 with a push provider and a subscription a push is delivered; with no subscription it is skipped', async () => {
  const withSub = await setup();
  const without = await setup();
  await bill(withSub, { due_date: isoDay(5) });
  await bill(without, { due_date: isoDay(5) });
  await PushSubscription.create({ user_id: withSub.user._id, endpoint: 'https://push.example.test/abc', keys: { p256dh: 'k', auth: 'a' } });

  const pushes = [];
  setPushProvider({ send: async (sub, payload) => { pushes.push({ sub, payload }); } });
  try {
    await dispatchDueNotifications({ now: istAt(2), channels: [pushChannel] });
  } finally {
    setPushProvider(null);
  }
  assert.equal(pushes.filter((p) => p.sub.endpoint === 'https://push.example.test/abc').length, 1);
  assert.match(pushes[0].payload.title, /Electricity/);
  const row = await NotificationDelivery.findOne({ user_id: without.user._id, channel: 'push' });
  assert.equal(row.status, 'skipped_not_configured');
});

test('runBillScheduler marks overdue and notifies in one idempotent pass', async () => {
  const ctx = await setup();
  const r = await Reminder.create({ user_id: ctx.user._id, name: 'Old', amount: '10.00', due_date: day(-1), status: 'pending' });
  const first = await runBillScheduler({ now: istAt(0), channels: [inAppChannel] });
  assert.ok(first.overdue >= 1);
  assert.equal((await Reminder.findById(r._id)).status, 'overdue');
  const second = await runBillScheduler({ now: istAt(0), channels: [inAppChannel] });
  assert.equal(second.overdue, 0);
});

test('an inactive user is not notified', async () => {
  const ctx = await setup();
  await bill(ctx, { due_date: isoDay(5) });
  await ctx.user.updateOne({ status: 'suspended' });
  const sent = [];
  await dispatchDueNotifications({ now: istAt(2), channels: channels(sent) });
  assert.equal(sent.filter((m) => m.user.email === ctx.user.email).length, 0);
});

// ---------------------------------------------------------------------------
// In-app notification API
// ---------------------------------------------------------------------------

test('in-app notifications are listed for the owner only and can be marked read', async () => {
  const ctx = await setup();
  await bill(ctx, { due_date: isoDay(5) });
  await dispatchDueNotifications({ now: istAt(2), channels: [inAppChannel] });

  const list = (await ctx.api.get('/api/notifications')).body.data;
  assert.equal(list.length, 1);
  assert.equal(list[0].is_read, false);
  assert.equal((await ctx.api.get('/api/notifications?unread=true')).body.data.length, 1);

  const other = apiAs(await createUser());
  assert.equal((await other.get('/api/notifications')).body.data.length, 0);
  assert.equal((await other.post(`/api/notifications/${list[0].id}/read`, {})).status, 404);

  assert.equal((await ctx.api.post(`/api/notifications/${list[0].id}/read`, {})).status, 200);
  assert.equal((await ctx.api.get('/api/notifications?unread=true')).body.data.length, 0);
});

test('push subscriptions are stored per user, https only, without duplicates', async () => {
  const ctx = await setup();
  assert.equal((await ctx.api.post('/api/notifications/push-subscriptions', { endpoint: 'http://insecure' })).status, 400);
  const sub = { endpoint: 'https://push.example.test/zzz', keys: { p256dh: 'a', auth: 'b' } };
  assert.equal((await ctx.api.post('/api/notifications/push-subscriptions', sub)).status, 201);
  assert.equal((await ctx.api.post('/api/notifications/push-subscriptions', sub)).status, 201);
  assert.equal(await PushSubscription.countDocuments({ user_id: ctx.user._id }), 1);
  assert.equal((await ctx.api.get('/api/notifications/push-status')).body.push_configured, false);
});
