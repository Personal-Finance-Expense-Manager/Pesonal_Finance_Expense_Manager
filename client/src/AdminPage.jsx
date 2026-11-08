import { useCallback, useEffect, useState } from 'react';
import { isSignedIn } from './auth.js';
import { SignedOutPage } from './SignInRequired.jsx';
import {
  cardStyle, colors, dangerButton, inputStyle, labelStyle, makeApi, mutedLink, primaryButton, secondaryButton,
} from './pageKit.js';

/**
 * Administration - US-26 (#62), SRS REQ-94, REQ-96, REQ-97.
 *
 * Open it at /#/admin (the link appears only for administrators; the server
 * checks the role on every request regardless).
 *
 * An administrator sees accounts and their status, the audit trail and the
 * backups. Nothing on this screen - and no endpoint behind it - shows a
 * transaction, balance, attachment or report.
 */
const api = makeApi();
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN') : '-');
const TABS = [['overview', 'Overview'], ['users', 'Users'], ['audit', 'Audit trail'], ['backups', 'Backups']];

const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: colors.muted, borderBottom: `1px solid ${colors.cardBorder}` };
const tdStyle = { padding: '9px 10px', fontSize: 14, borderBottom: `1px solid ${colors.cardBorder}`, verticalAlign: 'top' };
const pill = (status) => ({
  padding: '2px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700,
  background: status === 'active' ? '#14532d' : status === 'suspended' ? '#7f1d1d' : '#334155',
  color: '#fff',
});

