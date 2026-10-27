import { useCallback, useEffect, useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';

/**
 * Dashboard - US-20 (#34), SRS 5.8: REQ-69.
 *
 * Open it at http://localhost:5173/#/dashboard
 *
 * Shows, for the current budget period, total income, total expense, net
 * savings and net worth, plus top spending categories and active budgets.
 * Uses the temporary demo user id until the pages switch to sign-in (US-04).
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const DEV_USER_KEY = 'pfem_dev_user_id';

const colors = {
  page: '#0b1120',
  card: '#172033',
  cardBorder: '#283449',
  input: '#101827',
  inputBorder: '#344054',
  text: '#f8fafc',
  muted: '#94a3b8',
  green: '#16a34a',
  greenText: '#86efac',
  amber: '#f59e0b',
  red: '#ef4444',
  redText: '#f87171',
  track: '#0f172a',
};

const cardStyle = {
  padding: 22,
  marginBottom: 18,
  background: colors.card,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 16,
};

const linkStyle = { color: colors.muted, textDecoration: 'none' };

function money(value, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
}

function niceDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function Tile({ label, value, tone, note }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 0 }}>
      <div style={{ fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6, color: tone || colors.text, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>{note}</div>}
    </div>
  );
}

const STATUS_COLOR = { ok: colors.green, warning: colors.amber, over: colors.red };

export default function DashboardPage() {
  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem(DEV_USER_KEY) || '';
    } catch {
      return '';
    }
  });
  const [userIdDraft, setUserIdDraft] = useState(userId);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!userId && !isSignedIn()) return;
    try {
      const response = await fetch(`${API_URL}/api/reports/dashboard`, {
        headers: { ...authHeaders(userId) },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Could not load the dashboard.');
      setData(body);
      setError('');
    } catch (err) {
      setData(null);
      setError(err.message);
    }
  }, [userId]);

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

  const currency = data?.currency || 'INR';
  const savings = data ? Number(data.net_savings) : 0;
  const worth = data ? Number(data.net_worth) : 0;

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
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <nav style={{ display: 'flex', gap: 16, fontSize: 14 }}>
            <a href="#/" style={linkStyle}>← Back</a>
            <a href="#/accounts" style={linkStyle}>Accounts</a>
            <a href="#/budgets" style={linkStyle}>Budgets</a>
          </nav>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: 27, margin: '10px 0 6px' }}>Dashboard</h1>
              <p style={{ color: colors.muted, margin: 0 }}>
                {data
                  ? `This period: ${niceDate(data.period.start)} – ${niceDate(data.period.end)}`
                  : 'Your money at a glance.'}
              </p>
            </div>
            {(userId || isSignedIn()) && (
              <button
                type="button"
                onClick={load}
                style={{ padding: '8px 14px', borderRadius: 9, border: `1px solid ${colors.inputBorder}`, background: 'transparent', color: '#e2e8f0', fontWeight: 600, cursor: 'pointer' }}
              >
                Refresh
              </button>
            )}
          </div>
        </header>

        {!userId && !isSignedIn() && (
            <form onSubmit={saveUserId} style={{ ...cardStyle, borderStyle: 'dashed' }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600 }}>
                Demo user id <span style={{ color: colors.muted, fontWeight: 400 }}>(temporary, until sign-in is ready)</span>
                <input
                  value={userIdDraft}
                  onChange={(e) => setUserIdDraft(e.target.value)}
                  placeholder="Paste the id printed by: npm run seed:dev"
                  style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, padding: '10px 12px', border: `1px solid ${colors.inputBorder}`, borderRadius: 9, background: colors.input, color: colors.text, fontSize: 15 }}
                />
              </label>
              <button type="submit" style={{ padding: '9px 14px', borderRadius: 9, border: `1px solid ${colors.inputBorder}`, background: 'transparent', color: '#e2e8f0', fontWeight: 600, cursor: 'pointer' }}>
                Use this user
              </button>
            </form>
        )}

        {error && (
          <p role="alert" style={{ padding: 12, background: '#451a1a', color: '#fecaca', borderRadius: 8, fontSize: 14 }}>{error}</p>
        )}

        {(userId || isSignedIn()) && !data && !error && <p style={{ color: colors.muted }}>Loading…</p>}

        {data && (
          <>
            {/* REQ-69: the four headline figures */}
            <div
              role="region"
              aria-label="This period at a glance"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}
            >
              <Tile label="Total income" value={money(data.total_income, currency)} tone={colors.greenText} />
              <Tile label="Total expense" value={money(data.total_expense, currency)} />
              <Tile
                label="Net savings"
                value={money(data.net_savings, currency)}
                tone={savings < 0 ? colors.redText : colors.greenText}
                note={savings < 0 ? 'Spending more than earned' : 'Income minus expense'}
              />
              <Tile
                label="Net worth"
                value={money(data.net_worth, currency)}
                tone={worth < 0 ? colors.redText : undefined}
                note={<a href="#/accounts" style={{ color: colors.muted }}>See accounts</a>}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
              <div style={{ ...cardStyle, marginBottom: 0 }}>
                <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>Top spending</h2>
                {data.top_categories.length === 0 && (
                  <p style={{ color: colors.muted, margin: 0 }}>No spending recorded this period.</p>
                )}
                {data.top_categories.map((c) => (
                  <div key={c.category_id || 'none'} style={{ padding: '8px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <span>{c.name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {money(c.amount, currency)} <span style={{ color: colors.muted }}>· {c.share_percent}%</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: colors.track, marginTop: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${c.share_percent}%`, height: '100%', background: '#38bdf8', borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ ...cardStyle, marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>Budgets</h2>
                  <a href="#/budgets" style={{ ...linkStyle, fontSize: 14 }}>Manage</a>
                </div>
                {data.budgets.length === 0 && (
                  <p style={{ color: colors.muted, margin: 0 }}>No active budgets. <a href="#/budgets" style={{ color: colors.greenText }}>Create one</a>.</p>
                )}
                {data.budgets.map((b) => (
                  <div key={b.id} style={{ padding: '8px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <span>{b.name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {money(b.spent, currency)} / {money(b.budgeted, currency)}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={`${b.name} budget used`}
                      aria-valuenow={b.percent_used}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      style={{ height: 6, borderRadius: 999, background: colors.track, marginTop: 6, overflow: 'hidden' }}
                    >
                      <div style={{ width: `${Math.min(b.percent_used, 100)}%`, height: '100%', background: STATUS_COLOR[b.status], borderRadius: 999 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ marginTop: 18, color: colors.muted, fontSize: 13 }}>
              Totals use all income and expenses in this period, in {currency}. Transfers between your own accounts are not counted as income or expense.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
