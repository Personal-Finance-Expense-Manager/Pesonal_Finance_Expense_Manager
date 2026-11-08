import { useCallback, useEffect, useState } from 'react';
import { goalDeletionWarning } from './financialSafety.js';
import { authHeaders, isSignedIn } from './auth.js';
import { SignedOutPage } from './SignInRequired.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0b1120',
    color: '#f8fafc',
    padding: '30px 20px',
    fontFamily: 'Inter, Segoe UI, sans-serif',
  },
  container: { maxWidth: 1100, margin: '0 auto' },
  panel: {
    background: '#172033',
    border: '1px solid #283449',
    borderRadius: 14,
    padding: 22,
    marginBottom: 20,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: 12,
    marginTop: 7,
    marginBottom: 15,
    border: '1px solid #344054',
    borderRadius: 8,
    background: '#101827',
    color: '#f8fafc',
  },
  button: {
    padding: '11px 17px',
    border: 0,
    borderRadius: 8,
    background: '#16a34a',
    color: 'white',
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondary: {
    padding: '9px 13px',
    border: '1px solid #475569',
    borderRadius: 8,
    background: '#263449',
    color: '#f8fafc',
    cursor: 'pointer',
  },
  label: { display: 'block', color: '#cbd5e1', fontSize: 14 },
};

