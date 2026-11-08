import { useCallback, useEffect, useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';
import SignInRequired from './SignInRequired.jsx';

/**
 * Period reports - US-22 (#51), SRS 5.8: REQ-73 to REQ-78.
 *
 * Open it at http://localhost:5173/#/reports
 *
 * Any date range, an optional comparison against a second range, the pace of
 * spending, and an export of exactly what is on screen. Nothing is cached:
 * every change of range refetches, so the figures cannot lag behind an edit.
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
  up: '#f87171',
  down: '#4ade80',
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

const labelStyle = { display: 'block', fontSize: 14, fontWeight: 600, color: '#e2e8f0' };

const cardStyle = {
  padding: 22,
  marginBottom: 18,
  background: colors.card,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 16,
};

const buttonStyle = {
  padding: '9px 14px',
  borderRadius: 9,
  fontSize: 14,
  fontWeight: 600,
  border: `1px solid ${colors.inputBorder}`,
  background: 'transparent',
  color: '#e2e8f0',
  cursor: 'pointer',
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

/**
 * The last day of the current month, not today - REQ-76.
 *
 * The default period is the whole month. Ending it at today would make it
 * complete by definition, and the projected period-end total would only ever
 * repeat the amount already spent.
 */
function endOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
}

/** The same range one month earlier, which is the comparison people want. */
function previousMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * A change, coloured and signed - REQ-75.
 *
 * Spending more is shown in red and spending less in green, which is the
 * opposite of the usual up-is-good colouring: on an expense report a rise is
 * the bad news.
 */
function Change({ change, invert = false }) {
  if (!change) return null;

  const isUp = change.direction === 'up';
  const colour =
    change.direction === 'same'
      ? colors.muted
      : (isUp !== invert ? colors.up : colors.down);

  const sign = isUp ? '+' : change.direction === 'down' ? '−' : '';
  const percent = change.percent === null ? 'new' : `${Math.abs(change.percent)}%`;

  return (
    <span style={{ color: colour, fontVariantNumeric: 'tabular-nums' }}>
      {sign}
      {money(Math.abs(Number(change.amount))).replace('₹', '₹')}
      <span style={{ marginLeft: 6, fontSize: 12 }}>({percent})</span>
    </span>
  );
}

