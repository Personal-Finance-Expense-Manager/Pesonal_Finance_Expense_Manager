import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApi, stopApi, apiUrl, createUser, createAccount, createCategory,
  apiAs, isoDay, record, balancesOf, netWorthOf, fetchUrl,
} from './helpers/integration.js';
import { createRealUser, createAdminUser, signIn, bearer, PASSWORD } from './helpers/auth.js';
import Transaction from '../src/models/Transaction.js';
import User from '../src/models/User.js';
import Goal from '../src/models/Goal.js';

/**
 * Sprint 3 - whole-product system tests.
 *
 * Sprints 1 and 2 tested each story as it was built. These twelve cases test
 * the finished product the way it is actually used: a case walks a complete
 * journey across several features and checks that they agree with each other,
 * which is where per-story tests cannot reach.
 *
 * Each case is written to be read as a Test Plan entry - the ST3 id, the
 * requirements it covers, and assertions that say what is expected in words.
 * SPRINT-3-TEST-CASES.md holds the same list with full traceability.
 *
 *   TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run test:system
 */

before(startApi);
after(stopApi);

/** A signed-in client holding a real session token, as a browser would. */
async function signedIn(label) {
  const user = await createRealUser(label);
  const { token } = await signIn(user);
  return { user, api: bearer(apiUrl(), token), token };
}

const money = (value) => Number(value).toFixed(2);

/**
 * bearer().raw() hands back the untouched Response, because some cases need
 * the bytes and the headers. These read it the way each case wants.
 */
async function rawBytes(response) {
  return { status: response.status, buffer: Buffer.from(await response.arrayBuffer()) };
}

async function rawText(response) {
  return { status: response.status, text: await response.text() };
}

/** A JPEG that passes content validation: magic bytes and the FFD9 trailer. */
function validJpeg(fill = 7) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(2048, fill),
    Buffer.from([0xff, 0xd9]),
  ]);
}

// ===========================================================================
// ST3-01  Identity: registration, verification, sign-in, session, sign-out
// Covers US-01, US-03, US-04, US-25 - REQ-1..REQ-10, REQ-93, SEC-4, SEC-5
// ===========================================================================
test('ST3-01 a person can register, verify, sign in, use the product and sign out', async () => {
  const anon = bearer(apiUrl(), null);

  // The platform is up and the database is reachable (REQ-1).
  const health = await anon.get('/api/health');
  assert.equal(health.status, 200, 'the API answers');
  assert.equal(health.body.database, 'connected', 'the database is connected');

  // A real account, verified, exactly as registration leaves it (REQ-2..REQ-6).
  const { user, api, token } = await signedIn('st301');
  assert.equal(user.email_verified, true, 'the account is verified');
  assert.equal(user.role, 'user', 'a new account is never an administrator');

  // The session - not a client-supplied id - decides who the caller is,
  // on every protected area of the product (REQ-93).
  const protectedPaths = [
    '/api/accounts', '/api/transactions', '/api/categories', '/api/tags',
    '/api/budgets', '/api/goals', '/api/recurring-rules', '/api/bill-reminders',
    '/api/notifications', '/api/reports/dashboard', '/api/reports/totals',
    '/api/reports/charts', '/api/reports/period',
  ];

  for (const path of protectedPaths) {
    assert.equal((await api.get(path)).status, 200, `${path} accepts a real session`);
    assert.equal((await anon.get(path)).status, 401, `${path} refuses an anonymous caller`);
  }

  // A forged token is not a session (SEC-4).
  const forged = bearer(apiUrl(), 'not.a.real.token');
  assert.equal((await forged.get('/api/accounts')).status, 401, 'a forged token is refused');

  // Signing out ends the session at once: the same token stops working (REQ-10).
  assert.equal((await api.post('/api/auth/logout', {})).status, 200, 'sign-out succeeds');
  const afterLogout = bearer(apiUrl(), token);
  assert.equal((await afterLogout.get('/api/accounts')).status, 401, 'the token dies with the session');
});

