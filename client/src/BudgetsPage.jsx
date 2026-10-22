import { useCallback, useEffect, useState } from 'react';

/**
 * Budgets page - US-14 (#35), SRS 5.5: REQ-43 to REQ-46, REQ-50, REQ-51.
 *
 * Open it at http://localhost:5173/#/budgets
 *
 * Like the Accounts page, it uses the temporary demo user id until sign-in
 * (US-04) is merged. Editing, deleting, rollover and repeat are US-15.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const DEV_USER_KEY = 'pfem_dev_user_id';

const PERIOD_LABELS = { monthly: 'Monthly', weekly: 'Weekly', custom: 'Custom dates' };

const colors = {
  page: '#0b1120',
  card: '#172033',
  cardBorder: '#283449',
  input: '#101827',
  inputBorder: '#344054',
  text: '#f8fafc',
  muted: '#94a3b8',
  green: '#16a34a',
  amber: '#f59e0b',
  red: '#ef4444',
  redText: '#f87171',
  track: '#0f172a',
};

const STATUS = {
  ok: { bar: colors.green, label: 'On track', badgeBg: '#123524', badgeText: '#bbf7d0' },
  warning: { bar: colors.amber, label: '80% used', badgeBg: '#422006', badgeText: '#fde68a' },
  over: { bar: colors.red, label: 'Over budget', badgeBg: '#451a1a', badgeText: '#fecaca' },
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  padding: '10px 12px',
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 9,
  background: colors.input,
  color: colors.text,
  fontSize: 15,
  colorScheme: 'dark',
};

const labelStyle = {
  display: 'block',
  marginBottom: 14,
  fontSize: 14,
  fontWeight: 600,
  color: '#e2e8f0',
};

const cardStyle = {
  padding: 22,
  marginBottom: 18,
  background: colors.card,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 16,
};

const primaryButton = (busy) => ({
  padding: '10px 16px',
  border: 'none',
  borderRadius: 9,
  background: colors.green,
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.6 : 1,
});

const secondaryButton = {
  padding: '9px 14px',
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 9,
  background: 'transparent',
  color: '#e2e8f0',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const emptyForm = {
  category_id: 'overall',
  amount: '',
  period_type: 'monthly',
  period_start: '',
  period_end: '',
};

function FieldError({ text }) {
  if (!text) return null;
  return (
    <span style={{ display: 'block', marginTop: 5, color: colors.redText, fontWeight: 400, fontSize: 13 }}>
      {text}
    </span>
  );
}

function money(value) {
  const n = Number(value);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
}

function niceDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function Figure({ label, value, tone }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, color: tone || colors.text, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  );
}

function BudgetCard({ budget }) {
  const look = STATUS[budget.status] || STATUS.ok;
  const remaining = Number(budget.remaining);
  const width = Math.min(budget.percent_used, 100);

  return (
    <div style={{ padding: '16px 0', borderTop: `1px solid ${colors.cardBorder}`, opacity: budget.is_active ? 1 : 0.6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{budget.category_name}</span>
          <span style={{ color: colors.muted, fontSize: 14, marginLeft: 8 }}>
            {PERIOD_LABELS[budget.period_type]} · {niceDate(budget.period_start)} – {niceDate(budget.period_end)}
          </span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: look.badgeBg, color: look.badgeText }}>
          {budget.is_active ? look.label : 'Ended'}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={budget.percent_used}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${budget.category_name} budget used`}
        style={{ height: 10, borderRadius: 999, background: colors.track, margin: '12px 0', overflow: 'hidden' }}
      >
        <div style={{ width: `${width}%`, height: '100%', background: look.bar, borderRadius: 999, transition: 'width .3s' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
        <Figure label="Budgeted" value={money(budget.budgeted)} />
        <Figure label="Spent" value={money(budget.spent)} />
        <Figure
          label={remaining < 0 ? 'Over by' : 'Remaining'}
          value={money(Math.abs(remaining))}
          tone={remaining < 0 ? colors.redText : undefined}
        />
        <Figure label="Used" value={`${budget.percent_used}%`} tone={look.bar === colors.green ? undefined : look.bar} />
        <Figure label="Days left" value={budget.days_left} />
      </div>
    </div>
  );
}

export default function BudgetsPage() {
  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem(DEV_USER_KEY) || '';
    } catch {
      return '';
    }
  });
  const [userIdDraft, setUserIdDraft] = useState(userId);

  const [budgets, setBudgets] = useState(null); // null = not loaded yet
  const [categories, setCategories] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [newAlerts, setNewAlerts] = useState([]);
  const [showPast, setShowPast] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}/api/budgets${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.message || 'Something went wrong. Please try again.');
      err.errors = data.errors || {};
      throw err;
    }
    return data;
  }, [userId]);

  // Load budgets (which also raises any alerts now due), categories and alerts.
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [list, cats, recent] = await Promise.all([
        api(showPast ? '?include=all' : ''),
        api('/categories'),
        api('/alerts'),
      ]);
      setBudgets(list.budgets);
      setCategories(cats.categories);
      setAlerts(recent.alerts);
      if (list.newAlerts.length) setNewAlerts(list.newAlerts);
      setError('');
    } catch (err) {
      setBudgets([]);
      setError(err.message);
    }
  }, [api, showPast, userId]);

  useEffect(() => {
    load();
  }, [load]);

  function saveUserId(event) {
    event.preventDefault();
    const value = userIdDraft.trim();
    try {
      localStorage.setItem(DEV_USER_KEY, value);
    } catch {
      // Storage may be unavailable; the id still works for this visit.
    }
    setUserId(value);
  }

  async function handleCreate(event) {
    event.preventDefault();
    setBusy(true);
    setFormErrors({});
    try {
      const payload = {
        category_id: form.category_id,
        amount: form.amount,
        period_type: form.period_type,
      };
      if (form.period_start) payload.period_start = form.period_start;
      if (form.period_type === 'custom') payload.period_end = form.period_end;

      const data = await api('', { method: 'POST', body: JSON.stringify(payload) });
      setForm(emptyForm);
      setMessage(`Budget created for ${data.budget.category_name}, ${niceDate(data.budget.period_start)} – ${niceDate(data.budget.period_end)}.`);
      setError('');
      if (data.newAlerts.length) setNewAlerts(data.newAlerts);
      await load();
    } catch (err) {
      setFormErrors(err.errors);
      setError(err.message);
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  const isCustom = form.period_type === 'custom';

  return (
    <main
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: '36px 16px',
        background: colors.page,
        color: colors.text,
        fontFamily: 'Inter, Segoe UI, sans-serif',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <nav style={{ display: 'flex', gap: 16, fontSize: 14 }}>
            <a href="#/" style={{ color: colors.muted, textDecoration: 'none' }}>← Back</a>
            <a href="#/dashboard" style={{ color: colors.muted, textDecoration: 'none' }}>Dashboard</a>
            <a href="#/accounts" style={{ color: colors.muted, textDecoration: 'none' }}>Accounts</a>
          </nav>
          <h1 style={{ fontSize: 27, margin: '10px 0 6px' }}>Budgets</h1>
          <p style={{ color: colors.muted, margin: 0 }}>
            Set a spending limit for a category or for everything, and see how much is left.
          </p>
        </header>

        <form onSubmit={saveUserId} style={{ ...cardStyle, borderStyle: 'dashed' }}>
          <label style={{ ...labelStyle, marginBottom: 8 }}>
            Demo user id <span style={{ color: colors.muted, fontWeight: 400 }}>(temporary, until sign-in is ready)</span>
            <input
              style={inputStyle}
              value={userIdDraft}
              onChange={(e) => setUserIdDraft(e.target.value)}
              placeholder="Paste the id printed by: npm run seed:dev"
            />
          </label>
          <button type="submit" style={secondaryButton}>Use this user</button>
        </form>

        {newAlerts.map((alert) => (
          <div
            key={alert.title}
            role="alert"
            style={{
              padding: 12,
              marginBottom: 10,
              borderRadius: 8,
              fontSize: 14,
              background: alert.type === 'budget_over' ? '#451a1a' : '#422006',
              color: alert.type === 'budget_over' ? '#fecaca' : '#fde68a',
            }}
          >
            <strong>{alert.title}.</strong> {alert.body}
          </div>
        ))}

        {message && (
          <p role="status" style={{ padding: 12, background: '#123524', color: '#bbf7d0', borderRadius: 8, fontSize: 14 }}>
            {message}
          </p>
        )}
        {error && (
          <p role="alert" style={{ padding: 12, background: '#451a1a', color: '#fecaca', borderRadius: 8, fontSize: 14 }}>
            {error}
          </p>
        )}

        {userId && (
          <>
            <form onSubmit={handleCreate} style={cardStyle} noValidate>
              <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Create a budget</h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 14px' }}>
                <label style={labelStyle}>
                  Category
                  <select
                    style={inputStyle}
                    value={form.category_id}
                    onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  >
                    <option value="overall">Overall spending</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <FieldError text={formErrors.category_id} />
                </label>

                <label style={labelStyle}>
                  Amount (₹)
                  <input
                    style={inputStyle}
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="6000"
                  />
                  <FieldError text={formErrors.amount} />
                </label>

                <label style={labelStyle}>
                  Period
                  <select
                    style={inputStyle}
                    value={form.period_type}
                    onChange={(e) => setForm({ ...form, period_type: e.target.value })}
                  >
                    {Object.entries(PERIOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <FieldError text={formErrors.period_type} />
                </label>

                <label style={labelStyle}>
                  {isCustom ? 'Start date' : 'Starting'}{' '}
                  {!isCustom && <span style={{ color: colors.muted, fontWeight: 400 }}>(optional)</span>}
                  <input
                    style={inputStyle}
                    type="date"
                    value={form.period_start}
                    onChange={(e) => setForm({ ...form, period_start: e.target.value })}
                  />
                  <FieldError text={formErrors.period_start} />
                </label>

                {isCustom && (
                  <label style={labelStyle}>
                    End date
                    <input
                      style={inputStyle}
                      type="date"
                      value={form.period_end}
                      onChange={(e) => setForm({ ...form, period_end: e.target.value })}
                    />
                    <FieldError text={formErrors.period_end} />
                  </label>
                )}
              </div>

              {!isCustom && (
                <p style={{ margin: '0 0 14px', color: colors.muted, fontSize: 13 }}>
                  {form.period_type === 'monthly'
                    ? 'Leave the date empty for the current month. Months begin on your month start day.'
                    : 'Leave the date empty to start the week today.'}
                </p>
              )}

              <button type="submit" style={primaryButton(busy)} disabled={busy}>
                {busy ? 'Saving…' : 'Create budget'}
              </button>
            </form>

            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Your budgets</h2>
                <label style={{ fontSize: 14, color: colors.muted, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showPast}
                    onChange={(e) => setShowPast(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Show ended budgets
                </label>
              </div>

              {budgets === null && <p style={{ color: colors.muted }}>Loading…</p>}
              {budgets !== null && budgets.length === 0 && (
                <p style={{ color: colors.muted }}>No budgets yet. Create your first one above.</p>
              )}
              {(budgets || []).map((budget) => <BudgetCard key={budget.id} budget={budget} />)}

              <p style={{ margin: '14px 0 0', color: colors.muted, fontSize: 13 }}>
                Spending counts expenses in the period. Transfers between your own accounts and
                transactions marked “excluded from budgets” are not counted.
              </p>
            </div>

            {alerts.length > 0 && (
              <div style={cardStyle}>
                <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Recent budget alerts</h2>
                {alerts.slice(0, 5).map((alert) => (
                  <div key={alert.id} style={{ padding: '10px 0', borderTop: `1px solid ${colors.cardBorder}`, fontSize: 14 }}>
                    <span style={{ color: alert.type === 'budget_over' ? colors.redText : colors.amber, fontWeight: 600 }}>
                      {alert.title}
                    </span>
                    <div style={{ color: colors.muted, marginTop: 2 }}>{alert.body}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
