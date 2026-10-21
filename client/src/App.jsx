import { useEffect, useState } from 'react';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const passwordChecks = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'One digit', test: (p) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const initialForm = {
  name: '',
  email: '',
  password: '',
  mobileNumber: '',
  termsAccepted: false,
  privacyPolicyAccepted: false,
};

export default function App() {
  const [mode, setMode] = useState('register');
  const [form, setForm] = useState(initialForm);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState('Checking connection...');
  const [unmetRules, setUnmetRules] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((r) => {
        if (!r.ok) throw new Error('API unavailable');
        return r.json();
      })
      .then((data) => {
        setHealth(
          data.database === 'connected'
            ? 'API and database connected'
            : `API online — database ${data.database}`
        );
      })
      .catch(() => setHealth('API connection unavailable'));
  }, []);

  function updateField(event) {
    const { name, value, checked, type } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  async function apiRequest(path, payload) {
    const response = await fetch(`${API_URL}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const err = new Error(data.message || 'Request failed.');
      err.unmetRules = data.unmetRules || [];
      throw err;
    }

    return data;
  }

  async function handleRegister(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setUnmetRules([]);

    const rules = passwordChecks
      .filter((rule) => !rule.test(form.password))
      .map((rule) => rule.label);

    if (rules.length) {
      setUnmetRules(rules);
      setError('Please meet all password requirements.');
      return;
    }

    if (!form.termsAccepted || !form.privacyPolicyAccepted) {
      setError('Please accept both the Terms of Service and Privacy Policy.');
      return;
    }

    setBusy(true);

    try {
      const result = await apiRequest('register', form);
      setMode('verify');
      setMessage(result.message);
    } catch (err) {
      setError(err.message);
      setUnmetRules(err.unmetRules || []);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);

    try {
      const result = await apiRequest('verify-email', {
        email: form.email,
        code,
      });

      setMode('complete');
      setMessage(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setError('');
    setMessage('');
    setBusy(true);

    try {
      const result = await apiRequest('resend-code', {
        email: form.email,
      });
      setMessage(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    marginTop: '7px',
    border: '1px solid #344054',
    borderRadius: '9px',
    background: '#101827',
    color: '#f8fafc',
    fontSize: '15px',
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '17px',
    color: '#e2e8f0',
    fontSize: '14px',
    fontWeight: 500,
  };

  const buttonStyle = {
    width: '100%',
    padding: '13px',
    border: 'none',
    borderRadius: '9px',
    background: busy ? '#64748b' : '#16a34a',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 700,
    cursor: busy ? 'wait' : 'pointer',
    marginTop: '8px',
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: '36px 18px',
        background: '#0b1120',
        color: '#f8fafc',
        fontFamily: 'Inter, Segoe UI, sans-serif',
      }}
    >
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: 30 }}>
          <div
            style={{
              width: 54,
              height: 54,
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 18px',
              borderRadius: 16,
              background: '#14532d',
              color: '#86efac',
              fontSize: 27,
            }}
          >
            ₹
          </div>

          <h1 style={{ fontSize: 27, margin: '0 0 10px' }}>
            Personal Finance
          </h1>
          <p style={{ color: '#94a3b8', margin: 0 }}>
            Expense Manager · Create your account
          </p>
        </header>

        <section
          style={{
            padding: 27,
            background: '#172033',
            border: '1px solid #283449',
            borderRadius: 18,
            boxShadow: '0 18px 50px #0003',
          }}
        >
          {mode === 'register' && (
            <>
              <h2 style={{ marginTop: 0, fontSize: 22 }}>Create an account</h2>
              <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6 }}>
                Register with your details and verify your email to get started.
              </p>

              <form onSubmit={handleRegister}>
                <label style={labelStyle}>
                  Full name
                  <input
                    style={inputStyle}
                    name="name"
                    value={form.name}
                    onChange={updateField}
                    autoComplete="name"
                    maxLength={120}
                    required
                    placeholder="Enter your full name"
                  />
                </label>

                <label style={labelStyle}>
                  Email address
                  <input
                    style={inputStyle}
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={updateField}
                    autoComplete="email"
                    required
                    placeholder="you@example.com"
                  />
                </label>

                <label style={labelStyle}>
                  Mobile number <span style={{ color: '#94a3b8' }}>(optional)</span>
                  <input
                    style={inputStyle}
                    name="mobileNumber"
                    type="tel"
                    value={form.mobileNumber}
                    onChange={updateField}
                    autoComplete="tel"
                    maxLength={30}
                    placeholder="Enter mobile number"
                  />
                </label>

                <label style={labelStyle}>
                  Password
                  <input
                    style={inputStyle}
                    name="password"
                    type="password"
                    value={form.password}
                    onChange={updateField}
                    autoComplete="new-password"
                    maxLength={128}
                    required
                    placeholder="Create a strong password"
                  />
                </label>

                <div
                  style={{
                    marginTop: -7,
                    marginBottom: 19,
                    fontSize: 13,
                    lineHeight: 1.9,
                  }}
                >
                  {passwordChecks.map((rule) => {
                    const passed = rule.test(form.password);
                    return (
                      <div
                        key={rule.label}
                        style={{
                          color: passed ? '#86efac' : '#94a3b8',
                        }}
                      >
                        {passed ? '✓' : '○'} {rule.label}
                      </div>
                    );
                  })}
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    marginBottom: 15,
                    fontSize: 13,
                    color: '#cbd5e1',
                    lineHeight: 1.5,
                  }}
                >
                  <input
                    type="checkbox"
                    name="termsAccepted"
                    checked={form.termsAccepted}
                    onChange={updateField}
                    required
                  />
                  I accept the Terms of Service.
                </label>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    marginBottom: 17,
                    fontSize: 13,
                    color: '#cbd5e1',
                    lineHeight: 1.5,
                  }}
                >
                  <input
                    type="checkbox"
                    name="privacyPolicyAccepted"
                    checked={form.privacyPolicyAccepted}
                    onChange={updateField}
                    required
                  />
                  I have read and accept the Privacy Policy.
                </label>

                <button style={buttonStyle} type="submit" disabled={busy}>
                  {busy ? 'Creating account...' : 'Create account'}
                </button>
              </form>
            </>
          )}

          {mode === 'verify' && (
            <>
              <h2 style={{ marginTop: 0, fontSize: 22 }}>Verify your email</h2>
              <p style={{ color: '#94a3b8', lineHeight: 1.7 }}>
                Enter the six-digit code sent to <strong>{form.email}</strong>.
                The code expires in 10 minutes.
              </p>

              <form onSubmit={handleVerify}>
                <label style={labelStyle}>
                  Six-digit verification code
                  <input
                    style={{
                      ...inputStyle,
                      textAlign: 'center',
                      letterSpacing: 8,
                      fontSize: 22,
                    }}
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    placeholder="000000"
                  />
                </label>

                <button style={buttonStyle} type="submit" disabled={busy}>
                  {busy ? 'Verifying...' : 'Verify email'}
                </button>
              </form>

              <button
                type="button"
                disabled={busy}
                onClick={handleResend}
                style={{
                  ...buttonStyle,
                  color: '#86efac',
                  background: 'transparent',
                  border: '1px solid #166534',
                  cursor: busy ? 'wait' : 'pointer',
                }}
              >
                Resend verification code
              </button>
            </>
          )}

          {mode === 'complete' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 46, color: '#86efac' }}>✓</div>
              <h2>Email verified!</h2>
              <p style={{ color: '#cbd5e1', lineHeight: 1.7 }}>
                Your registration email has been verified successfully.
              </p>
            </div>
          )}

          {error && (
            <p
              role="alert"
              style={{
                padding: 12,
                background: '#451a1a',
                color: '#fecaca',
                borderRadius: 8,
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {error}
              {unmetRules.length > 0 && (
                <ul>
                  {unmetRules.map((rule) => <li key={rule}>{rule}</li>)}
                </ul>
              )}
            </p>
          )}

          {message && (
            <p
              role="status"
              style={{
                padding: 12,
                background: '#123524',
                color: '#bbf7d0',
                borderRadius: 8,
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              {message}
            </p>
          )}

          <p
            style={{
              margin: '22px 0 0',
              color: '#64748b',
              textAlign: 'center',
              fontSize: 12,
            }}
          >
            {health}
          </p>
        </section>

        <p
          style={{
            textAlign: 'center',
            color: '#64748b',
            fontSize: 12,
            marginTop: 22,
          }}
        >
          Team 9 · PES University · Release 1.0
        </p>
      </div>
    </main>
  );
}