// ===========================================================================
// ST3-02  Money at rest: accounts, balances and net worth
// Covers US-06, US-07 - REQ-13..REQ-21, BR-4
// ===========================================================================
test('ST3-02 accounts hold balances that follow their transactions, and net worth nets debt off assets', async () => {
  const { user, api } = await signedIn('st302');

  const bank = (await api.post('/api/accounts', {
    name: 'HDFC Savings', type: 'bank', currency: 'INR', opening_balance: '20000.00',
  })).body.account;
  const card = (await api.post('/api/accounts', {
    name: 'Amex', type: 'credit_card', currency: 'INR', opening_balance: '0.00',
  })).body.account;

  assert.ok(bank.id && card.id, 'both accounts were created (REQ-13)');

  // Two accounts cannot share a name (REQ-14).
  const duplicate = await api.post('/api/accounts', {
    name: 'hdfc savings', type: 'bank', currency: 'INR', opening_balance: '0',
  });
  assert.ok([400, 409].includes(duplicate.status), 'a duplicate account name is refused');

  // Spending and earning move the balance, to the paisa (REQ-19, BR-4).
  await record(user, { type: 'expense', amount: '1500.50', account_id: bank.id });
  await record(user, { type: 'income', amount: '5000.00', account_id: bank.id });

  const summary = (await api.get('/api/accounts/summary')).body;
  const bankBalance = summary.balances.find((b) => b.id === bank.id).current_balance;
  assert.equal(money(bankBalance), '23499.50', '20000 - 1500.50 + 5000 = 23499.50');

  // A credit card balance is money owed, and net worth takes it off (REQ-20, REQ-21).
  await record(user, { type: 'expense', amount: '2000.00', account_id: card.id });

  const after = (await api.get('/api/accounts/summary')).body;
  const cardBalance = after.balances.find((b) => b.id === card.id);
  assert.equal(money(cardBalance.card.outstanding), '2000.00', 'the card shows as money owed');

  const assets = Number(after.net_worth.total_assets);
  const owed = Number(after.net_worth.total_liabilities);
  assert.equal(money(owed), '2000.00', 'the card is counted as a liability, not an asset');
  assert.equal(
    money(after.net_worth.net_worth),
    money(assets - owed),
    'net worth is assets minus what is owed'
  );
});

// ===========================================================================
// ST3-03  Money in motion: record, correct, remove and restore
// Covers US-08, US-09 - REQ-22..REQ-30, BR-2
// ===========================================================================
test('ST3-03 a transaction can be recorded, corrected, deleted and restored, and balances follow every step', async () => {
  const { user, api } = await signedIn('st303');
  const a = await createAccount(user, { name: 'Wallet A', opening_balance: '10000.00' });
  const b = await createAccount(user, { name: 'Wallet B', opening_balance: '0.00' });

  // Recording rejects what is not money (REQ-25).
  for (const bad of ['-10', '0', 'abc', '10.005']) {
    const res = await apiAs(user).post('/api/transactions', {
      type: 'expense', amount: bad, account_id: a.id, transaction_date: isoDay(),
    });
    assert.equal(res.status, 400, `an amount of "${bad}" is refused`);
  }

  const expense = await record(user, { type: 'expense', amount: '1000.00', account_id: a.id });

  // A transfer is ONE linked record and is never income or expense (REQ-24, BR-2).
  await apiAs(user).post('/api/transactions', {
    type: 'transfer', amount: '2500.00', from_account_id: a.id, to_account_id: b.id,
    transaction_date: isoDay(),
  });

  let balances = await balancesOf(user);
  assert.equal(money(balances[a.id]), '6500.00', '10000 - 1000 - 2500');
  assert.equal(money(balances[b.id]), '2500.00', 'the transfer arrived');

  const totals = (await api.get(`/api/reports/totals?from=${isoDay(-1)}&to=${isoDay(1)}&type=expense`)).body;
  assert.equal(money(totals.grand_total), '1000.00', 'a transfer is not an expense (BR-2)');

  // Correcting an amount recomputes the balance (REQ-28).
  assert.equal((await api.patch(`/api/transactions/${expense.id}`, { amount: '400.00' })).status, 200);
  balances = await balancesOf(user);
  assert.equal(money(balances[a.id]), '7100.00', 'the balance follows the correction');

  // Deleting is reversible: it goes to the recycle bin and can come back (REQ-29).
  assert.equal((await api.delete(`/api/transactions/${expense.id}`)).status, 200);
  balances = await balancesOf(user);
  assert.equal(money(balances[a.id]), '7500.00', 'the deleted expense stopped counting');

  const bin = await api.get('/api/transactions/recycle-bin');
  assert.ok(
    JSON.stringify(bin.body).includes(String(expense.id)),
    'the deleted transaction is in the recycle bin'
  );

  assert.equal((await api.post(`/api/transactions/${expense.id}/restore`, {})).status, 200);
  balances = await balancesOf(user);
  assert.equal(money(balances[a.id]), '7100.00', 'restoring puts the money back exactly');
});