function Pager({ page, totalPages, onPage }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
      <button style={secondaryButton} disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span style={{ color: colors.muted, fontSize: 14 }}>Page {page} of {totalPages}</span>
      <button style={secondaryButton} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/admin/summary').then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <p role="alert" style={{ color: colors.redText }}>{error}</p>;
  if (!data) return <p style={{ color: colors.muted }}>Loading…</p>;
  const { users, backups, audit } = data;
  const tiles = [['Total users', users.total], ['Active', users.active], ['Suspended', users.suspended], ['Closed (erased)', users.closed], ['Unverified', users.unverified], ['Administrators', users.admins], ['New in 30 days', users.new_last_30_days]];
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {tiles.map(([label, value]) => (
          <div key={label} style={{ ...cardStyle, marginBottom: 0, padding: 16 }}>
            <div style={{ color: colors.muted, fontSize: 13 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ ...cardStyle, marginTop: 18 }}>
        <h3 style={{ marginTop: 0 }}>System status</h3>
        <p>Automated backups: <strong>{backups.enabled ? 'on' : 'OFF'}</strong> (every {backups.interval_hours} h, kept {backups.retention_days} days)</p>
        <p>Last successful backup: <strong>{when(backups.last_success_at)}</strong> ({backups.count} retained)</p>
        {backups.last_failure_at && <p style={{ color: colors.redText }}>Last failure: {when(backups.last_failure_at)} - {backups.last_failure_message}</p>}
        <p>Audit-trail write failures since the server started: <strong>{audit.write_failures_since_start}</strong></p>
      </div>
    </>
  );
}

function Users() {
  const [filters, setFilters] = useState({ status: '', role: '', email: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    const q = new URLSearchParams({ page, limit: 10 });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    api(`/api/admin/users?${q}`).then((r) => { setResult(r); setError(''); }).catch((e) => setError(e.message));
  }, [filters, page]);
  useEffect(load, [load]);

  async function act(user, action) {
    setNotice(''); setError('');
    let body = {};
    if (action === 'suspend') {
      const reason = window.prompt(`Why is ${user.email} being suspended? (required, shown only to administrators)`);
      if (!reason) return;
      body = { reason };
    }
    try {
      await api(`/api/admin/users/${user.id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      setNotice(action === 'suspend' ? 'Account suspended and signed out.' : 'Account restored.');
      load();
    } catch (e) { setError(e.message); }
  }

  const set = (name) => (e) => { setPage(1); setFilters((f) => ({ ...f, [name]: e.target.value })); };
  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ ...labelStyle, flex: '1 1 160px' }}>Status
          <select style={inputStyle} value={filters.status} onChange={set('status')}>
            <option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option>
          </select>
        </label>
        <label style={{ ...labelStyle, flex: '1 1 160px' }}>Role
          <select style={inputStyle} value={filters.role} onChange={set('role')}>
            <option value="">All</option><option value="user">User</option><option value="admin">Administrator</option>
          </select>
        </label>
        <label style={{ ...labelStyle, flex: '2 1 260px' }}>Exact email address
          <input style={inputStyle} value={filters.email} onChange={set('email')} placeholder="name@example.com" />
        </label>
      </div>
      <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>Names and emails are stored encrypted, so only an exact email can be searched.</p>
      {error && <p role="alert" style={{ color: colors.redText }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#86efac' }}>{notice}</p>}
      {!result ? <p style={{ color: colors.muted }}>Loading…</p> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Name', 'Email', 'Role', 'Status', 'Verified', 'Joined', 'Last sign-in', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {result.data.map((u) => (
                  <tr key={u.id}>
                    <td style={tdStyle}>{u.name}</td>
                    <td style={tdStyle}>{u.email}</td>
                    <td style={tdStyle}>{u.role}</td>
                    <td style={tdStyle}><span style={pill(u.status)}>{u.status}</span>{u.suspension_reason && <div style={{ color: colors.muted, fontSize: 12 }}>{u.suspension_reason}</div>}</td>
                    <td style={tdStyle}>{u.email_verified ? 'Yes' : 'No'}</td>
                    <td style={tdStyle}>{when(u.created_at)}</td>
                    <td style={tdStyle}>{when(u.last_sign_in_at)}</td>
                    <td style={tdStyle}>
                      {u.role !== 'admin' && u.status === 'active' && <button style={dangerButton} onClick={() => act(u, 'suspend')}>Suspend</button>}
                      {u.role !== 'admin' && u.status === 'suspended' && <button style={secondaryButton} onClick={() => act(u, 'restore')}>Restore</button>}
                    </td>
                  </tr>
                ))}
                {!result.data.length && <tr><td style={tdStyle} colSpan={8}>No users match.</td></tr>}
              </tbody>
            </table>
          </div>
          <p style={{ color: colors.muted, fontSize: 13 }}>{result.total} user(s)</p>
          <Pager page={result.page} totalPages={result.total_pages} onPage={setPage} />
        </>
      )}
    </>
  );
}

function Audit() {
  const [filters, setFilters] = useState({ category: '', outcome: '', from: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const q = new URLSearchParams({ page, limit: 25 });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, k === 'from' ? new Date(v).toISOString() : v);
    api(`/api/admin/audit-logs?${q}`).then((r) => { setResult(r); setError(''); }).catch((e) => setError(e.message));
  }, [filters, page]);
  const set = (name) => (e) => { setPage(1); setFilters((f) => ({ ...f, [name]: e.target.value })); };
  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ ...labelStyle, flex: '1 1 160px' }}>Category
          <select style={inputStyle} value={filters.category} onChange={set('category')}>
            <option value="">All</option>
            {['auth', 'authz', 'export', 'bulk_delete', 'admin', 'backup', 'privacy', 'security', 'data'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: '1 1 160px' }}>Outcome
          <select style={inputStyle} value={filters.outcome} onChange={set('outcome')}>
            <option value="">All</option><option>success</option><option>failure</option><option>denied</option>
          </select>
        </label>
        <label style={{ ...labelStyle, flex: '1 1 180px' }}>Since
          <input style={inputStyle} type="date" value={filters.from} onChange={set('from')} />
        </label>
      </div>
      <p style={{ color: colors.muted, fontSize: 13, marginTop: 0 }}>Records are append-only and kept for 12 months. They never contain passwords, tokens, notes or amounts.</p>
      {error && <p role="alert" style={{ color: colors.redText }}>{error}</p>}
      {!result ? <p style={{ color: colors.muted }}>Loading…</p> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['When', 'Action', 'Outcome', 'Actor', 'Source IP', 'Details'].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {result.data.map((e) => (
                  <tr key={e.id}>
                    <td style={tdStyle}>{when(e.timestamp)}</td>
                    <td style={tdStyle}>{e.action}<div style={{ color: colors.muted, fontSize: 12 }}>{e.category}</div></td>
                    <td style={tdStyle}>{e.outcome}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{e.actor_id || '-'}{e.actor_role ? ` (${e.actor_role})` : ''}</td>
                    <td style={tdStyle}>{e.ip_address || '-'}</td>
                    <td style={{ ...tdStyle, fontSize: 12, color: colors.muted }}>{e.metadata ? JSON.stringify(e.metadata) : ''}</td>
                  </tr>
                ))}
                {!result.data.length && <tr><td style={tdStyle} colSpan={6}>No records match.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={result.page} totalPages={result.total_pages} onPage={setPage} />
        </>
      )}
    </>
  );
}

function Backups() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [restoring, setRestoring] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const load = useCallback(() => { api('/api/admin/backups').then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(load, [load]);

  async function run(label, path, body) {
    setBusy(label); setError(''); setNotice('');
    try {
      const r = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
      setNotice(r.message); load();
      return r;
    } catch (e) { setError(e.message); return null; } finally { setBusy(''); }
  }

  async function restore() {
    const r = await run('restore', `/api/admin/backups/${restoring}/restore`, { confirm, password });
    if (r) { setRestoring(null); setPassword(''); setConfirm(''); }
  }

  if (!data) return error ? <p role="alert" style={{ color: colors.redText }}>{error}</p> : <p style={{ color: colors.muted }}>Loading…</p>;
  return (
    <>
      <p style={{ color: colors.muted }}>
        Encrypted backups are taken every 24 hours and kept {data.status.retention_days} days. A backup covers the whole database; uploaded receipt files are protected separately (see docs/BACKUP_AND_RESTORE.md).
      </p>
      <button style={primaryButton(busy === 'create')} disabled={Boolean(busy)} onClick={() => run('create', '/api/admin/backups')}>
        {busy === 'create' ? 'Backing up…' : 'Back up now'}
      </button>
      {error && <p role="alert" style={{ color: colors.redText }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#86efac' }}>{notice}</p>}
      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Created', 'Type', 'Consistency', 'Documents', 'Size', ''].map((h) => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {data.data.map((b) => (
              <tr key={b.id}>
                <td style={tdStyle}>{when(b.created_at)}<div style={{ color: colors.muted, fontSize: 12, fontFamily: 'monospace' }}>{b.id}</div></td>
                <td style={tdStyle}>{b.trigger}</td>
                <td style={tdStyle}>{b.consistency}</td>
                <td style={tdStyle}>{b.documents}</td>
                <td style={tdStyle}>{(b.size_bytes / 1024).toFixed(1)} KB</td>
                <td style={tdStyle}>
                  <button style={secondaryButton} disabled={Boolean(busy)} onClick={() => run('verify', `/api/admin/backups/${b.id}/verify`)}>Verify</button>{' '}
                  <button style={dangerButton} disabled={Boolean(busy)} onClick={() => setRestoring(b.id)}>Restore…</button>
                </td>
              </tr>
            ))}
            {!data.data.length && <tr><td style={tdStyle} colSpan={6}>No backups yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {restoring && (
        <div role="dialog" aria-label="Confirm restore" style={{ ...cardStyle, marginTop: 18, borderColor: '#7f1d1d' }}>
          <h3 style={{ marginTop: 0, color: colors.redText }}>Restore this backup?</h3>
          <p>This <strong>replaces all current data</strong> with the backup. The service is unavailable while it runs, and a safety backup of the current data is taken first.</p>
          <label style={labelStyle}>Your password
            <input style={inputStyle} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label style={labelStyle}>Type RESTORE to confirm
            <input style={inputStyle} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <button style={dangerButton} disabled={busy === 'restore' || confirm !== 'RESTORE' || !password} onClick={restore}>
            {busy === 'restore' ? 'Restoring…' : 'Restore now'}
          </button>{' '}
          <button style={secondaryButton} onClick={() => setRestoring(null)}>Cancel</button>
        </div>
      )}
    </>
  );
}

function AdminContent() {
  const [tab, setTab] = useState('overview');
  const [allowed, setAllowed] = useState(null);

  useEffect(() => {
    api('/api/auth/me').then((r) => setAllowed(r.data?.role === 'admin')).catch(() => setAllowed(false));
  }, []);

  if (allowed === null) return <main style={{ padding: 24, color: colors.muted }}>Loading…</main>;
  if (!allowed) {
    return (
      <main style={{ padding: 24, color: colors.text }}>
        <h1>Administration</h1>
        <p>This area is for administrators.</p>
        <a href="#/" style={mutedLink}>Back</a>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', background: colors.page, color: colors.text, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <a href="#/" style={mutedLink}>← Back</a>
        <h1>Administration</h1>
        <nav style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }} aria-label="Administration sections">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
              style={{ ...secondaryButton, background: tab === id ? colors.card : 'transparent', borderColor: tab === id ? colors.green : colors.inputBorder }}>
              {label}
            </button>
          ))}
        </nav>
        <section style={cardStyle}>
          {tab === 'overview' && <Overview />}
          {tab === 'users' && <Users />}
          {tab === 'audit' && <Audit />}
          {tab === 'backups' && <Backups />}
        </section>
      </div>
    </main>
  );
}

export default function AdminPage() {
  if (!isSignedIn()) return <SignedOutPage title="Administration" what="the administration area" />;
  return <AdminContent />;
}
