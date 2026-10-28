import { useEffect, useState } from 'react';
import './App.css';
import { saveSession, clearSession, getToken, getUser, isSignedIn } from './auth.js';

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

function getInitialScreen() {
  const params = new URLSearchParams(window.location.search);

  if (
    window.location.pathname === '/reset-password' &&
    params.get('token') &&
    params.get('email')
  ) {
    return {
      mode: 'resetConfirm',
      email: params.get('email'),
      token: params.get('token'),
    };
  }

  // A stored session survives a reload and a trip to a feature page, so the
  // signed-in screen - not the sign-up form - is what a signed-in user comes
  // back to (US-25, REQ-93).
  if (isSignedIn()) {
    return { mode: 'account', email: '', token: '' };
  }

  return { mode: 'register', email: '', token: '' };
}

export default function App() {
  const [initialScreen] = useState(getInitialScreen);
  const [mode, setMode] = useState(initialScreen.mode);
  const [form, setForm] = useState(initialForm);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [resetEmail, setResetEmail] = useState(initialScreen.email);
  const [resetToken] = useState(initialScreen.token);
  const [newPassword, setNewPassword] = useState('');

  const [code, setCode] = useState('');
  // Seeded from the stored session so navigating back to "#/" shows the
  // signed-in screen instead of dropping the user at sign-in.
  const [token, setToken] = useState(() => getToken() || null);
  const [loggedInUser, setLoggedInUser] = useState(() => getUser());

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState('Checking API connection...');
  const [unmetRules, setUnmetRules] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        return response.json();
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

  // A stored session can have expired or been revoked while the tab was shut.
  // Check it once on mount so a stale token shows sign-in rather than a
  // signed-in screen whose pages then fail (US-25, REQ-93).
  useEffect(() => {
    const stored = getToken();

    if (!stored) return;

    let cancelled = false;

    fetch(`${API_URL}/api/accounts`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then((response) => {
        if (cancelled || response.status !== 401) return;
        clearSession();
        setToken(null);
        setLoggedInUser(null);
        setMode('login');
      })
      .catch(() => {
        // Offline or the API is down: keep the session and let the page say so.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function clearFeedback() {
    setError('');
    setMessage('');
    setUnmetRules([]);
  }

  function navigate(nextMode) {
    clearFeedback();
    setMode(nextMode);
  }

  function updateField(event) {
    const { name, value, checked, type } = event.target;

    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  async function apiRequest(path, payload, bearerToken = null) {
    const headers = { 'Content-Type': 'application/json' };

    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    const response = await fetch(`${API_URL}/api/auth/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const requestError = new Error(
        data.message || 'The request failed.'
      );
      requestError.unmetRules = data.unmetRules || [];
      throw requestError;
    }

    return data;
  }

  async function handleRegister(event) {
    event.preventDefault();
    clearFeedback();

    if (!form.termsAccepted || !form.privacyPolicyAccepted) {
      setError('Accept both policies to continue.');
      return;
    }

    setBusy(true);

    try {
      const result = await apiRequest('register', form);
      setMessage(result.message);
      setMode('verify');
    } catch (requestError) {
      setError(requestError.message);
      setUnmetRules(requestError.unmetRules || []);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);

    try {
      const result = await apiRequest('verify-email', {
        email: form.email,
        code,
      });

      setMessage(result.message);
      setMode('complete');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    clearFeedback();
    setBusy(true);

    try {
      const result = await apiRequest('resend-code', {
        email: form.email,
      });
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);

    try {
      const result = await apiRequest('login', {
        email: loginEmail,
        password: loginPassword,
      });

      setToken(result.token);
      setLoggedInUser(result.user);
      setLoginPassword('');

      // US-25 (REQ-93): keep the session so every feature page can send it.
      saveSession(result.token, result.user);

      setMessage('Sign-in successful.');
      setMode('account');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    clearFeedback();
    setBusy(true);

    try {
      await apiRequest('logout', {}, token);

      setToken(null);
      setLoggedInUser(null);
      setLoginPassword('');
      clearSession();
      setMessage('Signed out successfully.');
      setMode('login');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetRequest(event) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);

    try {
      const result = await apiRequest('password-reset/request', {
        email: resetEmail,
      });
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetConfirm(event) {
    event.preventDefault();
    clearFeedback();

    const missingRules = passwordChecks
      .filter((rule) => !rule.test(newPassword))
      .map((rule) => rule.label);

    if (missingRules.length > 0) {
      setError('Password does not meet the requirements.');
      setUnmetRules(missingRules);
      return;
    }

    setBusy(true);

    try {
      const result = await apiRequest('password-reset/confirm', {
        email: resetEmail,
        token: resetToken,
        newPassword,
      });

      setNewPassword('');
      setLoginEmail(resetEmail);
      setMessage(result.message);
      setMode('login');

      // Remove the one-time token from the address bar.
      window.history.replaceState({}, document.title, '/');
    } catch (requestError) {
      setError(requestError.message);
      setUnmetRules(requestError.unmetRules || []);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    marginTop: 7,
    marginBottom: 17,
    border: '1px solid #344054',
    borderRadius: 9,
    background: '#101827',
    color: '#f8fafc',
    fontSize: 15,
  };

  const labelStyle = {
    display: 'block',
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: 500,
  };

  const buttonStyle = {
    width: '100%',
    padding: 13,
    border: 0,
    borderRadius: 9,
    background: busy ? '#64748b' : '#16a34a',
    color: '#fff',
    fontSize: 15,
    fontWeight: 700,
    cursor: busy ? 'wait' : 'pointer',
    marginTop: 8,
  };

  function renderPasswordRules(password) {
    return (
      <div style={{ marginBottom: 16, fontSize: 13, lineHeight: 1.9 }}>
        {passwordChecks.map((rule) => {
          const passed = rule.test(password);

          return (
            <div
              key={rule.label}
              style={{ color: passed ? '#86efac' : '#94a3b8' }}
            >
              {passed ? '✓' : '○'} {rule.label}
            </div>
          );
        })}
      </div>
    );
  }

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
            Expense Manager · Team 9
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
              <h2 style={{ marginTop: 0 }}>Create an account</h2>

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
                    placeholder="Your full name"
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
                  Mobile number (optional)
                  <input
                    style={inputStyle}
                    name="mobileNumber"
                    type="tel"
                    value={form.mobileNumber}
                    onChange={updateField}
                    autoComplete="tel"
                    maxLength={30}
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

                {renderPasswordRules(form.password)}

                <label style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
                  <input
                    type="checkbox"
                    name="termsAccepted"
                    checked={form.termsAccepted}
                    onChange={updateField}
                    required
                  />
                  I accept the Terms of Service.
                </label>

                <label style={{ display: 'flex', gap: 10, marginBottom: 17 }}>
                  <input
                    type="checkbox"
                    name="privacyPolicyAccepted"
                    checked={form.privacyPolicyAccepted}
                    onChange={updateField}
                    required
                  />
                  I accept the Privacy Policy.
                </label>

                <button style={buttonStyle} disabled={busy}>
                  {busy ? 'Creating account...' : 'Create account'}
                </button>
              </form>

              <button
                type="button"
                style={{ ...buttonStyle, background: '#334155' }}
                onClick={() => navigate('login')}
              >
                Already registered? Sign in
              </button>
            </>
          )}

          {mode === 'verify' && (
            <>
              <h2 style={{ marginTop: 0 }}>Verify your email</h2>
              <p style={{ color: '#94a3b8', lineHeight: 1.7 }}>
                Enter the six-digit code sent to {form.email}.
              </p>

              <form onSubmit={handleVerify}>
                <label style={labelStyle}>
                  Verification code
                  <input
                    style={{ ...inputStyle, fontSize: 22, letterSpacing: 8 }}
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </label>

                <button style={buttonStyle} disabled={busy}>
                  Verify email
                </button>
              </form>

              <button
                type="button"
                style={{ ...buttonStyle, background: '#334155' }}
                onClick={handleResend}
                disabled={busy}
              >
                Resend verification code
              </button>
            </>
          )}

          {mode === 'complete' && (
            <>
              <h2>Email verified!</h2>
              <p>Your registration email was verified successfully.</p>
              <button
                style={buttonStyle}
                onClick={() => {
                  setLoginEmail(form.email);
                  navigate('login');
                }}
              >
                Continue to sign in
              </button>
            </>
          )}

          {mode === 'login' && (
            <>
              <h2 style={{ marginTop: 0 }}>Sign in</h2>
              <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>
                Sign in securely to access your financial information.
              </p>

              <form onSubmit={handleLogin}>
                <label style={labelStyle}>
                  Email address
                  <input
                    style={inputStyle}
                    type="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>

                <label style={labelStyle}>
                  Password
                  <input
                    style={inputStyle}
                    type="password"
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    autoComplete="current-password"
                    maxLength={128}
                    required
                  />
                </label>

                <button style={buttonStyle} disabled={busy}>
                  {busy ? 'Signing in...' : 'Sign in'}
                </button>
              </form>

              <button
                type="button"
                style={{ ...buttonStyle, background: '#334155' }}
                onClick={() => navigate('resetRequest')}
              >
                Forgot password?
              </button>

              <button
                type="button"
                style={{
                  ...buttonStyle,
                  background: 'transparent',
                  border: '1px solid #475569',
                }}
                onClick={() => navigate('register')}
              >
                Create an account
              </button>
            </>
          )}

          {mode === 'resetRequest' && (
            <>
              <h2 style={{ marginTop: 0 }}>Reset your password</h2>
              <p style={{ color: '#94a3b8', lineHeight: 1.7 }}>
                Enter your registered email. If an eligible account exists,
                we'll send a reset link valid for 15 minutes.
              </p>

              <form onSubmit={handleResetRequest}>
                <label style={labelStyle}>
                  Email address
                  <input
                    style={inputStyle}
                    type="email"
                    value={resetEmail}
                    onChange={(event) => setResetEmail(event.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>

                <button style={buttonStyle} disabled={busy}>
                  {busy ? 'Requesting...' : 'Send reset link'}
                </button>
              </form>

              <button
                type="button"
                style={{ ...buttonStyle, background: '#334155' }}
                onClick={() => navigate('login')}
              >
                Back to sign in
              </button>
            </>
          )}

          {mode === 'resetConfirm' && (
            <>
              <h2 style={{ marginTop: 0 }}>Choose a new password</h2>
              <p style={{ color: '#94a3b8', lineHeight: 1.7 }}>
                Reset link for {resetEmail}. The link can only be used once
                and expires after 15 minutes.
              </p>

              <form onSubmit={handleResetConfirm}>
                <label style={labelStyle}>
                  New password
                  <input
                    style={inputStyle}
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    maxLength={128}
                    required
                  />
                </label>

                {renderPasswordRules(newPassword)}

                <button style={buttonStyle} disabled={busy}>
                  {busy ? 'Resetting...' : 'Reset password'}
                </button>
              </form>
            </>
          )}

          {mode === 'account' && loggedInUser && (
            <>
              <h2 style={{ marginTop: 0 }}>You're signed in</h2>
              <p style={{ color: '#94a3b8' }}>
                Welcome, {loggedInUser.name}.
              </p>
              <p>{loggedInUser.email}</p>

              {/* US-25 (REQ-93): the session now authenticates every feature
                  page, so the signed-in user can go straight to the app. */}
              <nav
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 8,
                  margin: '18px 0',
                }}
              >
                {[
                  ['Dashboard', '#/dashboard'],
                  ['Accounts', '#/accounts'],
                  ['Transactions', '#/transactions'],
                  ['Categories', '#/categories'],
                  ['Totals', '#/totals'],
                  ['Budgets', '#/budgets'],
                  ['Import & export', '#/data'],
                ].map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 9,
                      border: '1px solid #344054',
                      color: '#e2e8f0',
                      textDecoration: 'none',
                      textAlign: 'center',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {label}
                  </a>
                ))}
              </nav>

              <button
                style={buttonStyle}
                onClick={handleLogout}
                disabled={busy}
              >
                {busy ? 'Signing out...' : 'Sign out'}
              </button>
            </>
          )}

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 18,
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
                  {unmetRules.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {message && (
            <p
              role="status"
              style={{
                marginTop: 18,
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