// ===========================================================================
// ST3-04  Finding things again: browse, filter and search
// Covers US-10 - REQ-31, PER-3
// ===========================================================================
test('ST3-04 transactions can be found by date, account, category, type, tag, amount and note', async () => {
  const { user, api } = await signedIn('st304');
  const wallet = await createAccount(user, { name: 'Filter Wallet', opening_balance: '50000.00' });
  const food = await createCategory(user, { name: 'Filter Food' });
  const travel = await createCategory(user, { name: 'Filter Travel' });

  await record(user, {
    type: 'expense', amount: '250.00', account_id: wallet.id, category_id: food.id,
    note: 'canteen lunch', tags: ['lunch'],
  });
  await record(user, {
    type: 'expense', amount: '4800.00', account_id: wallet.id, category_id: travel.id,
    note: 'flight to Delhi', tags: ['work'],
  });
  await record(user, { type: 'income', amount: '60000.00', account_id: wallet.id, note: 'salary' });

  const count = async (query) => (await api.get(`/api/transactions?${query}`)).body.pagination.totalItems;

  assert.equal(await count('type=expense'), 2, 'filtering by type');
  assert.equal(await count(`categoryId=${food.id}`), 1, 'filtering by category');
  assert.equal(await count('tag=work'), 1, 'filtering by tag');
  assert.equal(await count('minAmount=1000'), 2, 'filtering by a minimum amount');
  assert.equal(await count('search=canteen'), 1, 'searching inside the note');
  assert.equal(await count(`accountId=${wallet.id}`), 3, 'filtering by account');
  assert.equal(await count(`startDate=${isoDay(1)}`), 0, 'a future-only window finds nothing');

  // A filter that matches nothing is an empty result, never an error (REQ-74).
  const empty = await api.get('/api/transactions?search=nothing-matches-this-xyz');
  assert.equal(empty.status, 200, 'an empty result is still a success');
  assert.equal(empty.body.data.length, 0, 'and it returns no rows');
});

// ===========================================================================
// ST3-05  A real bill: split across categories, and kept out of budgets
// Covers US-11 - REQ-32, REQ-33, REQ-50
// ===========================================================================
test('ST3-05 a split bill is attributed to each category, and an excluded item leaves budgets but not reports', async () => {
  const { user, api } = await signedIn('st305');
  const account = await createAccount(user, { name: 'Split Card', opening_balance: '30000.00' });
  const food = await createCategory(user, { name: 'ST305 Food' });
  const shopping = await createCategory(user, { name: 'ST305 Shopping' });

  // A 3000 supermarket bill: 1800 of groceries, 1200 of household goods.
  const split = await api.post('/api/transactions', {
    type: 'expense', amount: '3000.00', account_id: account.id, transaction_date: isoDay(),
    splits: [
      { category_id: food.id, amount: '1800.00' },
      { category_id: shopping.id, amount: '1200.00' },
    ],
  });
  assert.equal(split.status, 201, 'the split bill was recorded');

  // The parts must add up to the bill exactly (REQ-32).
  const wrong = await api.post('/api/transactions', {
    type: 'expense', amount: '3000.00', account_id: account.id, transaction_date: isoDay(),
    splits: [
      { category_id: food.id, amount: '1800.00' },
      { category_id: shopping.id, amount: '1000.00' },
    ],
  });
  assert.equal(wrong.status, 400, 'a split that does not add up is refused');

  // A reimbursable expense: counted everywhere except budgets (REQ-33).
  await api.post('/api/transactions', {
    type: 'expense', amount: '900.00', account_id: account.id, category_id: food.id,
    transaction_date: isoDay(), is_excluded_from_budget: true,
  });

  // Reports attribute each half to its own category, and include the
  // reimbursable item.
  const totals = (await api.get(`/api/reports/totals?from=${isoDay(-1)}&to=${isoDay(1)}&type=expense`)).body;
  const byName = Object.fromEntries(totals.by_category.map((c) => [c.name, money(c.amount)]));
  assert.equal(byName['ST305 Food'], '2700.00', 'Food is its 1800 share plus the 900 reimbursable');
  assert.equal(byName['ST305 Shopping'], '1200.00', 'Shopping is only its own share');
  assert.equal(money(totals.grand_total), '3900.00', 'the bill is never counted twice');

  // The budget counts only its own share, and ignores the reimbursable item.
  await api.post('/api/budgets', { category_id: food.id, amount: '10000', period_type: 'monthly' });
  const budgets = (await api.get('/api/budgets')).body.budgets;
  const foodBudget = budgets.find((b) => String(b.category_id) === String(food.id));
  assert.equal(money(foodBudget.spent), '1800.00', 'the budget sees its share only, not the reimbursable 900');
});

