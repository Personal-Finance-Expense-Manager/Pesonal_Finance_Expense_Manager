import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApi, stopApi, createUser, createAccount, createCategory, apiAs,
  balancesOf, isoDay, record, overallBudget,
} from './helpers/integration.js';
import Transaction from '../src/models/Transaction.js';
import Transfer from '../src/models/Transfer.js';
import TransactionTag from '../src/models/TransactionTag.js';
import AuditLog from '../src/models/AuditLog.js';
import { parseCsv } from '../src/utils/csv.js';
import { rollback } from '../src/services/importService.js';

before(startApi);
after(stopApi);

const HEADER = 'date,type,amount,currency,account,to_account,category,payment_mode,note,tags';

async function setup() {
  const user = await createUser('io');
  const bank = await createAccount(user, { name: 'Bank', opening_balance: '10000.00' });
  const cash = await createAccount(user, { name: 'Cash', type: 'cash', opening_balance: '500.00' });
  const food = await createCategory(user, { name: 'Food', type: 'expense' });
  return { user, bank, cash, food, api: apiAs(user) };
}

async function liveCount(user) {
  return (await Transaction.countDocuments({ user_id: user._id, is_deleted: { $ne: true } }))
    + (await Transfer.countDocuments({ user_id: user._id, is_deleted: { $ne: true } }));
}

// ---------------------------------------------------------------------------
// REQ-82 - CSV export
// ---------------------------------------------------------------------------

test('IT_30: the CSV export uses the documented order, ISO dates and plain decimal amounts', async () => {
  const { user, bank, cash, food, api } = await setup();
  await record(user, {
    type: 'expense', amount: '1234.5', account_id: bank.id, category_id: food.id,
    payment_mode: 'upi', note: 'Dinner, with "friends"', tags: ['food', 'weekend'],
  });
  await record(user, { type: 'income', amount: '50000', account_id: bank.id, note: 'Salary' });
  await record(user, { type: 'transfer', amount: '200', from_account_id: bank.id, to_account_id: cash.id, note: 'ATM' });

  const res = await api.raw('GET', '/api/data/transactions.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="pfem-transactions-.*\.csv"/);

  const text = res.buffer.toString('utf8');
  assert.ok(text.startsWith('﻿'), 'starts with a BOM so Excel reads UTF-8');
  const rows = parseCsv(text);
  assert.equal(rows[0].join(','), HEADER);
  assert.equal(rows.length, 4);

  const expense = rows.find((r) => r[1] === 'expense');
  assert.deepEqual(expense, [
    isoDay(), 'expense', '1234.50', 'INR', 'Bank', '', 'Food', 'upi', 'Dinner, with "friends"', 'food;weekend',
  ]);
  assert.equal(rows.find((r) => r[1] === 'income')[2], '50000.00');
  assert.deepEqual(rows.find((r) => r[1] === 'transfer').slice(1, 6), ['transfer', '200.00', 'INR', 'Bank', 'Cash']);
  for (const row of rows.slice(1)) assert.match(row[0], /^\d{4}-\d{2}-\d{2}$/);
});

test('IT_30: the export is limited to the chosen date range and leaves out deleted entries', async () => {
  const { user, bank, api } = await setup();
  await record(user, { type: 'expense', amount: '10', account_id: bank.id, transaction_date: isoDay(-10), note: 'old' });
  await record(user, { type: 'expense', amount: '20', account_id: bank.id, transaction_date: isoDay(-2), note: 'in range' });
  const gone = await record(user, { type: 'expense', amount: '30', account_id: bank.id, transaction_date: isoDay(-1), note: 'deleted' });
  await api.delete(`/api/transactions/${gone.id}`);

  const res = await api.raw('GET', `/api/data/transactions.csv?startDate=${isoDay(-5)}&endDate=${isoDay()}`);
  const notes = parseCsv(res.buffer.toString('utf8')).slice(1).map((r) => r[8]);
  assert.deepEqual(notes, ['in range']);

  const bad = await api.raw('GET', `/api/data/transactions.csv?startDate=${isoDay()}&endDate=${isoDay(-5)}`);
  assert.equal(bad.status, 400);

  const audit = await AuditLog.findOne({ user_id: user._id, action: 'export_csv' }).lean();
  assert.ok(audit, 'the export is audited');
});

// ---------------------------------------------------------------------------
// REQ-83 - preview and mapping before anything is written
// ---------------------------------------------------------------------------

test('UT_55: the preview shows the rows and writes nothing', async () => {
  const { user, api } = await setup();
  const csv = `${HEADER}\n${isoDay()},expense,500,INR,Bank,,Food,upi,Groceries,food\n`;

  const res = await api.post('/api/data/import/preview', { csv });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.valid_count, 1);
  assert.equal(res.body.data.rows[0].amount, '500.00');
  assert.equal(res.body.data.rows[0].account, 'Bank');
  assert.equal(await liveCount(user), 0);
});

