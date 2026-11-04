import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startApi,
  stopApi,
  createUser,
  createAccount,
  apiAs,
  balancesOf,
  netWorthOf,
} from './helpers/integration.js';
import Goal from '../src/models/Goal.js';
import GoalWithdrawal from '../src/models/GoalWithdrawal.js';

before(startApi);
after(stopApi);

async function createGoal(user, savedAmount = '500.00') {
  return Goal.create({
    user_id: user._id,
    name: 'Emergency Fund',
    target_amount: '2000.00',
    saved_amount: savedAmount,
    status: 'active',
  });
}

test('US-19: withdrawing savings reduces the goal and increases destination account balance', async () => {
  const user = await createUser();
  const bank = await createAccount(user, { opening_balance: '1000.00' });
  const goal = await createGoal(user);

  const beforeNetWorth = await netWorthOf(user);

  const response = await apiAs(user).post(
    `/api/goals/${goal._id}/withdrawals`,
    {
      amount: '200.00',
      destination_account_id: bank.id,
    },
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.goal.saved_amount, '300.00');

  const updatedGoal = await Goal.findById(goal._id);
  assert.equal(updatedGoal.saved_amount.toString(), '300.00');

  assert.equal(
    await GoalWithdrawal.countDocuments({
      user_id: user._id,
      goal_id: goal._id,
    }),
    1,
  );

  const balances = await balancesOf(user);
  assert.equal(balances[bank.id], '1200.00');

  assert.equal(await netWorthOf(user), beforeNetWorth);
});

test('US-19: withdrawal cannot exceed the saved amount', async () => {
  const user = await createUser();
  const bank = await createAccount(user);
  const goal = await createGoal(user, '100.00');

  const response = await apiAs(user).post(
    `/api/goals/${goal._id}/withdrawals`,
    {
      amount: '150.00',
      destination_account_id: bank.id,
    },
  );

  assert.equal(response.status, 400);

  const unchangedGoal = await Goal.findById(goal._id);
  assert.equal(unchangedGoal.saved_amount.toString(), '100.00');

  assert.equal(
    await GoalWithdrawal.countDocuments({ goal_id: goal._id }),
    0,
  );
});

test('US-19: withdrawal rejects another user account and credit card destination', async () => {
  const user = await createUser();
  const otherUser = await createUser();

  const goal = await createGoal(user);
  const otherBank = await createAccount(otherUser);
  const creditCard = await createAccount(user, {
    type: 'credit_card',
  });

  const api = apiAs(user);

  const otherAccountResponse = await api.post(
    `/api/goals/${goal._id}/withdrawals`,
    {
      amount: '50.00',
      destination_account_id: otherBank.id,
    },
  );

  assert.equal(otherAccountResponse.status, 404);

  const creditCardResponse = await api.post(
    `/api/goals/${goal._id}/withdrawals`,
    {
      amount: '50.00',
      destination_account_id: creditCard.id,
    },
  );

  assert.equal(creditCardResponse.status, 400);

  const unchangedGoal = await Goal.findById(goal._id);
  assert.equal(unchangedGoal.saved_amount.toString(), '500.00');

  assert.equal(
    await GoalWithdrawal.countDocuments({ goal_id: goal._id }),
    0,
  );
});

test('US-19: withdrawing from a completed goal reactivates it when below target', async () => {
  const user = await createUser();
  const bank = await createAccount(user);

  const goal = await Goal.create({
    user_id: user._id,
    name: 'Completed Goal',
    target_amount: '500.00',
    saved_amount: '500.00',
    status: 'completed',
  });

  const response = await apiAs(user).post(
    `/api/goals/${goal._id}/withdrawals`,
    {
      amount: '100.00',
      destination_account_id: bank.id,
    },
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.goal.saved_amount, '400.00');
  assert.equal(response.body.goal.status, 'active');
});