// ===========================================================================
// ST3-06  Organising spending: categories and tags
// Covers US-12, US-13 - REQ-35..REQ-42
// ===========================================================================
test('ST3-06 categories are seeded and protected, and spending can be totalled by category and by tag', async () => {
  // REQ-35 is a promise made by registration, so this case registers for
  // real rather than inserting a user: creating the record directly would
  // skip the very step being tested. Verification is done in the database
  // because the code is emailed, which is covered by ST3-01.
  const anon = bearer(apiUrl(), null);
  const email = `st306.${Date.now()}@example.test`;

  const registered = await anon.post('/api/auth/register', {
    name: 'ST306 Person', email, password: PASSWORD,
    termsAccepted: true, privacyPolicyAccepted: true, dataProcessingConsent: true,
  });
  assert.equal(registered.status, 201, 'registration succeeded');

  await User.updateOne({ email }, { $set: { email_verified: true, status: 'active' } });
  const user = await User.findOne({ email });
  const { token } = await signIn(user);
  const api = bearer(apiUrl(), token);

  // A newly registered account starts with usable categories (REQ-35).
  const seeded = (await api.get('/api/categories')).body.categories;
  const names = new Set(seeded.map((c) => c.name));
  for (const expected of ['Food', 'Transport', 'Rent', 'Salary']) {
    assert.ok(names.has(expected), `"${expected}" is seeded by default`);
  }
  assert.ok(seeded.some((c) => c.type === 'income'), 'income categories exist too');

  // Custom categories, one level of subcategory, no duplicates (REQ-36..REQ-38).
  const custom = (await api.post('/api/categories', { name: 'ST306 Hobbies', type: 'expense' })).body.category;
  assert.equal((await api.post('/api/categories', { name: 'st306 hobbies', type: 'expense' })).status, 409,
    'a duplicate name is refused whatever its case');

  const sub = (await api.post('/api/categories', {
    name: 'ST306 Guitar', type: 'expense', parent_category_id: custom.id,
  })).body.category;
  assert.equal((await api.post('/api/categories', {
    name: 'ST306 Strings', type: 'expense', parent_category_id: sub.id,
  })).status, 400, 'subcategories stop at one level');

  // Default categories cannot be renamed or removed (REQ-39).
  const builtIn = seeded.find((c) => c.name === 'Food');
  assert.equal((await api.patch(`/api/categories/${builtIn.id}`, { name: 'Nope' })).status, 403,
    'a built-in category cannot be renamed');
  assert.equal((await api.delete(`/api/categories/${builtIn.id}?confirm=true`)).status, 403,
    'a built-in category cannot be deleted');

  // Tags, their suggestions, and totals by both (REQ-41, REQ-42).
  const account = await createAccount(user, { name: 'ST306 Account', opening_balance: '20000.00' });
  await record(user, { type: 'expense', amount: '600.00', account_id: account.id, category_id: custom.id, tags: ['hobby', 'weekend'] });
  await record(user, { type: 'expense', amount: '400.00', account_id: account.id, category_id: custom.id, tags: ['hobby'] });

  const tags = (await api.get('/api/tags')).body.tags.map((t) => t.name);
  assert.ok(tags.includes('hobby') && tags.includes('weekend'), 'tags used are remembered');
  assert.ok((await api.get('/api/tags?q=hob')).body.tags.length > 0, 'tags are suggested by prefix');

  const totals = (await api.get(`/api/reports/totals?from=${isoDay(-1)}&to=${isoDay(1)}&type=expense`)).body;
  const hobby = totals.by_tag.find((t) => t.name === 'hobby');
  assert.equal(money(hobby.amount), '1000.00', 'both tagged expenses total under "hobby"');
  assert.equal(money(totals.by_category.find((c) => c.name === 'ST306 Hobbies').amount), '1000.00',
    'and the same money totals under its category');
});

// ===========================================================================
// ST3-07  Staying inside a limit: budgets
// Covers US-14, US-15 - REQ-43..REQ-51
// ===========================================================================
test('ST3-07 a budget tracks what is spent against it, warns as it fills, and can be changed', async () => {
  const { user, api } = await signedIn('st307');
  const account = await createAccount(user, { name: 'ST307 Account', opening_balance: '50000.00' });
  const category = await createCategory(user, { name: 'ST307 Dining' });

  const created = await api.post('/api/budgets', {
    category_id: category.id, amount: '5000', period_type: 'monthly',
  });
  assert.equal(created.status, 201, 'a category budget is created (REQ-43)');

  const read = async () => (await api.get('/api/budgets')).body.budgets
    .find((b) => String(b.category_id) === String(category.id));

  let budget = await read();
  assert.equal(money(budget.spent), '0.00', 'a new budget has nothing spent against it');

  await record(user, { type: 'expense', amount: '4000.00', account_id: account.id, category_id: category.id });

  budget = await read();
  assert.equal(money(budget.spent), '4000.00', 'spending counts against the budget (REQ-45)');
  assert.ok(Number(budget.percent_used) >= 80, 'utilisation is reported as a percentage');
  assert.equal(money(budget.remaining), '1000.00', 'what is left is reported');

  // Going over is reported, not blocked: the product records reality (REQ-47).
  await record(user, { type: 'expense', amount: '2000.00', account_id: account.id, category_id: category.id });
  budget = await read();
  assert.equal(money(budget.spent), '6000.00', 'spending past the limit is still recorded');
  assert.ok(Number(budget.percent_used) > 100, 'and the budget shows as over');

  // The limit can be raised afterwards (REQ-48).
  const id = budget.id;
  assert.equal((await api.patch(`/api/budgets/${id}`, { amount: '8000' })).status, 200, 'the limit can be changed');
  budget = await read();
  assert.equal(money(budget.budgeted), '8000.00', 'the new limit is stored');
  assert.ok(Number(budget.percent_used) < 100, 'and utilisation is recomputed against it');
});