test('UT_55: a file with its own headings is mapped by the user', async () => {
  const { user, api } = await setup();
  const csv = `When,Spent on,How much,Paid from\n${isoDay()},Tea,40,Cash\n`;

  const first = await api.post('/api/data/import/preview', { csv });
  assert.equal(first.body.data.needs_mapping, true);
  assert.deepEqual(first.body.data.headers, ['When', 'Spent on', 'How much', 'Paid from']);

  const mapping = { date: 0, note: 1, amount: 2, account: 3 };
  const mapped = await api.post('/api/data/import/preview', { csv, mapping });
  assert.equal(mapped.body.data.needs_mapping, false);
  assert.equal(mapped.body.data.valid_count, 1);
  assert.equal(mapped.body.data.rows[0].type, 'expense');

  const bad = await api.post('/api/data/import/preview', { csv, mapping: { date: 0, amount: 0, account: 3 } });
  assert.equal(bad.status, 400);

  const committed = await api.post('/api/data/import/commit', { csv, mapping });
  assert.equal(committed.status, 201);
  assert.equal(committed.body.data.imported, 1);
  assert.equal(await liveCount(user), 1);
});

// ---------------------------------------------------------------------------
// REQ-84 - every row validated, reasons by row number, only valid rows imported
// ---------------------------------------------------------------------------

test('UT_56: invalid rows are reported by row number and reason; only valid rows import', async () => {
  const { user, api } = await setup();
  const csv = [
    HEADER,
    `${isoDay()},expense,100,INR,Bank,,,cash,row two,`,
    `${isoDay()},expense,abc,INR,Bank,,,cash,row three,`,
    `${isoDay()},expense,300,INR,Bank,,,cash,row four,`,
    `${isoDay()},expense,10,INR,Nowhere,,,cash,row five,`,
    `2026-02-30,refund,10,INR,Bank,,Mystery,teleport,row six,`,
  ].join('\n');

  const preview = await api.post('/api/data/import/preview', { csv });
  assert.equal(preview.body.data.valid_count, 2);
  assert.deepEqual(preview.body.data.invalid_rows.map((r) => r.row), [3, 5, 6]);
  assert.match(preview.body.data.invalid_rows[0].reasons.join(' '), /amount/i);
  assert.match(preview.body.data.invalid_rows[1].reasons.join(' '), /Account "Nowhere" does not exist/);
  assert.match(preview.body.data.invalid_rows[2].reasons.join(' '), /refund/);

  const commit = await api.post('/api/data/import/commit', { csv });
  assert.equal(commit.status, 201);
  assert.equal(commit.body.data.imported, 2);
  assert.deepEqual(commit.body.data.invalid_rows.map((r) => r.row), [3, 5, 6]);

  const notes = (await Transaction.find({ user_id: user._id }).lean()).map((t) => t.note).sort();
  assert.deepEqual(notes, ['row four', 'row two']);
});

