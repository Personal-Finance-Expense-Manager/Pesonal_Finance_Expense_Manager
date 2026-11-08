import { useEffect, useState } from 'react';
import { API_URL, cardStyle, colors, dangerButton, inputStyle, labelStyle, makeApi, mutedLink, primaryButton, secondaryButton } from './pageKit.js';
import { authHeaders, clearSession, isSignedIn } from './auth.js';
import { SignedOutPage } from './SignInRequired.jsx';

/**
 * Privacy & data - US-28 (#67), SRS SEC-13, DPDP Act rights.
 *
 * Open it at /#/privacy. Access (what is held), portability (download it),
 * correction (name, mobile), and erasure - which is also how consent is
 * withdrawn: without consent PFEM cannot keep the data, so it is erased.
 */
const api = makeApi();
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN') : '-');

function PrivacyContent() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => api('/api/privacy/me').then((r) => {
    setReport(r.data);
    setName(r.data.profile.name || '');
    setMobile(r.data.profile.mobile_number || '');
  }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function download() {
    setBusy('export'); setError('');
    try {
      const response = await fetch(`${API_URL}/api/privacy/export`, { headers: authHeaders() });
      if (!response.ok) throw new Error('The export could not be created.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url; link.download = 'pfem-my-data.json'; link.click();
      URL.revokeObjectURL(url);
      setNotice('Your data was downloaded.');
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function correct(event) {
    event.preventDefault(); setBusy('correct'); setError(''); setNotice('');
    try {
      await api('/api/privacy/profile', { method: 'PATCH', body: JSON.stringify({ name, mobileNumber: mobile || null }) });
      setNotice('Your details were updated.'); load();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function giveConsent() {
    setBusy('consent'); setError('');
    try {
      await api('/api/privacy/consent', { method: 'POST', body: JSON.stringify({ dataProcessingConsent: true }) });
      setNotice('Consent recorded.'); load();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function erase(event) {
    event.preventDefault(); setBusy('erase'); setError('');
    try {
      await api('/api/privacy/account', { method: 'DELETE', body: JSON.stringify({ password, confirm }) });
      clearSession();
      window.location.assign('/');
    } catch (e) { setError(e.message); setBusy(''); }
  }

  if (!report) return <main style={{ padding: 24, color: colors.muted }}>{error || 'Loading…'}</main>;

  return (
    <main style={{ minHeight: '100vh', background: colors.page, color: colors.text, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <a href="#/" style={mutedLink}>← Back</a>
        <h1>Privacy &amp; data</h1>
        {error && <p role="alert" style={{ color: colors.redText }}>{error}</p>}
        {notice && <p role="status" style={{ color: '#86efac' }}>{notice}</p>}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>What we hold about you</h2>
          <p>{report.profile.name} · {report.profile.email}{report.profile.mobile_number ? ` · ${report.profile.mobile_number}` : ''}</p>
          <ul>{Object.entries(report.records_held).map(([k, v]) => <li key={k}>{v} {k}</li>)}</ul>
          {report.consent?.personal_data_processing && !report.consent.withdrawn_at ? (
            <p>You consented on {when(report.consent.given_at)} (notice version {report.consent.policy_version}).</p>
          ) : (
            <>
              <p style={{ color: colors.amber }}>No consent to process your personal data is on record for this account.</p>
              <button style={primaryButton(busy === 'consent')} disabled={busy === 'consent'} onClick={giveConsent}>I consent to processing of my personal data</button>
            </>
          )}
          <h3>How long it is kept</h3>
          <ul>{Object.values(report.retention).map((text) => <li key={text}>{text}</li>)}</ul>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Download your data</h2>
          <p>Everything in your account as a JSON file.</p>
          <button style={primaryButton(busy === 'export')} disabled={busy === 'export'} onClick={download}>Download my data</button>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Correct your details</h2>
          <form onSubmit={correct}>
            <label style={labelStyle}>Name<input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></label>
            <label style={labelStyle}>Mobile number<input style={inputStyle} value={mobile} onChange={(e) => setMobile(e.target.value)} maxLength={30} /></label>
            <button style={primaryButton(busy === 'correct')} disabled={busy === 'correct'}>Save</button>
          </form>
        </section>

        <section style={{ ...cardStyle, borderColor: '#7f1d1d' }}>
          <h2 style={{ marginTop: 0, color: colors.redText }}>Erase my account and withdraw consent</h2>
          <p>This permanently deletes your accounts, transactions, budgets, goals, receipts and every other record, and signs you out everywhere. It cannot be undone. A security record of your sign-ins (no amounts or notes) is kept for 12 months, and encrypted backups age out within 7 days.</p>
          <form onSubmit={erase}>
            <label style={labelStyle}>Your password<input style={inputStyle} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <label style={labelStyle}>Type DELETE to confirm<input style={inputStyle} value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
            <button style={dangerButton} disabled={busy === 'erase' || confirm !== 'DELETE' || !password}>{busy === 'erase' ? 'Erasing…' : 'Erase everything'}</button>{' '}
            <a href="#/" style={{ ...secondaryButton, textDecoration: 'none', display: 'inline-block' }}>Cancel</a>
          </form>
        </section>
      </div>
    </main>
  );
}

export default function PrivacyPage() {
  if (!isSignedIn()) return <SignedOutPage title="Privacy & data" what="your privacy settings" />;
  return <PrivacyContent />;
}