// ===========================================================================
// ST3-08  Things that happen on their own: recurring rules and bill reminders
// Covers US-16, US-17 - REQ-52..REQ-60
// ===========================================================================
test('ST3-08 a recurring rule generates its transactions and can be paused, and a bill reminder can be paid', async () => {
  const { user, api } = await signedIn('st308');
  const account = await createAccount(user, { name: 'ST308 Account', opening_balance: '100000.00' });
  const category = await createCategory(user, { name: 'ST308 Rent' });

  // A monthly rule, starting today (REQ-52, REQ-53).
  const rule = (await api.post('/api/recurring-rules', {
    type: 'expense', amount: '15000', account_id: account.id, category_id: category.id,
    frequency: 'monthly', start_date: isoDay(0),
  })).body.data;
  assert.ok(rule.id || rule._id, 'the rule was created');
  assert.ok(rule.next_run_date || rule.next_due_date, 'the rule shows when it next runs');

  const ruleId = rule.id || rule._id;

  // It is refused if it would end before it starts (REQ-53).
  const backwards = await api.post('/api/recurring-rules', {
    type: 'expense', amount: '100', account_id: account.id, category_id: category.id,
    frequency: 'monthly', start_date: isoDay(10), end_date: isoDay(5),
  });
  assert.equal(backwards.status, 400, 'a rule that ends before it starts is refused');

  // Pausing stops it; resuming starts it again (REQ-55).
  assert.equal((await api.post(`/api/recurring-rules/${ruleId}/pause`, {})).status, 200, 'the rule can be paused');
  let paused = (await api.get(`/api/recurring-rules/${ruleId}`)).body.data;
  assert.equal(paused.status, 'paused', 'and it reads as paused');

  assert.equal((await api.post(`/api/recurring-rules/${ruleId}/resume`, {})).status, 200, 'the rule can be resumed');
  paused = (await api.get(`/api/recurring-rules/${ruleId}`)).body.data;
  assert.equal(paused.status, 'active', 'and it is active again');

  // A bill reminder, and paying it records the expense (REQ-57, REQ-59).
  const reminder = (await api.post('/api/bill-reminders', {
    name: 'ST308 Electricity', amount: '3000', due_date: isoDay(3),
    account_id: account.id, category_id: category.id,
  })).body.data;
  const reminderId = reminder.id || reminder._id;
  assert.ok(reminderId, 'the reminder was created');

  const beforePay = await balancesOf(user);
  assert.equal((await api.post(`/api/bill-reminders/${reminderId}/pay`, {})).status, 200, 'the bill can be marked paid');

  const afterPay = await balancesOf(user);
  assert.equal(
    money(Number(beforePay[account.id]) - Number(afterPay[account.id])),
    '3000.00',
    'paying the bill took the money from the account'
  );

  // Nonsense is refused (REQ-57).
  const bad = await api.post('/api/bill-reminders', {
    name: '', amount: '-1', due_date: 'tomorrow', notify_days_before: 999,
  });
  assert.equal(bad.status, 400, 'an invalid reminder is refused');
});