// ---------------------------------------------------------------------------
// REQ-85 - probable duplicates flagged and skipped unless chosen
// ---------------------------------------------------------------------------

test('IT_31: a row matching an existing entry is flagged and skipped unless the user chooses it', async () => {
  const { user, bank, api } = await setup();
  await record(user, { type: 'expense', amount: '500', account_id: bank.id, note: 'Groceries' });

  const csv = [
    HEADER,
    `${isoDay()},expense,500.00,INR,bank,,,upi,  groceries ,`,
    `${isoDay()},expense,75,INR,Bank,,,upi,Tea,`,
  ].join('\n');

  const preview = await api.post('/api/data/import/preview', { csv });
  assert.equal(preview.body.data.duplicate_count, 1);
  assert.equal(preview.body.data.rows.find((r) => r.row === 2).duplicate, true);
  assert.equal(preview.body.data.rows.find((r) => r.row === 3).duplicate, false);

  const skip = await api.post('/api/data/import/commit', { csv });
  assert.equal(skip.body.data.imported, 1);
  assert.deepEqual(skip.body.data.skipped_duplicates, [2]);
  assert.equal(await liveCount(user), 2);

  const csv2 = `${HEADER}\n${isoDay()},expense,500,INR,Bank,,,upi,Groceries,\n`;
  const chosen = await api.post('/api/data/import/commit', { csv: csv2, import_duplicates: [2] });
  assert.equal(chosen.body.data.imported, 1);
  assert.equal(await liveCount(user), 3);
});

// ---------------------------------------------------------------------------
// REQ-86 - balances, budgets and reports reflect imported entries
// ---------------------------------------------------------------------------

test('IT_14 / IT_38: balances and budget utilisation move exactly as for a manual entry', async () => {
  const { user, bank, cash, api } = await setup();
  const spent = await overallBudget(user, '5000');
  const beforeBalances = await balancesOf(user);
  assert.equal(await spent(), '0.00');

  const csv = [
    HEADER,
    `${isoDay()},expense,500,INR,Bank,,Food,upi,Imported expense,food`,
    `${isoDay()},income,1000,INR,Cash,,,cash,Imported income,`,
    `${isoDay()},transfer,250,INR,Bank,Cash,,,Imported transfer,`,
  ].join('\n');

  const res = await api.post('/api/data/import/commit', { csv });
  assert.equal(res.body.data.imported, 3);

  const after = await balancesOf(user);
  assert.equal(after[bank.id], (Number(beforeBalances[bank.id]) - 500 - 250).toFixed(2));
  assert.equal(after[cash.id], (Number(beforeBalances[cash.id]) + 1000 + 250).toFixed(2));
  assert.equal(await spent(), '500.00');

  const tagLinks = await TransactionTag.countDocuments({ user_id: user._id });
  assert.equal(tagLinks, 1);

  const dashboard = await api.get('/api/reports/dashboard');
  assert.equal(dashboard.status, 200);
});

test('IT_30 + UT_55: an exported file imports back into another account holder unchanged', async () => {
  const { user, bank, cash, food, api } = await setup();
  await record(user, { type: 'expense', amount: '99.99', account_id: bank.id, category_id: food.id, payment_mode: 'card', note: '=cmd()', tags: ['x'] });
  await record(user, { type: 'transfer', amount: '10', from_account_id: bank.id, to_account_id: cash.id, note: 'move' });
  const exported = (await api.raw('GET', '/api/data/transactions.csv')).buffer.toString('utf8');

  const other = await setup();
  const preview = await other.api.post('/api/data/import/preview', { csv: exported });
  assert.equal(preview.body.data.needs_mapping, false);
  assert.equal(preview.body.data.invalid_count, 0, JSON.stringify(preview.body.data.invalid_rows));
  const res = await other.api.post('/api/data/import/commit', { csv: exported });
  assert.equal(res.body.data.imported, 2);

  const again = (await other.api.raw('GET', '/api/data/transactions.csv')).buffer.toString('utf8');
  assert.deepEqual(parseCsv(again), parseCsv(exported));
});

