import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSignedIn } from './auth.js';
import SignInRequired from './SignInRequired.jsx';
import { Badge, FieldError } from './PageParts.jsx';
import {
  colors, cardStyle, dangerButton, inputStyle, labelStyle,
  loadChoices, makeApi, money, mutedLink, niceDate, primaryButton, secondaryButton,
} from './pageKit.js';
import {
  FREQUENCIES, RULE_STATUS, describeSchedule, emptyRuleForm, ruleActions, ruleToForm,
  toRulePayload, todayIst, validateRuleForm,
} from './recurringForm.js';

/**
 * US-16 (#43): recurring transactions - create, view, edit, pause, resume and
 * delete rules (REQ-52, REQ-53, REQ-56), and see what each rule generated
 * (REQ-54). The server creates the transactions; this page only manages rules.
 */

const FILTERS = [['all', 'All'], ['active', 'Active'], ['paused', 'Paused'], ['completed', 'Completed']];

function RuleCard({ rule, busy, onEdit, onLoadDetail, onPause, onResume, onDelete }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const look = RULE_STATUS[rule.status] || RULE_STATUS.active;
  const actions = ruleActions(rule);
  const income = rule.type === 'income';

  const [detailError, setDetailError] = useState('');

  async function toggle() {
    if (!open && !detail) {
      try {
        setDetail(await onLoadDetail(rule.id));
        setDetailError('');
      } catch (err) {
        setDetailError(err.message);
      }
    }
    setOpen(!open);
  }

  return (
    <div style={{ padding: '16px 0', borderTop: `1px solid ${colors.cardBorder}`, opacity: rule.status === 'completed' ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <span style={{ fontWeight: 600, fontSize: 16 }}>{rule.category_name || (income ? 'Income' : 'Expense')}</span>{' '}
          <Badge look={look} />
          {rule.note && <div style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{rule.note}</div>}
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: income ? '#86efac' : colors.text }}>
          {income ? '+' : '−'}{money(rule.amount)}
        </div>
      </div>

      <div style={{ color: colors.muted, fontSize: 14, margin: '6px 0 10px' }}>
        {describeSchedule(rule, niceDate)} · {rule.account_name}
        {rule.next_due_date && <> · Next: <strong style={{ color: colors.text }}>{niceDate(rule.next_due_date)}</strong></>}
        {' '}· {rule.occurrences_done} created
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {actions.canEdit && <button type="button" style={secondaryButton} disabled={busy} onClick={() => onEdit(rule)}>Edit</button>}
        {actions.canPause && <button type="button" style={secondaryButton} disabled={busy} onClick={() => onPause(rule)}>Pause</button>}
        {actions.canResume && <button type="button" style={primaryButton(busy)} disabled={busy} onClick={() => onResume(rule)}>Resume</button>}
        <button type="button" style={secondaryButton} onClick={toggle} aria-expanded={open}>
          {open ? 'Hide generated' : 'Generated transactions'}
        </button>
        {!confirming && <button type="button" style={dangerButton} disabled={busy} onClick={() => setConfirming(true)}>Delete</button>}
      </div>

      {confirming && (
        <div role="alertdialog" aria-label="Confirm delete" style={{ marginTop: 10, padding: 12, borderRadius: 9, background: '#451a1a', fontSize: 14 }}>
          Move the {rule.amount} {rule.type} rule to Recovery for 30 days? Transactions it already created are kept.
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={dangerButton} disabled={busy} onClick={() => { setConfirming(false); onDelete(rule); }}>Yes, delete</button>
            <button type="button" style={secondaryButton} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      )}

      {open && detailError && <p role="alert" style={{ color: colors.redText, fontSize: 14 }}>{detailError}</p>}

      {open && detail && (
        <div style={{ marginTop: 10, fontSize: 14 }}>
          {detail.generated_transactions.length === 0
            ? <span style={{ color: colors.muted }}>Nothing has been created yet. The first one appears on {rule.next_due_date ? niceDate(rule.next_due_date) : 'its due date'} just after 00:05 IST.</span>
            : detail.generated_transactions.map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{niceDate(t.scheduled_date)}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(t.amount)}</span>
              </div>
            ))}
          <a href="#/transactions" style={{ ...mutedLink, display: 'inline-block', marginTop: 6 }}>Open transactions →</a>
        </div>
      )}
    </div>
  );
}