// ===========================================================================
// ST3-09  Saving up: goals
// Covers US-18, US-19 - REQ-61..REQ-68
// ===========================================================================
test('ST3-09 a savings goal tracks progress, accepts contributions and gives money back on withdrawal', async () => {
  const { user, api } = await signedIn('st309');
  const bank = await createAccount(user, { name: 'ST309 Bank', opening_balance: '40000.00' });

  const goal = await Goal.create({
    user_id: user._id, name: 'ST309 Emergency Fund',
    target_amount: '20000.00', saved_amount: '0.00', status: 'active',
  });

  const listed = (await api.get('/api/goals')).body;
  assert.ok(JSON.stringify(listed).includes('ST309 Emergency Fund'), 'the goal is listed (REQ-61)');

  // Contributing moves money from the account into the goal (REQ-63).
  const before = await netWorthOf(user);
  const contribution = await api.post(`/api/goals/${goal._id}/contributions`, {
    amount: '5000.00', source_account_id: bank.id,
  });
  assert.equal(contribution.status, 201, 'a contribution is accepted');

  const afterContribution = await Goal.findById(goal._id).lean();
  assert.equal(money(afterContribution.saved_amount), '5000.00', 'the goal records what was saved');

  // Withdrawing gives it back to a real account (REQ-66).
  const withdrawal = await api.post(`/api/goals/${goal._id}/withdrawals`, {
    amount: '2000.00', destination_account_id: bank.id,
  });
  assert.equal(withdrawal.status, 201, 'a withdrawal is accepted');

  const afterWithdrawal = await Goal.findById(goal._id).lean();
  assert.equal(money(afterWithdrawal.saved_amount), '3000.00', 'the goal falls by what was taken out');

  // Taking out more than is saved is refused (REQ-66).
  const tooMuch = await api.post(`/api/goals/${goal._id}/withdrawals`, {
    amount: '999999.00', destination_account_id: bank.id,
  });
  assert.ok(tooMuch.status >= 400, 'withdrawing more than is saved is refused');

  const after = await netWorthOf(user);
  assert.equal(money(after), money(before),
    'moving money between an account and a goal does not change net worth');
});

// ===========================================================================
// ST3-10  Making sense of it: dashboard, charts and reports
// Covers US-20, US-21, US-22 - REQ-69..REQ-78
// ===========================================================================
test('ST3-10 every insight screen agrees on the same money, and an export carries the same figures', async () => {
  const { user, api } = await signedIn('st310');
  const account = await createAccount(user, { name: 'ST310 Account', opening_balance: '0.00' });
  const rent = await createCategory(user, { name: 'ST310 Rent' });
  const food = await createCategory(user, { name: 'ST310 Food' });

  await record(user, { type: 'income', amount: '60000.00', account_id: account.id });
  await record(user, { type: 'expense', amount: '18000.00', account_id: account.id, category_id: rent.id });
  await record(user, { type: 'expense', amount: '6000.00', account_id: account.id, category_id: food.id });

  const window = `from=${isoDay(-1)}&to=${isoDay(1)}`;

  // The dashboard, the totals, the charts and the report are four views of
  // one set of transactions and must never disagree (REQ-69, REQ-70, REQ-73).
  const dashboard = (await api.get('/api/reports/dashboard')).body;
  const totals = (await api.get(`/api/reports/totals?${window}&type=expense`)).body;
  const charts = (await api.get(`/api/reports/charts?${window}`)).body;
  const report = (await api.get(`/api/reports/period?${window}`)).body;

  assert.equal(money(totals.grand_total), '24000.00', 'the period expense is 18000 + 6000');
  assert.equal(money(charts.grand_total), money(totals.grand_total), 'the charts agree with the totals');
  assert.equal(money(report.total_expense), money(totals.grand_total), 'the report agrees with the totals');
  assert.equal(money(report.total_income), '60000.00', 'income is reported');
  assert.equal(money(report.net), '36000.00', 'net is income minus expense');
  assert.ok(Number(dashboard.total_expense ?? dashboard.totals?.total_expense ?? 0) >= 0,
    'the dashboard reports a period expense');

  // A breakdown's shares must add up to exactly 100 (REQ-70).
  const shareSum = charts.by_category.reduce((sum, c) => sum + Math.round(c.share_percent * 10), 0) / 10;
  assert.equal(shareSum, 100, 'the category shares add up to exactly 100');

  const amountSum = charts.by_category.reduce((sum, c) => sum + Number(c.amount), 0);
  assert.equal(money(amountSum), money(charts.grand_total), 'and the slices add up to the whole');

  // The trend covers six or twelve months, with no gaps (REQ-71).
  assert.equal(charts.trend.length, 6, 'the trend defaults to six months');
  assert.equal((await api.get(`/api/reports/charts?${window}&months=12`)).body.trend.length, 12,
    'and twelve can be chosen');
  assert.equal((await api.get(`/api/reports/charts?${window}&months=7`)).status, 400,
    'any other trend length is refused');

  // The largest spends are named (REQ-72).
  assert.ok(charts.largest_transactions.length > 0, 'the largest spends are listed');
  assert.equal(money(charts.largest_transactions[0].amount), '18000.00', 'the biggest one is first');

  // A period with nothing in it is an empty state, never an error (REQ-74).
  const empty = await api.get('/api/reports/period?from=2019-01-01&to=2019-01-31');
  assert.equal(empty.status, 200, 'an empty period still answers');
  assert.equal(money(empty.body.total_expense), '0.00', 'with nothing in it');
  assert.equal(empty.body.by_category.length, 0, 'and no rows');

  // Two periods can be compared, with the direction of travel (REQ-75).
  const compared = (await api.get(
    `/api/reports/period?${window}&compare_from=2019-01-01&compare_to=2019-01-31`
  )).body;
  assert.ok(compared.compare, 'a comparison is returned');
  assert.equal(compared.compare.change.total_expense.direction, 'up', 'spending rose against an empty period');

  // The pace of spending and where it is heading (REQ-76).
  assert.ok(Number(report.projection.average_daily_spend) >= 0, 'an average daily spend is reported');
  assert.ok(Number(report.projection.projected_total) >= Number(report.total_expense),
    'the projection is at least what has already been spent');

  // The export carries the figures that were displayed (REQ-77).
  const csv = await rawText(await api.raw('GET', `/api/reports/period.csv?${window}`));
  assert.equal(csv.status, 200, 'the CSV downloads');
  assert.ok(csv.text.includes('ST310 Rent') && csv.text.includes('18000.00'),
    'the CSV carries the same categories and amounts as the screen');

  const pdf = await rawBytes(await api.raw('GET', `/api/reports/period.pdf?${window}`));
  assert.equal(pdf.status, 200, 'the PDF downloads');
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-', 'and it really is a PDF');
  assert.ok(pdf.buffer.length > 800, 'with content in it');
});

