import { useCallback, useEffect, useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';
import SignInRequired from './SignInRequired.jsx';

/**
 * Spending charts - US-21 (#50), SRS 5.8: REQ-70, REQ-71, REQ-72.
 *
 * Open it at http://localhost:5173/#/charts
 *
 * The charts are drawn as plain SVG rather than with a charting library: the
 * three shapes needed here are small, and it keeps the client dependency-free.
 * Nothing is cached - changing the period or the trend length refetches - so a
 * chart can never lag behind a transaction being added, edited or deleted.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const colors = {
  page: '#0b1120',
  card: '#172033',
  cardBorder: '#283449',
  input: '#101827',
  inputBorder: '#344054',
  text: '#f8fafc',
  muted: '#94a3b8',
  greenSoft: '#86efac',
  red: '#f87171',
  income: '#16a34a',
  expense: '#f87171',
};

/** Slice colours, used in order and reused if there are more categories. */
const palette = [
  '#2563eb', '#7c3aed', '#16a34a', '#ea580c', '#0891b2',
  '#db2777', '#ca8a04', '#4f46e5', '#059669', '#dc2626',
];

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

const labelStyle = { display: 'block', fontSize: 14, fontWeight: 600, color: '#e2e8f0' };

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

function sliceColour(slice, index) {
  return slice.colour || palette[index % palette.length];
}

/**
 * A donut chart - REQ-70.
 *
 * Each slice is a circle with a dash pattern, offset so the slices sit end to
 * end. That draws an arc of any length without any path arithmetic, and the
 * stroke width makes the ring.
 */
function Donut({ slices }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox="0 0 200 200" style={{ width: 200, height: 200, flexShrink: 0 }} role="img" aria-label="Expense breakdown by category">
      <g transform="rotate(-90 100 100)">
        {slices.map((slice, index) => {
          const length = (Number(slice.share_percent) / 100) * circumference;
          const dash = `${length} ${circumference - length}`;
          const element = (
            <circle
              key={slice.id || `none-${index}`}
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke={sliceColour(slice, index)}
              strokeWidth="36"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return element;
        })}
      </g>
    </svg>
  );
}

/**
 * Income against expense, month by month - REQ-71.
 *
 * Paired bars per month on a shared scale, so the two series are directly
 * comparable. Months with nothing in them still get their slot on the axis.
 */
function TrendChart({ trend }) {
  const width = 660;
  const height = 240;
  const padding = { top: 16, right: 12, bottom: 34, left: 64 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const peak = Math.max(
    ...trend.map((m) => Math.max(Number(m.income), Number(m.expense))),
    1
  );

  const slot = plotWidth / trend.length;
  const barWidth = Math.min(18, (slot - 8) / 2);

  // Four gridlines, labelled in thousands so the axis stays short.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    value: peak * fraction,
    y: padding.top + plotHeight - fraction * plotHeight,
  }));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Income versus expense by month">
      {ticks.map((tick) => (
        <g key={tick.y}>
          <line x1={padding.left} y1={tick.y} x2={width - padding.right} y2={tick.y} stroke={colors.cardBorder} strokeWidth="1" />
          <text x={padding.left - 8} y={tick.y + 4} textAnchor="end" fontSize="11" fill={colors.muted}>
            {tick.value >= 1000 ? `${Math.round(tick.value / 1000)}k` : Math.round(tick.value)}
          </text>
        </g>
      ))}

      {trend.map((month, index) => {
        const centre = padding.left + slot * index + slot / 2;
        const incomeHeight = (Number(month.income) / peak) * plotHeight;
        const expenseHeight = (Number(month.expense) / peak) * plotHeight;

        return (
          <g key={month.key}>
            <rect
              x={centre - barWidth - 2}
              y={padding.top + plotHeight - incomeHeight}
              width={barWidth}
              height={incomeHeight}
              fill={colors.income}
              rx="2"
            />
            <rect
              x={centre + 2}
              y={padding.top + plotHeight - expenseHeight}
              width={barWidth}
              height={expenseHeight}
              fill={colors.expense}
              rx="2"
            />
            <text x={centre} y={height - 12} textAnchor="middle" fontSize="11" fill={colors.muted}>
              {month.label.split(' ')[0]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ChartsPage() {

  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayIso);
  const [months, setMonths] = useState(6);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isSignedIn()) return;
    setLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/reports/charts?from=${from}&to=${to}&months=${months}`,
        { headers: { ...authHeaders() } }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Could not load the charts.');
      setData(body);
      setError('');
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [from, to, months]);

  useEffect(() => {
    load();
  }, [load]);


  const hasSpending = data && data.by_category.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: colors.page, color: colors.text, padding: '32px 18px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Spending charts</h1>
          <p style={{ margin: '6px 0 0', color: colors.muted }}>
            Where the money goes, how it moves month to month, and the biggest single spends.
            US-21 &middot; SRS 5.8
          </p>
          <nav style={{ marginTop: 12, display: 'flex', gap: 14, fontSize: 14, flexWrap: 'wrap' }}>
            <a href="#/" style={{ color: colors.muted }}>&larr; Back</a>
            <a href="#/dashboard" style={{ color: colors.greenSoft }}>Dashboard</a>
            <a href="#/transactions" style={{ color: colors.greenSoft }}>Transactions</a>
            <a href="#/totals" style={{ color: colors.greenSoft }}>Totals</a>
            <a href="#/budgets" style={{ color: colors.greenSoft }}>Budgets</a>
          </nav>
        </header>

        {!isSignedIn() && <SignInRequired what="charts" />}

        {isSignedIn() && (
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
              Trend length
              <select style={inputStyle} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                <option value={6}>Last 6 months</option>
                <option value={12}>Last 12 months</option>
              </select>
            </label>
          </div>
        )}

        {error && (
          <p style={{ ...cardStyle, borderColor: '#7f1d1d', color: colors.red, padding: 14 }}>{error}</p>
        )}


        {isSignedIn() && loading && !data && (
          <p style={{ color: colors.muted }}>Loading charts...</p>
        )}

        {data && (
          <>
            {/* ---- REQ-70: category breakdown, chart and table together ---- */}
            <section style={cardStyle}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Where the money went</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: colors.muted }}>
                Expenses by category for the selected period. REQ-70
              </p>

              {!hasSpending ? (
                <p style={{ color: colors.muted, margin: 0 }}>
                  No expenses in this period. Record one on the Transactions page, or widen the dates above.
                </p>
              ) : (
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Donut slices={data.by_category} />

                  <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr style={{ color: colors.muted, textAlign: 'left' }}>
                          <th style={{ padding: '6px 0', fontWeight: 600 }}>Category</th>
                          <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                          <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.by_category.map((slice, index) => (
                          <tr key={slice.id || `none-${index}`} style={{ borderTop: `1px solid ${colors.cardBorder}` }}>
                            <td style={{ padding: '8px 0' }}>
                              <span
                                style={{
                                  display: 'inline-block', width: 10, height: 10, borderRadius: 3,
                                  background: sliceColour(slice, index), marginRight: 8,
                                }}
                              />
                              {slice.name}
                            </td>
                            <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {money(slice.amount)}
                            </td>
                            <td style={{ padding: '8px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {slice.share_percent}%
                            </td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: `2px solid ${colors.cardBorder}`, fontWeight: 700 }}>
                          <td style={{ padding: '10px 0' }}>Total</td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {money(data.grand_total)}
                          </td>
                          <td style={{ padding: '10px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {data.by_category.reduce((sum, s) => sum + Math.round(s.share_percent * 10), 0) / 10}%
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* ---- REQ-71: income against expense over time ---- */}
            <section style={cardStyle}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Income against expense</h2>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: colors.muted }}>
                The last {data.trend_months} months. REQ-71
              </p>
              <div style={{ display: 'flex', gap: 18, fontSize: 13, marginBottom: 10 }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: colors.income, marginRight: 6 }} />Income</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: colors.expense, marginRight: 6 }} />Expense</span>
              </div>
              <TrendChart trend={data.trend} />
            </section>

            {/* ---- REQ-72: top five categories and five largest spends ---- */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
              <section style={cardStyle}>
                <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Top 5 categories</h2>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: colors.muted }}>REQ-72</p>
                {data.top_categories.length === 0 ? (
                  <p style={{ color: colors.muted, margin: 0 }}>Nothing spent in this period.</p>
                ) : (
                  data.top_categories.map((slice, index) => (
                    <div key={slice.id || `top-${index}`} style={{ padding: '9px 0', borderTop: index ? `1px solid ${colors.cardBorder}` : 'none', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span>
                        <span style={{ color: colors.muted, marginRight: 8 }}>{index + 1}</span>
                        {slice.name}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {money(slice.amount)}
                        <span style={{ color: colors.muted, marginLeft: 8 }}>{slice.share_percent}%</span>
                      </span>
                    </div>
                  ))
                )}
              </section>

              <section style={cardStyle}>
                <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>5 largest spends</h2>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: colors.muted }}>REQ-72</p>
                {data.largest_transactions.length === 0 ? (
                  <p style={{ color: colors.muted, margin: 0 }}>Nothing spent in this period.</p>
                ) : (
                  data.largest_transactions.map((row, index) => (
                    <div key={row.id} style={{ padding: '9px 0', borderTop: index ? `1px solid ${colors.cardBorder}` : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span>{row.category_name}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(row.amount)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                        {new Date(row.transaction_date).toLocaleDateString('en-GB')}
                        {row.account_name ? ` · ${row.account_name}` : ''}
                        {row.note ? ` · ${row.note}` : ''}
                      </div>
                    </div>
                  ))
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