export default function RecurringPage() {
  const [rules, setRules] = useState(null);
  const [filter, setFilter] = useState('all');
  const [choices, setChoices] = useState({ accounts: [], categories: [] });
  const [form, setForm] = useState(() => emptyRuleForm());
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
      const [list, loaded] = await Promise.all([
        api(`/api/recurring-rules?limit=100${filter === 'all' ? '' : `&status=${filter}`}`),
        loadChoices(api),
      ]);
      setRules(list.data);
      setChoices(loaded);
      setError('');
    } catch (err) {
      setRules([]);
      setError(err.message);
    }
  }, [api, filter, ready]);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  function startCreate() {
    setEditing(null);
    setForm({ ...emptyRuleForm(), account_id: choices.accounts[0]?.id || '' });
    setFormErrors({});
    setMessage('');
    setShowForm(true);
  }

  function startEdit(rule) {
    setEditing(rule);
    setForm(ruleToForm(rule));
    setFormErrors({});
    setMessage('');
    setShowForm(true);
  }
  const loadDetail = async (id) => (await api(`/api/recurring-rules/${id}`)).data;

  async function run(action, success) {
    setBusy(true);
    setError('');
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const errors = validateRuleForm(form, { existing: editing });
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setBusy(true);
    setError('');
    try {
      const payload = toRulePayload(form);
      if (editing) {
        if (editing.occurrences_done > 0) delete payload.start_date;
        await api(`/api/recurring-rules/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setMessage('Rule updated. Changes apply to future transactions only.');
      } else {
        await api('/api/recurring-rules', { method: 'POST', body: JSON.stringify(payload) });
        setMessage('Recurring rule created.');
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

  const categoryChoices = choices.categories.filter((c) => !c.type || c.type === form.type);
  const startLocked = Boolean(editing && editing.occurrences_done > 0);

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '36px 16px', background: colors.page, color: colors.text, fontFamily: 'Inter, Segoe UI, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <nav style={{ display: 'flex', gap: 16, fontSize: 14, flexWrap: 'wrap' }}>
            <a href="#/" style={mutedLink}>← Back</a>
            <a href="#/dashboard" style={mutedLink}>Dashboard</a>
            <a href="#/transactions" style={mutedLink}>Transactions</a>
            <a href="#/bills" style={mutedLink}>Bill reminders</a>
          </nav>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: 27, margin: '10px 0 6px' }}>Recurring transactions</h1>
              <p style={{ color: colors.muted, margin: 0 }}>Rent, salary, subscriptions: set it once and it is recorded for you on each due date.</p>
            </div>
            {ready && !showForm && <button type="button" style={primaryButton(false)} onClick={startCreate}>+ New rule</button>}
          </div>
        </header>

        {!ready && <SignInRequired what="recurring transactions" />}

        {error && <div role="alert" style={{ padding: 12, marginBottom: 14, borderRadius: 8, background: '#451a1a', color: '#fecaca', fontSize: 14 }}>{error}</div>}
        {message && <div role="status" style={{ padding: 12, marginBottom: 14, borderRadius: 8, background: '#123524', color: '#bbf7d0', fontSize: 14 }}>{message}</div>}

        {ready && showForm && (
          <form onSubmit={submit} noValidate style={cardStyle} aria-label={editing ? 'Edit recurring rule' : 'New recurring rule'}>
            <h2 style={{ margin: '0 0 14px', fontSize: 18 }}>{editing ? 'Edit rule' : 'New recurring rule'}</h2>
            {editing && <p style={{ margin: '0 0 14px', color: colors.muted, fontSize: 13 }}>Edits apply to future transactions only. Ones already created stay as they are.</p>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', columnGap: 14 }}>
              <label style={labelStyle}>Type
                <select style={inputStyle} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, category_id: '' }))}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <FieldError text={formErrors.type} />
              </label>

              <label style={labelStyle}>Amount
                <input style={inputStyle} inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="15000.00" aria-invalid={Boolean(formErrors.amount)} />
                <FieldError text={formErrors.amount} />
              </label>

              <label style={labelStyle}>Account
                <select style={inputStyle} value={form.account_id} onChange={set('account_id')} aria-invalid={Boolean(formErrors.account_id)}>
                  <option value="">Select an account</option>
                  {choices.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <FieldError text={formErrors.account_id} />
              </label>

              <label style={labelStyle}>Category <span style={{ color: colors.muted, fontWeight: 400 }}>(optional)</span>
                <select style={inputStyle} value={form.category_id} onChange={set('category_id')}>
                  <option value="">No category</option>
                  {categoryChoices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <FieldError text={formErrors.category_id} />
              </label>

              <label style={labelStyle}>Repeats
                <select style={inputStyle} value={form.frequency} onChange={set('frequency')}>
                  {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <FieldError text={formErrors.frequency} />
              </label>

              <label style={labelStyle}>Start date
                <input type="date" style={inputStyle} value={form.start_date} min={editing ? undefined : todayIst()} onChange={set('start_date')} disabled={startLocked} aria-invalid={Boolean(formErrors.start_date)} />
                {startLocked && <span style={{ display: 'block', marginTop: 5, fontSize: 12, color: colors.muted, fontWeight: 400 }}>Fixed once transactions have been created.</span>}
                <FieldError text={formErrors.start_date} />
              </label>
            </div>

            <label style={labelStyle}>Ends
              <select style={inputStyle} value={form.end_mode} onChange={set('end_mode')}>
                <option value="never">Never</option>
                <option value="date">On a date</option>
                <option value="count">After a number of times</option>
              </select>
            </label>

            {form.end_mode === 'date' && (
              <label style={labelStyle}>End date
                <input type="date" style={inputStyle} value={form.end_date} min={form.start_date} onChange={set('end_date')} aria-invalid={Boolean(formErrors.end_date)} />
                <FieldError text={formErrors.end_date} />
              </label>
            )}
            {form.end_mode === 'count' && (
              <label style={labelStyle}>Number of occurrences
                <input style={inputStyle} inputMode="numeric" value={form.occurrence_count} onChange={set('occurrence_count')} placeholder="12" aria-invalid={Boolean(formErrors.occurrence_count)} />
                <FieldError text={formErrors.occurrence_count} />
              </label>
            )}

            <label style={labelStyle}>Note <span style={{ color: colors.muted, fontWeight: 400 }}>(optional)</span>
              <input style={inputStyle} value={form.note} maxLength={200} onChange={set('note')} placeholder="e.g. Flat rent" />
              <FieldError text={formErrors.note} />
            </label>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" style={primaryButton(busy)} disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}</button>
              <button type="button" style={secondaryButton} onClick={() => { setShowForm(false); setEditing(null); setFormErrors({}); }}>Cancel</button>
            </div>
          </form>
        )}

        {ready && (
          <section style={cardStyle} aria-label="Recurring rules">
            <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              {FILTERS.map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={filter === value}
                  onClick={() => { setFilter(value); setRules(null); }}
                  style={{ ...secondaryButton, background: filter === value ? '#1e293b' : 'transparent', borderColor: filter === value ? colors.green : colors.inputBorder }}>
                  {label}
                </button>
              ))}
            </div>

            {rules === null && <p role="status" style={{ color: colors.muted }}>Loading rules…</p>}

            {rules && rules.length === 0 && !error && (
              <div style={{ padding: '26px 0', textAlign: 'center', color: colors.muted }}>
                <p style={{ margin: '0 0 12px' }}>{filter === 'all' ? 'No recurring transactions yet.' : `No ${filter} rules.`}</p>
                {filter === 'all' && !showForm && <button type="button" style={primaryButton(false)} onClick={startCreate}>Create your first rule</button>}
              </div>
            )}

            {rules && rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                busy={busy}
                onEdit={startEdit}
                onLoadDetail={loadDetail}
                onPause={(r) => run(() => api(`/api/recurring-rules/${r.id}/pause`, { method: 'POST', body: '{}' }), 'Rule paused. Nothing will be created until you resume it.')}
                onResume={(r) => run(() => api(`/api/recurring-rules/${r.id}/resume`, { method: 'POST', body: '{}' }), 'Rule resumed. It continues from the next due date; the paused period is not back-filled.')}
                onDelete={(r) => run(() => api(`/api/recurring-rules/${r.id}`, { method: 'DELETE' }), 'Rule deleted. Transactions it created were kept.')}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