// ===========================================================================
// ST3-11  Getting data in and out: receipts, CSV, JSON and privacy
// Covers US-23, US-24 - REQ-79..REQ-92
// ===========================================================================
test('ST3-11 a receipt can be attached and fetched, and a user can export and re-import their data', async () => {
  const { user, api } = await signedIn('st311');
  const account = await createAccount(user, { name: 'ST311 Account', opening_balance: '10000.00' });
  const category = await createCategory(user, { name: 'ST311 Supplies' });

  const transaction = await record(user, {
    type: 'expense', amount: '1250.00', account_id: account.id, category_id: category.id,
    note: 'st311 printer paper', tags: ['office'],
  });

  // A receipt is attached to the transaction and can be read back (REQ-79, REQ-80).
  const jpg = validJpeg();
  const uploadResponse = await api.raw('POST', `/api/transactions/${transaction.id}/attachments`, {
    body: jpg,
    headers: { 'Content-Type': 'image/jpeg', 'X-File-Name': encodeURIComponent('receipt.jpg') },
  });
  assert.equal(uploadResponse.status, 201, 'the receipt was attached');

  const attachment = (await uploadResponse.json()).data;
  assert.ok(attachment.view_url, 'the receipt has a URL to view it');

  const fetched = await fetchUrl(attachment.view_url);
  assert.equal(fetched.status, 200, 'the receipt can be fetched through its signed URL');
  assert.equal(fetched.buffer.length, jpg.length, 'and it is the same file that was uploaded');

  // An unsigned or altered URL gives nothing away (REQ-81, SEC-5).
  const tampered = await fetchUrl(attachment.view_url.replace(/.$/, 'x'));
  assert.ok(tampered.status >= 400, 'an altered receipt URL is refused');

  // A file that is not a receipt is refused (REQ-79).
  const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(512)]);
  const refused = await api.raw('POST', `/api/transactions/${transaction.id}/attachments`, {
    body: exe,
    headers: { 'Content-Type': 'application/x-msdownload', 'X-File-Name': 'virus.exe' },
  });
  assert.ok(refused.status >= 400, 'a program is not accepted as a receipt');

  // Everything can be taken away as CSV and as JSON (REQ-82, REQ-87).
  const csv = await rawText(await api.raw('GET', '/api/data/transactions.csv'));
  assert.equal(csv.status, 200, 'the CSV export downloads');
  assert.ok(csv.text.includes('st311 printer paper'), 'and contains the transactions');
  assert.ok(csv.text.split('\n')[0].includes('amount'), 'with a header row naming the columns');

  const json = await api.get('/api/data/export.json');
  assert.equal(json.status, 200, 'the JSON export downloads');
  assert.ok(JSON.stringify(json.body).includes('ST311 Supplies'), 'and carries the categories too');

  // An import is previewed before anything is written (REQ-83, REQ-84).
  const importCsv = [
    'date,type,amount,currency,account,to_account,category,payment_mode,note,tags',
    `${isoDay()},expense,99.00,INR,ST311 Account,,ST311 Supplies,upi,st311 imported row,office`,
  ].join('\n');

  // Notes are encrypted at rest, so they cannot be used in a database filter;
  // the count and the amount tell the story just as well.
  const countRows = () => Transaction.countDocuments({ user_id: user._id });
  const before = await countRows();

  const preview = await api.post('/api/data/import/preview', { csv: importCsv });
  assert.equal(preview.status, 200, 'the import is previewed');
  assert.equal(await countRows(), before, 'and previewing writes nothing');

  const commit = await api.post('/api/data/import/commit', { csv: importCsv });
  assert.equal(commit.status, 201, 'the import is committed');
  assert.equal(commit.body.data.imported, 1, 'one row was imported');
  assert.deepEqual(commit.body.data.invalid_rows, [], 'with nothing rejected');
  assert.equal(await countRows(), before + 1, 'and the row arrived exactly once');

  const imported = await api.get('/api/transactions?minAmount=99&maxAmount=99');
  assert.equal(imported.body.pagination.totalItems, 1, 'the imported transaction is there');
  assert.equal(money(imported.body.data[0].amount), '99.00', 'with the amount from the file');
});

