import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSignedIn } from './auth.js';
import SignInRequired from './SignInRequired.jsx';
import { Badge, FieldError } from './PageParts.jsx';
import {
  colors, cardStyle, dangerButton, inputStyle, labelStyle,
  loadChoices, makeApi, money, mutedLink, niceDate, primaryButton, secondaryButton,
} from './pageKit.js';
import {
  BILL_STATUS, LEAD_TIME_OPTIONS, billToForm, dueLabel, emptyBillForm, payAction,
  toBillPayload, validateBillForm,
} from './billForm.js';

/**
 * US-17 (#44): bill reminders - create, view, edit, delete (REQ-57), one-tap
 * mark as paid (REQ-58) and paid / overdue indicators (REQ-59). Marking paid
 * creates the expense on the server; this page never touches balances itself.
 */

const FILTERS = [['all', 'All'], ['pending', 'Upcoming'], ['overdue', 'Overdue'], ['paid', 'Paid']];

function BillCard({ bill, accounts, busy, onEdit, onPay, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [accountId, setAccountId] = useState('');
  const look = BILL_STATUS[bill.status] || BILL_STATUS.pending;
  const { canPay, needsAccount } = payAction(bill);
  const overdue = bill.status === 'overdue';

  return (
    <div style={{
      padding: '16px 14px', margin: '10px 0', borderRadius: 12,
      border: `1px solid ${overdue ? '#7f1d1d' : colors.cardBorder}`,
      borderLeft: `4px solid ${overdue ? colors.red : bill.status === 'paid' ? colors.green : colors.cardBorder}`,
      background: overdue ? '#2a1418' : 'transparent', opacity: bill.status === 'paid' ? 0.8 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{bill.name}</span>{' '}
          <Badge look={look} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(bill.amount)}</div>
      </div>

      <div style={{ color: overdue ? '#fecaca' : colors.muted, fontSize: 14, margin: '6px 0 10px' }}>
        <strong>{dueLabel(bill)}</strong> · {niceDate(bill.due_date)}
        {bill.status !== 'paid' && <> · Reminder {bill.notify_days_before === 0 ? 'on the due date' : `${bill.notify_days_before} day${bill.notify_days_before === 1 ? '' : 's'} before`}</>}
        {bill.paid_at && <> · Paid {niceDate(String(bill.paid_at).slice(0, 10))}</>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {canPay && !choosing && (
          <button type="button" style={primaryButton(busy)} disabled={busy}
            onClick={() => (needsAccount ? setChoosing(true) : onPay(bill, {}))}>
            ✓ Mark as paid
          </button>
        )}
        {bill.status !== 'paid' && <button type="button" style={secondaryButton} disabled={busy} onClick={() => onEdit(bill)}>Edit</button>}
        {bill.status === 'paid' && <a href="#/transactions" style={{ ...secondaryButton, textDecoration: 'none' }}>View expense</a>}
        {!confirming && <button type="button" style={dangerButton} disabled={busy} onClick={() => setConfirming(true)}>Delete</button>}
      </div>

      {choosing && (
        <div style={{ marginTop: 10, padding: 12, borderRadius: 9, background: '#101827' }}>
          <label style={{ ...labelStyle, marginBottom: 8 }}>Paid from which account?
            <select style={inputStyle} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Select an account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={primaryButton(busy)} disabled={busy || !accountId}
              onClick={() => { setChoosing(false); onPay(bill, { account_id: accountId }); }}>Confirm payment</button>
            <button type="button" style={secondaryButton} onClick={() => setChoosing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {confirming && (
        <div role="alertdialog" aria-label="Confirm delete" style={{ marginTop: 10, padding: 12, borderRadius: 9, background: '#451a1a', fontSize: 14 }}>
          Delete this reminder?{bill.status === 'paid' ? ' The expense it recorded is kept.' : ''}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={dangerButton} disabled={busy} onClick={() => { setConfirming(false); onDelete(bill); }}>Yes, delete</button>
            <button type="button" style={secondaryButton} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BillRemindersPage() {
  const [bills, setBills] = useState(null);
  const [notices, setNotices] = useState([]);
  const [filter, setFilter] = useState('all');
  const [choices, setChoices] = useState({ accounts: [], categories: [] });
  const [form, setForm] = useState(emptyBillForm);
  const [formErrors, setFormErrors] = useState({});
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const api = useMemo(() => makeApi(), []);
  const ready = isSignedIn();

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const [list, loaded, inbox] = await Promise.all([
        api(`/api/bill-reminders?limit=100${filter === 'all' ? '' : `&status=${filter}`}`),
        loadChoices(api),
        api('/api/notifications?limit=5&unread=true'),
      ]);
      setBills(list.data);
      setChoices(loaded);
      setNotices(inbox.data);
      setError('');
    } catch (err) {
      setBills([]);
      setError(err.message);
    }
  }, [api, filter, ready]);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  function startCreate() {
    setEditing(null);
    setForm(emptyBillForm());
    setFormErrors({});
    setMessage('');
    setShowForm(true);
  }

  function startEdit(bill) {
    setEditing(bill);
    setForm(billToForm(bill));
    setFormErrors({});
    setMessage('');
    setShowForm(true);
  }

  async function submit(event) {
    event.preventDefault();
    const errors = validateBillForm(form);
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setBusy(true);
    setError('');
    try {
      const body = JSON.stringify(toBillPayload(form));
      if (editing) {
        await api(`/api/bill-reminders/${editing.id}`, { method: 'PATCH', body });
        setMessage('Reminder updated.');
      } else {
        await api('/api/bill-reminders', { method: 'POST', body });
        setMessage('Reminder created.');
      }
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (err) {
      setFormErrors(err.errors || {});
      setError(err.errors && Object.keys(err.errors).length ? '' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function pay(bill, body) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/bill-reminders/${bill.id}/pay`, { method: 'POST', body: JSON.stringify(body) });
      setMessage(`${bill.name} marked as paid and the expense was recorded.`);
      await load();
    } catch (err) {
      setError(err.message);
      if (err.status === 409) await load(); // someone (or another tab) already paid it
    } finally {
      setBusy(false);
    }
  }

  async function remove(bill) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/bill-reminders/${bill.id}`, { method: 'DELETE' });
      setMessage('Reminder deleted.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function dismissNotice(id) {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST', body: '{}' });
      setNotices((list) => list.filter((n) => n.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  const overdueCount = (bills || []).filter((b) => b.status === 'overdue').length;

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '36px 16px', background: colors.page, color: colors.text, fontFamily: 'Inter, Segoe UI, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <nav style={{ display: 'flex', gap: 16, fontSize: 14, flexWrap: 'wrap' }}>
            <a href="#/" style={mutedLink}>← Back</a>
            <a href="#/dashboard" style={mutedLink}>Dashboard</a>
            <a href="#/transactions" style={mutedLink}>Transactions</a>
            <a href="#/recurring" style={mutedLink}>Recurring</a>
          </nav>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: 27, margin: '10px 0 6px' }}>Bill reminders</h1>
              <p style={{ color: colors.muted, margin: 0 }}>Get reminded before a bill is due, then record the payment in one tap.</p>
            </div>
            {ready && !showForm && <button type="button" style={primaryButton(false)} onClick={startCreate}>+ New reminder</button>}
          </div>
        </header>

        {!ready && <SignInRequired what="bill reminders" />}

        {error && <div role="alert" style={{ padding: 12, marginBottom: 14, borderRadius: 8, background: '#451a1a', color: '#fecaca', fontSize: 14 }}>{error}</div>}
        {message && <div role="status" style={{ padding: 12, marginBottom: 14, borderRadius: 8, background: '#123524', color: '#bbf7d0', fontSize: 14 }}>{message}</div>}

        {notices.map((n) => (
          <div key={n.id} role="status" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: 12, marginBottom: 10, borderRadius: 8, background: '#422006', color: '#fde68a', fontSize: 14 }}>
            <span><strong>{n.title}.</strong> {n.body}</span>
            <button type="button" style={{ ...secondaryButton, padding: '5px 10px', fontSize: 13 }} onClick={() => dismissNotice(n.id)}>Dismiss</button>
          </div>
        ))}

        {ready && showForm && (
          <form onSubmit={submit} noValidate style={cardStyle} aria-label={editing ? 'Edit bill reminder' : 'New bill reminder'}>
            <h2 style={{ margin: '0 0 14px', fontSize: 18 }}>{editing ? 'Edit reminder' : 'New bill reminder'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', columnGap: 14 }}>
              <label style={labelStyle}>Bill name
                <input style={inputStyle} value={form.name} maxLength={120} onChange={set('name')} placeholder="e.g. Electricity" aria-invalid={Boolean(formErrors.name)} />
                <FieldError text={formErrors.name} />
              </label>
              <label style={labelStyle}>Amount
                <input style={inputStyle} inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="3000.00" aria-invalid={Boolean(formErrors.amount)} />
                <FieldError text={formErrors.amount} />
              </label>
              <label style={labelStyle}>Due date
                <input type="date" style={inputStyle} value={form.due_date} onChange={set('due_date')} aria-invalid={Boolean(formErrors.due_date)} />
                <FieldError text={formErrors.due_date} />
              </label>
              <label style={labelStyle}>Remind me
                <select style={inputStyle} value={form.notify_days_before} onChange={set('notify_days_before')}>
                  {LEAD_TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <FieldError text={formErrors.notify_days_before} />
              </label>
              <label style={labelStyle}>Pay from <span style={{ color: colors.muted, fontWeight: 400 }}>(optional)</span>
                <select style={inputStyle} value={form.account_id} onChange={set('account_id')}>
                  <option value="">Ask me when I pay</option>
                  {choices.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <FieldError text={formErrors.account_id} />
              </label>
              <label style={labelStyle}>Category <span style={{ color: colors.muted, fontWeight: 400 }}>(optional)</span>
                <select style={inputStyle} value={form.category_id} onChange={set('category_id')}>
                  <option value="">No category</option>
                  {choices.categories.filter((c) => !c.type || c.type === 'expense').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <FieldError text={formErrors.category_id} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" style={primaryButton(busy)} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create reminder'}</button>
              <button type="button" style={secondaryButton} onClick={() => { setShowForm(false); setEditing(null); setFormErrors({}); }}>Cancel</button>
            </div>
          </form>
        )}

        {ready && (
          <section style={cardStyle} aria-label="Bill reminders">
            <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              {FILTERS.map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value}
                  onClick={() => { setFilter(value); setBills(null); }}
                  style={{ ...secondaryButton, background: filter === value ? '#1e293b' : 'transparent', borderColor: filter === value ? colors.green : colors.inputBorder }}>
                  {label}{value === 'overdue' && overdueCount > 0 ? ` (${overdueCount})` : ''}
                </button>
              ))}
            </div>

            {bills === null && <p role="status" style={{ color: colors.muted }}>Loading reminders…</p>}

            {bills && bills.length === 0 && !error && (
              <div style={{ padding: '26px 0', textAlign: 'center', color: colors.muted }}>
                <p style={{ margin: '0 0 12px' }}>{filter === 'all' ? 'No bill reminders yet.' : `No ${filter === 'pending' ? 'upcoming' : filter} bills.`}</p>
                {filter === 'all' && !showForm && <button type="button" style={primaryButton(false)} onClick={startCreate}>Add your first bill</button>}
              </div>
            )}

            {bills && bills.map((bill) => (
              <BillCard key={bill.id} bill={bill} accounts={choices.accounts} busy={busy} onEdit={startEdit} onPay={pay} onDelete={remove} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