export default function ReportsPage() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(endOfMonth);
  const [comparing, setComparing] = useState(false);
  const [compare, setCompare] = useState(previousMonthRange);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState('');

  const query = useCallback(() => {
    const parts = [`from=${from}`, `to=${to}`];
    if (comparing) parts.push(`compare_from=${compare.from}`, `compare_to=${compare.to}`);
    return parts.join('&');
  }, [from, to, comparing, compare]);

  const load = useCallback(async () => {
    if (!isSignedIn()) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/reports/period?${query()}`, {
        headers: { ...authHeaders() },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Could not build the report.');
      setData(body);
      setError('');
    } catch (err) {
      setData(null);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Download the report - REQ-77.
   *
   * Fetched rather than linked because the request has to carry the session
   * token; the blob is then handed to a temporary link so the browser saves it
   * with the file name the server chose.
   */
  async function download(format) {
    setDownloading(format);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/reports/period.${format}?${query()}`, {
        headers: { ...authHeaders() },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `Could not export the ${format.toUpperCase()}.`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);

      link.href = url;
      link.download = match ? match[1] : `report.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading('');
    }
  }

  const ready = isSignedIn();
  const hasRows = data && data.by_category.length > 0;

  // The table follows the data, not the checkbox. Ticking "compare" flips the
  // control at once while the report it describes is still being fetched, so
  // reading the checkbox here would reach for a comparison that has not
  // arrived yet.
  const showsComparison = Boolean(data && data.compare);

  return (
    <div style={{ minHeight: '100vh', background: colors.page, color: colors.text, padding: '32px 18px' }}>
      <div style={{ maxWidth: 940, margin: '0 auto' }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Reports</h1>
          <p style={{ margin: '6px 0 0', color: colors.muted }}>
            Any period, compared with another, with the pace of spending and an export.
            US-22 &middot; SRS 5.8
          </p>
          <nav style={{ marginTop: 12, display: 'flex', gap: 14, fontSize: 14, flexWrap: 'wrap' }}>
            <a href="#/" style={{ color: colors.muted }}>&larr; Back</a>
            <a href="#/dashboard" style={{ color: colors.greenSoft }}>Dashboard</a>
            <a href="#/charts" style={{ color: colors.greenSoft }}>Charts</a>
            <a href="#/transactions" style={{ color: colors.greenSoft }}>Transactions</a>
            <a href="#/totals" style={{ color: colors.greenSoft }}>Totals</a>
          </nav>
        </header>

        {!isSignedIn() && <SignInRequired what="reports" />}

        {ready && (
          <div style={cardStyle}>
            {/* REQ-73: any date range at all. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
              <label style={labelStyle}>
                From
                <input type="date" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label style={labelStyle}>
                To
                <input type="date" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>

            {/* REQ-75: compare against a second period. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, fontSize: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={comparing}
                onChange={(e) => setComparing(e.target.checked)}
                style={{ width: 16, height: 16 }}
              />
              Compare with another period
            </label>

            {comparing && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginTop: 12 }}>
                <label style={labelStyle}>
                  Compare from
                  <input
                    type="date"
                    style={inputStyle}
                    value={compare.from}
                    onChange={(e) => setCompare({ ...compare, from: e.target.value })}
                  />
                </label>
                <label style={labelStyle}>
                  Compare to
                  <input
                    type="date"
                    style={inputStyle}
                    value={compare.to}
                    onChange={(e) => setCompare({ ...compare, to: e.target.value })}
                  />
                </label>
              </div>
            )}

            {/* REQ-77: export exactly what is displayed. */}
            <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
              <button type="button" style={buttonStyle} onClick={() => download('pdf')} disabled={!data || downloading !== ''}>
                {downloading === 'pdf' ? 'Preparing PDF...' : 'Export PDF'}
              </button>
              <button type="button" style={buttonStyle} onClick={() => download('csv')} disabled={!data || downloading !== ''}>
                {downloading === 'csv' ? 'Preparing CSV...' : 'Export CSV'}
              </button>
            </div>
          </div>
        )}

        {error && <p style={{ ...cardStyle, borderColor: '#7f1d1d', color: colors.red, padding: 14 }}>{error}</p>}

        {ready && loading && !data && <p style={{ color: colors.muted }}>Building the report...</p>}

        {data && (
          <>
            {/* ---- headline figures ---- */}
            <div style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 18 }}>
              {[
                ['Total income', data.total_income, data.compare?.change.total_income, true],
                ['Total expense', data.total_expense, data.compare?.change.total_expense, false],
                ['Net', data.net, data.compare?.change.net, true],
              ].map(([label, value, change, invert]) => (
                <div key={label}>
                  <div style={{ fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {money(value)}
                  </div>
                  {change && <div style={{ fontSize: 13, marginTop: 2 }}><Change change={change} invert={invert} /></div>}
                </div>
              ))}
              <div>
                <div style={{ fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  Transactions
                </div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{data.transaction_count}</div>
              </div>
            </div>

            {/* ---- REQ-76: pace of spending ---- */}
            <section style={cardStyle}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Pace of spending</h2>
              <p style={{ fontSize: 13, color: colors.muted }}>This is an arithmetic projection from your recorded data, not a guarantee of future spending or financial advice.</p>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: colors.muted }}>REQ-76</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 12, color: colors.muted }}>AVERAGE DAILY SPEND</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {money(data.projection.average_daily_spend)}
                  </div>
                  <div style={{ fontSize: 12, color: colors.muted }}>
                    over {data.projection.elapsed_days} of {data.projection.total_days} days
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: colors.muted }}>
                    {data.projection.is_complete ? 'PERIOD TOTAL' : 'PROJECTED TOTAL'}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {money(data.projection.projected_total)}
                  </div>
                  <div style={{ fontSize: 12, color: colors.muted }}>
                    {data.projection.is_complete
                      ? 'This period has finished.'
                      : 'if spending continues at this rate'}
                  </div>
                </div>
              </div>
            </section>

            {/* ---- REQ-73, REQ-75: the table ---- */}
            <section style={cardStyle}>
              <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>By category</h2>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: colors.muted }}>
                {showsComparison ? 'Against the comparison period. REQ-75' : 'For the selected period. REQ-73'}
              </p>

              {/* REQ-74: a defined empty state, never a blank table or an error. */}
              {!hasRows ? (
                <div style={{ padding: '18px 0' }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>Nothing to report for this period.</p>
                  <p style={{ margin: '6px 0 0', color: colors.muted, fontSize: 14 }}>
                    No expenses fall between {new Date(data.from).toLocaleDateString('en-GB')} and{' '}
                    {new Date(data.to).toLocaleDateString('en-GB')}. Record a transaction, or widen the
                    dates above.
                  </p>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ color: colors.muted, textAlign: 'left' }}>
                      <th style={{ padding: '6px 0', fontWeight: 600 }}>Category</th>
                      <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>Share</th>
                      {showsComparison && <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>Previous</th>}
                      {showsComparison && <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>Change</th>}
                      {!showsComparison && <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right' }}>Count</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_category.map((row, index) => (
                      <tr key={row.id || `none-${index}`} style={{ borderTop: `1px solid ${colors.cardBorder}` }}>
                        <td style={{ padding: '9px 0' }}>{row.name}</td>
                        <td style={{ padding: '9px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(row.amount)}</td>
                        <td style={{ padding: '9px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row.share_percent}%</td>
                        {showsComparison && (
                          <td style={{ padding: '9px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: colors.muted }}>
                            {money(row.previous_amount)}
                          </td>
                        )}
                        {showsComparison && (
                          <td style={{ padding: '9px 0', textAlign: 'right' }}>
                            <Change change={row.change} />
                          </td>
                        )}
                        {!showsComparison && (
                          <td style={{ padding: '9px 0', textAlign: 'right', color: colors.muted }}>{row.transaction_count}</td>
                        )}
                      </tr>
                    ))}
                    <tr style={{ borderTop: `2px solid ${colors.cardBorder}`, fontWeight: 700 }}>
                      <td style={{ padding: '11px 0' }}>Total</td>
                      <td style={{ padding: '11px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {money(data.total_expense)}
                      </td>
                      <td style={{ padding: '11px 0', textAlign: 'right' }}>100%</td>
                      {showsComparison && (
                        <td style={{ padding: '11px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: colors.muted }}>
                          {money(data.compare.total_expense)}
                        </td>
                      )}
                      {showsComparison && (
                        <td style={{ padding: '11px 0', textAlign: 'right' }}>
                          <Change change={data.compare.change.total_expense} />
                        </td>
                      )}
                      {!showsComparison && <td style={{ padding: '11px 0', textAlign: 'right' }}>{data.transaction_count}</td>}
                    </tr>
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