function money(value) {
  const number = Number(value || 0);
  return `₹${number.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getItems(data, key) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function getError(data) {
  return data?.message || data?.error || 'Something went wrong.';
}

function SavingsGoalsContent() {
  const [goals, setGoals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    name: '',
    target_amount: '',
    target_date: '',
    linked_account_id: '',
  });

  const [contribution, setContribution] = useState({
    goalId: '',
    amount: '',
    source_account_id: '',
  });

  const [withdrawal, setWithdrawal] = useState({
    goalId: '',
    amount: '',
    destination_account_id: '',
  });

  const [editingId, setEditingId] = useState(null);

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}/api${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(getError(data));
    }

    return data;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [goalData, accountData] = await Promise.all([
        request('/goals'),
        request('/accounts'),
      ]);

      setGoals(getItems(goalData, 'goals'));
      setAccounts(getItems(accountData, 'accounts'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);

    try {
      const payload = {
        ...form,
        target_amount: Number(form.target_amount),
        linked_account_id: form.linked_account_id || null,
      };

      if (editingId) {
        await request(`/goals/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setMessage('Savings goal updated successfully.');
      } else {
        await request('/goals', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('Savings goal created successfully.');
      }

      setForm({
        name: '',
        target_amount: '',
        target_date: '',
        linked_account_id: '',
      });
      setEditingId(null);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(goal) {
    setEditingId(goal._id || goal.id);
    setForm({
      name: goal.name || '',
      target_amount: String(goal.target_amount || ''),
      target_date: goal.target_date
        ? String(goal.target_date).slice(0, 10)
        : '',
      linked_account_id: goal.linked_account_id?._id
        || goal.linked_account_id
        || '',
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteGoal(goal) {
    const id = goal._id || goal.id;

    if (!window.confirm(
      goalDeletionWarning(goal)
    )) return;

    setError('');
    setMessage('');
    setBusy(true);

    try {
      await request(`/goals/${id}?confirm=true`, {
        method: 'DELETE',
      });

      setMessage('Savings goal deleted successfully.');
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleContribution(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!contribution.goalId) {
      setError('Select a savings goal.');
      return;
    }

    setBusy(true);

    try {
      await request(`/goals/${contribution.goalId}/contributions`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(contribution.amount),
          source_account_id: contribution.source_account_id,
          contribution_date: new Date().toISOString().slice(0, 10),
        }),
      });

      setMessage('Contribution added successfully.');
      setContribution({
        goalId: '',
        amount: '',
        source_account_id: '',
      });

      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdrawal(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!withdrawal.goalId) {
      setError('Select a savings goal.');
      return;
    }

    if (!window.confirm(
      `Withdraw ${money(withdrawal.amount)} from this savings goal?`
    )) return;

    setBusy(true);

    try {
      await request(`/goals/${withdrawal.goalId}/withdrawals`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(withdrawal.amount),
          destination_account_id: withdrawal.destination_account_id,
          withdrawal_date: new Date().toISOString().slice(0, 10),
        }),
      });

      setMessage('Withdrawal completed successfully.');
      setWithdrawal({
        goalId: '',
        amount: '',
        destination_account_id: '',
      });

      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function getGoalId(goal) {
    return goal._id || goal.id;
  }

  function getSaved(goal) {
    return Number(goal.saved_amount || 0);
  }

  function getTarget(goal) {
    return Number(goal.target_amount || 0);
  }

  function getProgress(goal) {
    if (goal.progress_percent !== undefined) {
      return Math.min(100, Number(goal.progress_percent));
    }

    const target = getTarget(goal);
    return target > 0
      ? Math.min(100, (getSaved(goal) / target) * 100)
      : 0;
  }

  function getStatus(goal) {
    return goal.status === 'completed' || goal.status === 'achieved'
      ? 'Achieved'
      : goal.status || 'Active';
  }

  const availableAccounts = accounts.filter(
    (account) => account.type !== 'credit_card'
  );

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 25,
        }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30 }}>Savings Goals</h1>
            <p style={{ color: '#94a3b8' }}>
              Plan your savings and track your progress.
            </p>
          </div>

          <a href="#/" style={{ color: '#86efac' }}>
            ← Back to home
          </a>
        </header>

        {error && (
          <div role="alert" style={{
            ...styles.panel,
            color: '#fecaca',
            borderColor: '#7f1d1d',
          }}>
            {error}
          </div>
        )}

        {message && (
          <div role="status" style={{
            ...styles.panel,
            color: '#86efac',
            borderColor: '#166534',
          }}>
            {message}
          </div>
        )}

        <section style={styles.panel}>
          <h2>{editingId ? 'Edit Savings Goal' : 'Create a Savings Goal'}</h2>

          <form onSubmit={handleSubmit}>
            <label style={styles.label}>
              Goal name
              <input
                style={styles.input}
                name="name"
                value={form.name}
                onChange={updateForm}
                placeholder="Example: Buy a new bike"
                maxLength={120}
                required
              />
            </label>

            <label style={styles.label}>
              Target amount (₹)
              <input
                style={styles.input}
                name="target_amount"
                type="number"
                min="0.01"
                step="0.01"
                value={form.target_amount}
                onChange={updateForm}
                placeholder="100000"
                required
              />
            </label>

            <label style={styles.label}>
              Target date
              <input
                style={styles.input}
                name="target_date"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={form.target_date}
                onChange={updateForm}
                required
              />
            </label>

            <label style={styles.label}>
              Linked account (optional)
              <select
                style={styles.input}
                name="linked_account_id"
                value={form.linked_account_id}
                onChange={updateForm}
              >
                <option value="">No linked account</option>
                {availableAccounts.map((account) => (
                  <option
                    key={account._id || account.id}
                    value={account._id || account.id}
                  >
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <button style={styles.button} disabled={busy}>
              {busy
                ? 'Please wait...'
                : editingId
                  ? 'Update Goal'
                  : 'Create Goal'}
            </button>

            {editingId && (
              <button
                type="button"
                style={{ ...styles.secondary, marginLeft: 10 }}
                onClick={() => {
                  setEditingId(null);
                  setForm({
                    name: '',
                    target_amount: '',
                    target_date: '',
                    linked_account_id: '',
                  });
                }}
              >
                Cancel Edit
              </button>
            )}
          </form>
        </section>

        <section style={styles.panel}>
          <h2>Add a Contribution</h2>

          <form
            onSubmit={handleContribution}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <label style={styles.label}>
              Savings goal
              <select
                style={styles.input}
                value={contribution.goalId}
                onChange={(event) => setContribution((current) => ({
                  ...current,
                  goalId: event.target.value,
                }))}
                required
              >
                <option value="">Select goal</option>
                {goals
                  .filter((goal) => getStatus(goal) !== 'Achieved')
                  .map((goal) => (
                    <option key={getGoalId(goal)} value={getGoalId(goal)}>
                      {goal.name}
                    </option>
                  ))}
              </select>
            </label>

            <label style={styles.label}>
              Amount (₹)
              <input
                style={styles.input}
                type="number"
                min="0.01"
                step="0.01"
                value={contribution.amount}
                onChange={(event) => setContribution((current) => ({
                  ...current,
                  amount: event.target.value,
                }))}
                required
              />
            </label>

            <label style={styles.label}>
              Source account
              <select
                style={styles.input}
                value={contribution.source_account_id}
                onChange={(event) => setContribution((current) => ({
                  ...current,
                  source_account_id: event.target.value,
                }))}
                required
              >
                <option value="">Select account</option>
                {availableAccounts.map((account) => (
                  <option
                    key={account._id || account.id}
                    value={account._id || account.id}
                  >
                    {account.name} — {money(account.current_balance)}
                  </option>
                ))}
              </select>
            </label>

            <button style={styles.button} disabled={busy}>
              Add Savings
            </button>
          </form>
        </section>

        <section style={{
          ...styles.panel,
          borderColor: '#166534',
        }}>
          <h2>Withdraw Savings</h2>
          <p style={{ color: '#94a3b8' }}>
            Transfer saved money from a goal back into one of your accounts.
          </p>

          <form
            onSubmit={handleWithdrawal}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <label style={styles.label}>
              Savings goal
              <select
                style={styles.input}
                value={withdrawal.goalId}
                onChange={(event) => setWithdrawal((current) => ({
                  ...current,
                  goalId: event.target.value,
                }))}
                required
              >
                <option value="">Select goal</option>
                {goals
                  .filter((goal) => getSaved(goal) > 0)
                  .map((goal) => (
                    <option key={getGoalId(goal)} value={getGoalId(goal)}>
                      {goal.name} — Saved {money(goal.saved_amount)}
                    </option>
                  ))}
              </select>
            </label>

            <label style={styles.label}>
              Withdrawal amount (₹)
              <input
                style={styles.input}
                type="number"
                min="0.01"
                step="0.01"
                value={withdrawal.amount}
                onChange={(event) => setWithdrawal((current) => ({
                  ...current,
                  amount: event.target.value,
                }))}
                required
              />
            </label>

            <label style={styles.label}>
              Destination account
              <select
                style={styles.input}
                value={withdrawal.destination_account_id}
                onChange={(event) => setWithdrawal((current) => ({
                  ...current,
                  destination_account_id: event.target.value,
                }))}
                required
              >
                <option value="">Select account</option>
                {availableAccounts.map((account) => (
                  <option
                    key={account._id || account.id}
                    value={account._id || account.id}
                  >
                    {account.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              style={styles.button}
              disabled={busy}
            >
              Withdraw Savings
            </button>
          </form>
        </section>

        <section>
          <h2 style={{ marginBottom: 15 }}>Your Goals</h2>

          {loading ? (
            <p>Loading savings goals...</p>
          ) : goals.length === 0 ? (
            <div style={styles.panel}>
              <h3>No savings goals yet</h3>
              <p style={{ color: '#94a3b8' }}>
                Create your first savings goal above to start tracking your progress.
              </p>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 16,
            }}>
              {goals.map((goal) => {
                const progress = getProgress(goal);
                const saved = getSaved(goal);
                const target = getTarget(goal);
                const remaining = goal.remaining_amount !== undefined
                  ? Number(goal.remaining_amount)
                  : Math.max(0, target - saved);

                return (
                  <article key={getGoalId(goal)} style={styles.panel}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}>
                      <h3 style={{ marginTop: 0 }}>{goal.name}</h3>
                      <span style={{ color: '#86efac', fontSize: 13 }}>
                        {getStatus(goal)}
                      </span>
                    </div>

                    <p style={{ color: '#94a3b8', fontSize: 13 }}>
                      Target date: {goal.target_date
                        ? new Date(goal.target_date).toLocaleDateString('en-IN')
                        : 'Not set'}
                    </p>

                    <div style={{
                      height: 10,
                      background: '#334155',
                      borderRadius: 20,
                      overflow: 'hidden',
                      margin: '18px 0',
                    }}>
                      <div style={{
                        width: `${progress}%`,
                        height: '100%',
                        background: '#22c55e',
                        borderRadius: 20,
                      }} />
                    </div>

                    <p style={{ fontSize: 14 }}>
                      {progress.toFixed(1)}% completed
                    </p>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                    }}>
                      <div>
                        <small style={{ color: '#94a3b8' }}>Saved</small>
                        <h3>{money(saved)}</h3>
                      </div>
                      <div>
                        <small style={{ color: '#94a3b8' }}>Target</small>
                        <h3>{money(target)}</h3>
                      </div>
                      <div>
                        <small style={{ color: '#94a3b8' }}>Remaining</small>
                        <h3>{money(remaining)}</h3>
                      </div>
                      <div>
                        <small style={{ color: '#94a3b8' }}>Days remaining</small>
                        <h3>{goal.days_remaining ?? '—'}</h3>
                      </div>
                    </div>

                    <p style={{ color: '#94a3b8', fontSize: 13 }}>
                      Monthly savings required:{' '}
                      {goal.monthly_savings_required !== undefined
                        ? money(goal.monthly_savings_required)
                        : '—'}
                    </p>

                    {/* SAF-2: Clearly identify projections as estimates, not guarantees. */}
                    <p style={{ color: '#fbbf24', fontSize: 12 }}>
                      This is an arithmetic projection based on your current
                      savings, target amount and remaining time. It is not a
                      guarantee of future savings or financial advice.
                    </p>

                    {goal.withdrawals?.length > 0 && (
                      <div style={{
                        borderTop: '1px solid #344054',
                        marginTop: 15,
                        paddingTop: 10,
                      }}>
                        <h4>Recent withdrawals</h4>
                        {goal.withdrawals.slice(0, 3).map((item) => (
                          <p
                            key={item.id}
                            style={{ color: '#94a3b8', fontSize: 13 }}
                          >
                            {money(item.amount)} withdrawn ·{' '}
                            {new Date(item.withdrawal_date).toLocaleDateString('en-IN')}
                          </p>
                        ))}
                      </div>
                    )}

                    <div style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginTop: 15,
                    }}>
                      <button
                        style={styles.secondary}
                        onClick={() => startEdit(goal)}
                        disabled={busy || getStatus(goal) === 'Achieved'}
                      >
                        Edit
                      </button>

                      <button
                        style={{
                          ...styles.secondary,
                          color: '#fecaca',
                        }}
                        onClick={() => deleteGoal(goal)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function SavingsGoalsPage() {
  if (!isSignedIn()) return <SignedOutPage title="Savings goals" what="savings goals" />;
  return <SavingsGoalsContent />;
}