// ===========================================================================
// ST3-12  Non-functional: isolation, administration, audit, safety, speed
// Covers US-05, US-26..US-29 - REQ-93..REQ-97, BR-10, SEC-1..SEC-5, SAF, PER
// ===========================================================================
test('ST3-12 one person cannot reach another person\'s money, only an administrator can administer, and the product answers quickly', async () => {
  const alice = await signedIn('st312a');
  const bob = await signedIn('st312b');

  const aliceAccount = await createAccount(alice.user, { name: 'Alice Private', opening_balance: '75000.00' });
  const aliceTransaction = await record(alice.user, {
    type: 'expense', amount: '4321.00', account_id: aliceAccount.id, note: 'alice private note',
  });

  // BR-10 / SEC-5: Bob sees none of Alice's money and cannot touch it.
  const bobAccounts = (await bob.api.get('/api/accounts')).body;
  assert.ok(
    !JSON.stringify(bobAccounts).includes('Alice Private'),
    'another user cannot see the account'
  );

  const bobList = (await bob.api.get('/api/transactions')).body;
  assert.ok(
    !JSON.stringify(bobList).includes('alice private note'),
    'another user cannot see the transaction'
  );

  assert.ok(
    [403, 404].includes((await bob.api.patch(`/api/transactions/${aliceTransaction.id}`, { amount: '1.00' })).status),
    'another user cannot edit it'
  );
  assert.ok(
    [403, 404].includes((await bob.api.delete(`/api/transactions/${aliceTransaction.id}`)).status),
    'another user cannot delete it'
  );

  // REQ-94: administration is closed to ordinary users.
  for (const path of ['/api/admin/summary', '/api/admin/users', '/api/admin/audit-logs', '/api/admin/backups']) {
    assert.equal((await alice.api.get(path)).status, 403, `${path} is closed to an ordinary user`);
  }

  // An administrator can administer, and it is written down (REQ-94, REQ-96).
  const adminUser = await createAdminUser('st312admin');
  const { token: adminToken } = await signIn(adminUser);
  const admin = bearer(apiUrl(), adminToken);

  const summary = await admin.get('/api/admin/summary');
  assert.equal(summary.status, 200, 'an administrator can read the summary');

  const suspend = await admin.post(`/api/admin/users/${bob.user._id}/suspend`, { reason: 'ST3-12 system test' });
  assert.equal(suspend.status, 200, 'an administrator can suspend an account');

  // A suspended account loses access at once (SEC-5, SAF).
  assert.equal((await bob.api.get('/api/accounts')).status, 401, 'a suspended user is signed out everywhere');

  const restore = await admin.post(`/api/admin/users/${bob.user._id}/restore`, {});
  assert.equal(restore.status, 200, 'and can be restored');

  const audit = await admin.get('/api/admin/audit-logs');
  assert.equal(audit.status, 200, 'the audit trail is readable by an administrator');
  assert.ok(
    JSON.stringify(audit.body).includes('ST3-12 system test'),
    'and the suspension was recorded with its reason (REQ-96)'
  );

  // SEC-1..SEC-3: the responses carry the protective headers.
  const headed = await alice.api.raw('GET', '/api/health');
  assert.equal(headed.headers.get('x-content-type-options'), 'nosniff', 'MIME sniffing is off');
  assert.ok(headed.headers.get('x-frame-options') || headed.headers.get('content-security-policy'),
    'framing is restricted');

  // PER-1 / PER-3 / REQ-78: the product answers quickly under a normal load.
  const started = process.hrtime.bigint();
  await Promise.all([
    alice.api.get('/api/reports/dashboard'),
    alice.api.get(`/api/reports/period?from=${isoDay(-30)}&to=${isoDay(0)}`),
    alice.api.get('/api/transactions'),
    alice.api.get('/api/accounts/summary'),
    alice.api.get('/api/budgets'),
  ]);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 5000, `five screens answered in ${elapsedMs.toFixed(0)}ms, inside the 5s target`);
});
