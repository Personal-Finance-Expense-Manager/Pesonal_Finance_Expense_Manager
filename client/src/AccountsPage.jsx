import { useCallback, useEffect, useState } from 'react';
import { authHeaders, isSignedIn } from './auth.js';

/**
 * Accounts and wallets page - US-06 (#20), SRS 5.2, REQ-13 to REQ-18.
 *
 * Open it at http://localhost:5173/#/accounts
 *
 * Until sign-in (US-04) is merged there is no logged-in user, so the page
 * asks for a demo user id (from `npm run seed:dev` in server/) and sends it
 * in an X-User-Id header. When US-04 lands, replace authHeaders() with the
 * real token and remove the demo box.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const DEV_USER_KEY = 'pfem_dev_user_id';

const TYPE_LABELS = {
  cash: 'Cash',
  bank: 'Bank',
  credit_card: 'Credit Card',
  wallet: 'Wallet',
};

const emptyForm = {
  name: '',
  type: 'bank',
  opening_balance: '',
  currency: 'INR',
  credit_limit: '',
  statement_due_day: '',
};

// ---------------------------------------------------------------------------
// Styles - same palette as the registration screen in App.jsx
// ---------------------------------------------------------------------------

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

function button(kind = 'primary', disabled = false) {
  const base = {
    padding: '9px 14px',
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
  if (kind === 'primary') {
    return { ...base, border: 'none', background: colors.green, color: '#fff' };
  }
  if (kind === 'danger') {
    return { ...base, border: '1px solid #7f1d1d', background: '#451a1a', color: '#fecaca' };
  }
  return {
    ...base,
    border: `1px solid ${colors.inputBorder}`,
    background: 'transparent',
    color: '#e2e8f0',
  };
}

function FieldError({ text }) {
  if (!text) return null;
  return (
    <span style={{ display: 'block', marginTop: 5, color: colors.red, fontWeight: 400, fontSize: 13 }}>
      {text}
    </span>
  );
}

function niceDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function formatMoney(amount, currency) {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

// ---------------------------------------------------------------------------
// US-07: net worth (REQ-20) and credit card position (REQ-21)
// ---------------------------------------------------------------------------

function NetWorthCard({ netWorth }) {
  const value = Number(netWorth.net_worth);
  return (
    <div style={{ ...cardStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontSize: 13, color: colors.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>Net worth</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: value < 0 ? colors.red : colors.text, fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(netWorth.net_worth, netWorth.currency)}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: colors.muted }}>Assets (cash, bank, wallets)</div>
        <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(netWorth.total_assets, netWorth.currency)}</div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: colors.muted }}>Credit card outstanding</div>
        <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>− {formatMoney(netWorth.total_liabilities, netWorth.currency)}</div>
      </div>
      {netWorth.accounts_not_included.length > 0 && (
        <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: 13, color: colors.muted }}>
          Not included (different currency):{' '}
          {netWorth.accounts_not_included.map((a) => `${a.name} (${a.currency})`).join(', ')}
        </p>
      )}
    </div>
  );
}

function CardPosition({ card, currency }) {
  const width = Math.min(card.utilisation_percent, 100);
  const warn = card.high_utilisation_warning;
  return (
    <div style={{ marginTop: 10, minWidth: 240 }}>
      <div
        role="progressbar"
        aria-label="Credit limit used"
        aria-valuenow={card.utilisation_percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 8, borderRadius: 999, background: '#0f172a', overflow: 'hidden' }}
      >
        <div style={{ width: `${width}%`, height: '100%', background: warn ? '#f59e0b' : colors.green }} />
      </div>
      <div style={{ fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 1.6 }}>
        Limit {formatMoney(card.credit_limit, currency)} · Available{' '}
        <strong style={{ color: colors.text }}>{formatMoney(card.available_credit, currency)}</strong>{' '}
        · {card.utilisation_percent}% used
        <br />
        {card.next_statement_due_date
          ? <>Statement due <strong style={{ color: colors.text }}>{niceDate(card.next_statement_due_date)}</strong></>
          : 'No statement due day set'}
      </div>
      {warn && (
        <div role="alert" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#422006', color: '#fde68a', fontSize: 13 }}>
          {Number(card.over_limit_by) > 0
            ? `Over the credit limit by ${formatMoney(card.over_limit_by, currency)}.`
            : `You have used more than 80% of this card's limit.`}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AccountsPage() {
  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem(DEV_USER_KEY) || '';
    } catch {
      return '';
    }
  });
  const [userIdDraft, setUserIdDraft] = useState(userId);

  // null = not loaded yet
  const [accounts, setAccounts] = useState(null);
  const [netWorth, setNetWorth] = useState(null); // US-07, REQ-20
  const [showArchived, setShowArchived] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editErrors, setEditErrors] = useState({});

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [offerArchiveId, setOfferArchiveId] = useState(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}/api/accounts${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(userId),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.message || 'Something went wrong. Please try again.');
      err.status = response.status;
      err.errors = data.errors || {};
      err.canArchive = Boolean(data.canArchive);
      throw err;
    }
    return data;
  }, [userId]);

  const loadAccounts = useCallback(async () => {
    if (!userId && !isSignedIn()) return;
    try {
      const data = await api(`?includeArchived=${showArchived}`);
      setAccounts(data.accounts);
      setNetWorth(data.net_worth || null);
      setError('');
    } catch (err) {
      setAccounts([]);
      setError(err.message);
    }
  }, [api, showArchived, userId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  function flash(text) {
    setMessage(text);
    setError('');
  }

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

  // ---- create (REQ-13, REQ-14, REQ-15) -----------------------------------

  async function handleCreate(event) {
    event.preventDefault();
    setBusy(true);
    setFormErrors({});
    try {
      const payload = {
        name: form.name,
        type: form.type,
        opening_balance: form.opening_balance === '' ? '0' : form.opening_balance,
        currency: form.currency,
      };
      if (form.type === 'credit_card') {
        payload.credit_limit = form.credit_limit === '' ? '0' : form.credit_limit;
        if (form.statement_due_day !== '') payload.statement_due_day = form.statement_due_day;
      }
      const data = await api('', { method: 'POST', body: JSON.stringify(payload) });
      setForm(emptyForm);
      flash(`${data.message} "${data.account.name}" is ready to use.`);
      await loadAccounts();
    } catch (err) {
      setFormErrors(err.errors);
      setError(err.message);
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  // ---- edit (REQ-16) -----------------------------------------------------

  function startEdit(account) {
    setEditingId(account.id);
    setEditErrors({});
    setConfirmDeleteId(null);
    setOfferArchiveId(null);
    setEditForm({
      name: account.name,
      type: account.type,
      currency: account.currency,
      credit_limit: account.credit_limit,
      statement_due_day: account.statement_due_day ?? '',
    });
  }

  async function handleSaveEdit(account) {
    setBusy(true);
    setEditErrors({});
    try {
      const payload = {};
      if (editForm.name !== account.name) payload.name = editForm.name;
      if (editForm.type !== account.type) payload.type = editForm.type;
      if (editForm.currency !== account.currency) payload.currency = editForm.currency;
      if (editForm.type === 'credit_card' && editForm.credit_limit !== account.credit_limit) {
        payload.credit_limit = editForm.credit_limit;
      }
      if (editForm.type === 'credit_card' && String(editForm.statement_due_day) !== String(account.statement_due_day ?? '')) {
        payload.statement_due_day = editForm.statement_due_day === '' ? null : editForm.statement_due_day;
      }
      if (Object.keys(payload).length === 0) {
        setEditingId(null);
        return;
      }
      const data = await api(`/${account.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setEditingId(null);
      flash(data.message);
      await loadAccounts();
    } catch (err) {
      setEditErrors(err.errors);
      setError(err.message);
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  // ---- archive / restore (REQ-17) ------------------------------------------

  async function handleArchive(account, restore = false) {
    setBusy(true);
    try {
      const data = await api(`/${account.id}/${restore ? 'restore' : 'archive'}`, { method: 'POST' });
      setOfferArchiveId(null);
      flash(data.message);
      await loadAccounts();
    } catch (err) {
      setError(err.message);
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  // ---- delete (REQ-18) ---------------------------------------------------

  async function handleDelete(account) {
    setBusy(true);
    try {
      const data = await api(`/${account.id}?confirm=true`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      flash(`${data.message} "${account.name}" has been removed.`);
      await loadAccounts();
    } catch (err) {
      setConfirmDeleteId(null);
      if (err.canArchive) setOfferArchiveId(account.id);
      setError(err.message);
      setMessage('');
    } finally {
      setBusy(false);
    }
  }

  // ---- render ------------------------------------------------------------

  const isCard = form.type === 'credit_card';

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
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <nav style={{ display: 'flex', gap: 16, fontSize: 14 }}>
            <a href="#/" style={{ color: colors.muted, textDecoration: 'none' }}>← Back</a>
            <a href="#/dashboard" style={{ color: colors.muted, textDecoration: 'none' }}>Dashboard</a>
            <a href="#/budgets" style={{ color: colors.muted, textDecoration: 'none' }}>Budgets</a>
          </nav>
          <h1 style={{ fontSize: 27, margin: '10px 0 6px' }}>Accounts &amp; wallets</h1>
          <p style={{ color: colors.muted, margin: 0 }}>
            Your cash, bank, card and wallet accounts. Every transaction belongs to one of these.
          </p>
        </header>

        {/* Demo user - temporary until sign-in (US-04) is merged */}
        {/* Hidden once signed in: the session identifies the user (US-25). */}
        {!isSignedIn() && (
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
            <button type="submit" style={button('secondary')}>Use this user</button>
          </form>
        )}

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

        {(userId || isSignedIn()) && (
          <>
            {netWorth && <NetWorthCard netWorth={netWorth} />}

            {/* Add account */}
            <form onSubmit={handleCreate} style={cardStyle} noValidate>
              <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>Add an account</h2>

              <label style={labelStyle}>
                Account name
                <input
                  style={inputStyle}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={60}
                  placeholder="e.g. HDFC Savings"
                />
                <FieldError text={formErrors.name} />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 14px' }}>
                <label style={labelStyle}>
                  Type
                  <select
                    style={inputStyle}
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <FieldError text={formErrors.type} />
                </label>

                <label style={labelStyle}>
                  Currency
                  <input
                    style={inputStyle}
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                    maxLength={3}
                    placeholder="INR"
                  />
                  <FieldError text={formErrors.currency} />
                </label>

                <label style={labelStyle}>
                  {isCard ? 'Outstanding amount' : 'Opening balance'}
                  <input
                    style={inputStyle}
                    value={form.opening_balance}
                    onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                  <FieldError text={formErrors.opening_balance} />
                </label>

                {isCard && (
                  <label style={labelStyle}>
                    Credit limit
                    <input
                      style={inputStyle}
                      value={form.credit_limit}
                      onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                    <FieldError text={formErrors.credit_limit} />
                  </label>
                )}

                {isCard && (
                  <label style={labelStyle}>
                    Statement due day <span style={{ color: colors.muted, fontWeight: 400 }}>(1–31)</span>
                    <input
                      style={inputStyle}
                      value={form.statement_due_day}
                      onChange={(e) => setForm({ ...form, statement_due_day: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                      inputMode="numeric"
                      placeholder="e.g. 5"
                    />
                    <FieldError text={formErrors.statement_due_day} />
                  </label>
                )}
              </div>

              <button type="submit" style={button('primary', busy)} disabled={busy}>
                {busy ? 'Saving…' : 'Add account'}
              </button>
            </form>

            {/* Account list */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>Your accounts</h2>
                <label style={{ fontSize: 14, color: colors.muted, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Show archived
                </label>
              </div>

              {accounts === null && <p style={{ color: colors.muted }}>Loading…</p>}
              {accounts !== null && accounts.length === 0 && (
                <p style={{ color: colors.muted }}>No accounts yet. Add your first one above.</p>
              )}

              {(accounts || []).map((account) => (
                <div
                  key={account.id}
                  style={{
                    padding: '14px 0',
                    borderTop: `1px solid ${colors.cardBorder}`,
                    opacity: account.is_archived ? 0.6 : 1,
                  }}
                >
                  {editingId === account.id ? (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0 12px' }}>
                        <label style={labelStyle}>
                          Name
                          <input
                            style={inputStyle}
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            maxLength={60}
                          />
                          <FieldError text={editErrors.name} />
                        </label>
                        <label style={labelStyle}>
                          Type
                          <select
                            style={inputStyle}
                            value={editForm.type}
                            onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                          >
                            {Object.entries(TYPE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          <FieldError text={editErrors.type} />
                        </label>
                        <label style={labelStyle}>
                          Currency
                          <input
                            style={inputStyle}
                            value={editForm.currency}
                            onChange={(e) => setEditForm({ ...editForm, currency: e.target.value.toUpperCase() })}
                            maxLength={3}
                          />
                          <FieldError text={editErrors.currency} />
                        </label>
                        {editForm.type === 'credit_card' && (
                          <label style={labelStyle}>
                            Credit limit
                            <input
                              style={inputStyle}
                              value={editForm.credit_limit}
                              onChange={(e) => setEditForm({ ...editForm, credit_limit: e.target.value })}
                              inputMode="decimal"
                            />
                            <FieldError text={editErrors.credit_limit} />
                          </label>
                        )}
                        {editForm.type === 'credit_card' && (
                          <label style={labelStyle}>
                            Statement due day
                            <input
                              style={inputStyle}
                              value={editForm.statement_due_day}
                              onChange={(e) => setEditForm({ ...editForm, statement_due_day: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                              inputMode="numeric"
                              placeholder="1–31"
                            />
                            <FieldError text={editErrors.statement_due_day} />
                          </label>
                        )}
                      </div>
                      <p style={{ margin: '0 0 12px', color: colors.muted, fontSize: 13 }}>
                        The balance can't be edited here. It's calculated from the opening balance and your transactions.
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" style={button('primary', busy)} disabled={busy} onClick={() => handleSaveEdit(account)}>
                          Save
                        </button>
                        <button type="button" style={button('secondary')} onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 16 }}>
                          {account.name}
                          {account.is_archived && (
                            <span style={{ marginLeft: 8, fontSize: 12, color: colors.muted, border: `1px solid ${colors.inputBorder}`, borderRadius: 6, padding: '1px 6px' }}>
                              Archived
                            </span>
                          )}
                        </div>
                        <div style={{ color: colors.muted, fontSize: 14, marginTop: 2 }}>
                          {TYPE_LABELS[account.type] || account.type} · {account.currency}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                            {account.type === 'credit_card' ? 'Outstanding' : 'Current balance'}
                          </div>
                          <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {formatMoney(account.current_balance, account.currency)}
                          </div>
                          <div style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
                            {account.type === 'credit_card' ? 'Outstanding at start' : 'Opening balance'}{' '}
                            {formatMoney(account.opening_balance, account.currency)}
                          </div>
                        </div>
                        {account.card && <CardPosition card={account.card} currency={account.currency} />}
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        {confirmDeleteId === account.id ? (
                          <>
                            <span style={{ fontSize: 14, alignSelf: 'center' }}>Delete permanently?</span>
                            <button type="button" style={button('danger', busy)} disabled={busy} onClick={() => handleDelete(account)}>
                              Yes, delete
                            </button>
                            <button type="button" style={button('secondary')} onClick={() => setConfirmDeleteId(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            {!account.is_archived && (
                              <button type="button" style={button('secondary')} onClick={() => startEdit(account)}>
                                Edit
                              </button>
                            )}
                            <button
                              type="button"
                              style={button('secondary', busy)}
                              disabled={busy}
                              onClick={() => handleArchive(account, account.is_archived)}
                            >
                              {account.is_archived ? 'Restore' : 'Archive'}
                            </button>
                            <button
                              type="button"
                              style={button('danger')}
                              onClick={() => {
                                setConfirmDeleteId(account.id);
                                setOfferArchiveId(null);
                                setEditingId(null);
                              }}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {offerArchiveId === account.id && !account.is_archived && (
                    <div style={{ marginTop: 10, padding: 12, borderRadius: 8, background: '#1e293b', fontSize: 14 }}>
                      This account has transactions, so it can't be deleted.{' '}
                      <button type="button" style={button('primary', busy)} disabled={busy} onClick={() => handleArchive(account)}>
                        Archive it instead
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