test('ST_38 / SAF-5: an import that fails part-way leaves nothing behind', async () => {
  const { user, api } = await setup();
  const csv = [
    HEADER,
    `${isoDay()},expense,10,INR,Bank,,,cash,one,food`,
    `${isoDay()},expense,20,INR,Bank,,,cash,two,`,
    `${isoDay()},transfer,30,INR,Bank,Cash,,,three,`,
  ].join('\n');

  // Force a failure after the transactions have been written.
  const original = TransactionTag.insertMany;
  TransactionTag.insertMany = async () => {
    throw new Error('simulated failure');
  };

  try {
    const res = await api.post('/api/data/import/commit', { csv });
    assert.equal(res.status, 500);
  } finally {
    TransactionTag.insertMany = original;
  }

  assert.equal(await liveCount(user), 0);
  assert.equal(await TransactionTag.countDocuments({ user_id: user._id }), 0);
});

test('rollback removes exactly the records it is given', async () => {
  const { user, bank } = await setup();
  const keep = await record(user, { type: 'expense', amount: '5', account_id: bank.id, note: 'keep' });
  const drop = await Transaction.create({
    user_id: user._id, account_id: bank._id, type: 'expense', amount: '1.00',
    transaction_date: new Date(), note: 'drop',
  });

  await rollback(user._id, { transactions: [drop._id], transfers: [], links: [] });

  const notes = (await Transaction.find({ user_id: user._id }).lean()).map((t) => t.note);
  assert.deepEqual(notes, ['keep']);
  assert.ok(keep.id);
});

test('an import cannot use another user\'s accounts', async () => {
  const { api } = await setup();
  const stranger = await createUser('stranger');
  await createAccount(stranger, { name: 'Their Bank' });

  const csv = `${HEADER}\n${isoDay()},expense,10,INR,Their Bank,,,cash,x,\n`;
  const preview = await api.post('/api/data/import/preview', { csv });
  assert.equal(preview.body.data.valid_count, 0);
  assert.match(preview.body.data.invalid_rows[0].reasons[0], /does not exist/);
});

// ---------------------------------------------------------------------------
// REQ-87 - all of my data as one JSON file
// ---------------------------------------------------------------------------

test('ST_55: the JSON export holds every section and no secrets', async () => {
  const { user, bank, api } = await setup();
  await record(user, { type: 'expense', amount: '42', account_id: bank.id, note: 'Lunch', tags: ['food'] });
  await overallBudget(user, '9000');

  const res = await api.raw('GET', '/api/data/export.json');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /pfem-my-data-\d{4}-\d{2}-\d{2}\.json/);

  const data = JSON.parse(res.buffer.toString('utf8'));
  for (const section of ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'recurring_rules', 'reminders']) {
    assert.ok(Array.isArray(data[section]), `has ${section}`);
  }
  assert.equal(data.accounts.length, 2);
  assert.equal(data.transactions[0].amount, '42.00');
  assert.equal(data.budgets.length, 1);
  assert.equal(data.profile.email, user.email);

  const text = res.buffer.toString('utf8');
  assert.equal(text.includes('password_hash'), false);
  assert.equal(text.includes('not-a-real-hash'), false);

  const stranger = await createUser('stranger');
  await createAccount(stranger, { name: 'Not mine' });
  assert.equal(text.includes('Not mine'), false);
});

test('import and export require sign-in', async () => {
  const anonymous = apiAs(null);
  assert.equal((await anonymous.get('/api/data/export.json')).status, 401);
  assert.equal((await anonymous.post('/api/data/import/preview', { csv: 'a' })).status, 401);
});
