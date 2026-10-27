import { useCallback, useEffect, useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';

/**
 * Category-wise and tag-wise totals - US-13 (#31), SRS 5.4, REQ-42.
 *
 * Open it at http://localhost:5173/#/totals
 *
 * Nothing is cached: every change of period or type refetches, so the figures
 * can never lag behind a transaction being added, edited or deleted.
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
  greenSoft: '#86efac',
  red: '#f87171',
  bar: '#2563eb',
  barTag: '#7c3aed',
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
};

const labelStyle = {
  display: 'block',
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

function money(amount) {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
  } catch {
    return `INR ${value.toFixed(2)}`;
  }
}

function firstOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** One row of the breakdown, with a bar showing its share. */
function Row({ item, barColour }) {
  return (
    <div style={{ padding: '10px 0', borderTop: `1px solid ${colors.cardBorder}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>{item.name}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {money(item.amount)}
          <span style={{ color: colors.muted, marginLeft: 10, fontWeight: 400 }}>
            {item.share_percent}%
          </span>
        </span>
      </div>
      <div style={{ height: 6, background: colors.input, borderRadius: 4, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.min(Number(item.share_percent), 100)}%`,
            height: '100%',
            background: barColour,
          }}
        />
      </div>
      <div style={{ marginTop: 4, fontSize: 12, color: colors.muted }}>
        {item.transaction_count} transaction{item.transaction_count === 1 ? '' : 's'}
      </div>
    </div>
  );
}

export default function TotalsPage() {
  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem(DEV_USER_KEY) || '';
    } catch {
      return '';
    }
  });
  const [userIdDraft, setUserIdDraft] = useState(userId);

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayIso);
  const [type, setType] = useState('expense');

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId && !isSignedIn()) return;
    setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/reports/totals?from=${from}&to=${to}&type=${type}`,
        { headers: { ...authHeaders(userId) } }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Could not load totals.');
      setData(body);
      setError('');
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId, from, to, type]);

  useEffect(() => {
    load();
  }, [load]);

  function saveUserId(event) {
    event.preventDefault();
    const value = userIdDraft.trim();
    try {
      localStorage.setItem(DEV_USER_KEY, value);
    } catch {
      // Storage can be unavailable (private window); the value still works for this visit.
    }
    setUserId(value);
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.page, color: colors.text, padding: '32px 18px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Totals</h1>
          <p style={{ margin: '6px 0 0', color: colors.muted }}>
            Where the money went, by category and by tag. US-13 &middot; SRS 5.4
          </p>
          <nav style={{ marginTop: 12, display: 'flex', gap: 14, fontSize: 14 }}>
            <a href="#/accounts" style={{ color: colors.greenSoft }}>Accounts</a>
            <a href="#/transactions" style={{ color: colors.greenSoft }}>Transactions</a>
            <a href="#/categories" style={{ color: colors.greenSoft }}>Categories</a>
            <a href="#/budgets" style={{ color: colors.greenSoft }}>Budgets</a>
          </nav>
        </header>

        {/* Hidden once signed in: the session identifies the user (US-25). */}
        {!isSignedIn() && (
          <form onSubmit={saveUserId} style={cardStyle}>
            <label style={labelStyle}>
              Demo user id
              <input
                style={inputStyle}
                value={userIdDraft}
                onChange={(e) => setUserIdDraft(e.target.value)}
                placeholder="Run npm run seed:dev in server/ and paste the id"
              />
            </label>
            <button
              type="submit"
              style={{
                marginTop: 12, padding: '9px 14px', borderRadius: 9, fontSize: 14, fontWeight: 600,
                border: `1px solid ${colors.inputBorder}`, background: 'transparent', color: '#e2e8f0', cursor: 'pointer',
              }}
            >
              Use this user
            </button>
          </form>
        )}

        {(userId || isSignedIn()) && (
          <div style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
            <label style={labelStyle}>
              From
              <input type="date" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label style={labelStyle}>
              To
              <input type="date" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label style={labelStyle}>
              Type
              <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
          </div>
        )}

        {error && (
          <p style={{ ...cardStyle, borderColor: '#7f1d1d', color: colors.red, padding: 14 }}>{error}</p>
        )}

        {!userId && !isSignedIn() && <p style={{ color: colors.muted }}>Enter a demo user id above to see your totals.</p>}

        {(userId || isSignedIn()) && loading && !data && <p style={{ color: colors.muted }}>Loading totals...</p>}

        {data && (
          <>
            <div style={cardStyle}>
              <div style={{ fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Total {data.type}
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {money(data.grand_total)}
              </div>
              <div style={{ fontSize: 13, color: colors.muted }}>
                {data.transaction_count} transaction{data.transaction_count === 1 ? '' : 's'} in this period
              </div>
            </div>

            <section style={cardStyle}>
              <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>By category</h2>
              {data.by_category.length === 0 ? (
                <p style={{ color: colors.muted, margin: 0 }}>
                  No {data.type} transactions in this period. Record one on the Transactions page.
                </p>
              ) : (
                data.by_category.map((c) => <Row key={c.id || 'none'} item={c} barColour={colors.bar} />)
              )}
            </section>

            <section style={cardStyle}>
              <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>By tag</h2>
              {data.by_tag.length === 0 ? (
                <p style={{ color: colors.muted, margin: 0 }}>
                  No tagged transactions in this period. Add tags when recording a transaction.
                </p>
              ) : (
                <>
                  {data.by_tag.map((t) => <Row key={t.id} item={t} barColour={colors.barTag} />)}
                  <p style={{ marginTop: 14, marginBottom: 0, fontSize: 13, color: colors.muted }}>
                    {data.untagged_transaction_count} transaction
                    {data.untagged_transaction_count === 1 ? ' carries' : 's carry'} no tag in this
                    period.
                    A transaction can have several tags, so tag totals may add up to more than the
                    period total.
                  </p>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
