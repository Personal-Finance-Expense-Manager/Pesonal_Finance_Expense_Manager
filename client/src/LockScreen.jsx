import { useEffect, useState } from 'react';
import { authHeaders, clearSession } from './auth.js';
import {
  LockApiError,
  biometricSupported,
  describeBiometricError,
  lockApi,
  rememberLockEnabled,
  unlockWithBiometric,
} from './appLock.js';
import { PIN_LENGTH, isCompletePin, sanitizePinInput } from './appLockPolicy.js';
import {
  buttonStyle,
  cardStyle,
  colors,
  errorStyle,
  inputStyle,
  labelStyle,
  pageStyle,
  pinInputStyle,
} from './appLockStyles.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * The screen shown instead of the app while it is locked - US-05 (#17), REQ-11.
 *
 * It only asks the server to unlock; it cannot unlock anything itself. The
 * server checks the PIN (or the device biometric) and only then opens the
 * session.
 */
export default function LockScreen({ onUnlocked, onSignedOut }) {
  const [mode, setMode] = useState('pin'); // 'pin' | 'forgot'
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Offer the biometric button only if a device is enrolled AND this
    // browser can actually use the device sensor.
    Promise.all([lockApi.status().catch(() => null), biometricSupported()]).then(([status, supported]) => {
      if (!cancelled) setBiometricReady(Boolean(status?.biometricDevices > 0 && supported));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function failed(requestError) {
    if (requestError instanceof LockApiError && requestError.data.signedOut) {
      // Too many wrong PINs: the server has ended every session.
      clearSession();
      rememberLockEnabled(false);
      onSignedOut(requestError.message);
      return;
    }

    if (requestError instanceof LockApiError && requestError.status === 401 && !requestError.data.code) {
      // The session itself is gone.
      clearSession();
      onSignedOut('Your session has ended. Sign in again.');
      return;
    }

    const left = requestError.data?.attemptsRemaining;

    setError(
      left !== undefined
        ? `${requestError.message} ${left} ${left === 1 ? 'try' : 'tries'} left before you are signed out.`
        : requestError.message
    );
  }

  async function submitPin(value) {
    if (!isCompletePin(value) || busy) return;

    setBusy(true);
    setError('');

    try {
      await lockApi.unlockWithPin(value);
      onUnlocked();
    } catch (requestError) {
      setPin('');
      failed(requestError);
    } finally {
      setBusy(false);
    }
  }

  function onPinChange(event) {
    const value = sanitizePinInput(event.target.value);

    setPin(value);
    setError('');

    if (value.length === PIN_LENGTH) submitPin(value);
  }

  async function useBiometric() {
    setBusy(true);
    setError('');

    try {
      await unlockWithBiometric();
      onUnlocked();
    } catch (requestError) {
      setError(describeBiometricError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    setError('');

    if (!isCompletePin(newPin)) return setError('Enter a new four-digit PIN.');
    if (newPin !== confirmPin) return setError('The two PINs do not match.');

    setBusy(true);

    try {
      await lockApi.resetPin(password, newPin);
      setPassword('');
      onUnlocked();
    } catch (requestError) {
      failed(requestError);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);

    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: '{}',
      });
    } catch {
      // Offline: the token is still forgotten here.
    }

    clearSession();
    rememberLockEnabled(false);
    onSignedOut('You have been signed out.');
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 400, margin: '0 auto', paddingTop: 40 }}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            aria-hidden="true"
            style={{
              width: 54,
              height: 54,
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 16px',
              borderRadius: 16,
              background: '#14532d',
              color: colors.greenSoft,
              fontSize: 26,
            }}
          >
            🔒
          </div>
          <h1 style={{ fontSize: 26, margin: '0 0 8px' }}>PFEM is locked</h1>
          <p style={{ color: colors.muted, margin: 0 }}>
            {mode === 'pin' ? 'Enter your four-digit PIN to continue.' : 'Use your account password to set a new PIN.'}
          </p>
        </header>

        <section style={cardStyle}>
          {mode === 'pin' && (
            <>
              <label style={labelStyle}>
                PIN
                <input
                  style={pinInputStyle}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={PIN_LENGTH}
                  value={pin}
                  onChange={onPinChange}
                  disabled={busy}
                  autoFocus
                  aria-label="PIN"
                />
              </label>

              {biometricReady && (
                <button type="button" style={buttonStyle(busy, 'secondary')} onClick={useBiometric} disabled={busy}>
                  Use fingerprint or face
                </button>
              )}

              <button
                type="button"
                style={buttonStyle(busy, 'ghost')}
                onClick={() => {
                  setError('');
                  setMode('forgot');
                }}
              >
                Forgot PIN?
              </button>
            </>
          )}

          {mode === 'forgot' && (
            <form onSubmit={submitReset}>
              <label style={labelStyle}>
                Account password
                <input
                  style={inputStyle}
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>

              <label style={labelStyle}>
                New PIN
                <input
                  style={inputStyle}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={PIN_LENGTH}
                  value={newPin}
                  onChange={(event) => setNewPin(sanitizePinInput(event.target.value))}
                  required
                />
              </label>

              <label style={labelStyle}>
                Confirm new PIN
                <input
                  style={inputStyle}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={PIN_LENGTH}
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(sanitizePinInput(event.target.value))}
                  required
                />
              </label>

              <button style={buttonStyle(busy)} disabled={busy}>
                {busy ? 'Checking…' : 'Reset PIN and unlock'}
              </button>

              <button
                type="button"
                style={buttonStyle(busy, 'ghost')}
                onClick={() => {
                  setError('');
                  setMode('pin');
                }}
              >
                Back to PIN
              </button>
            </form>
          )}

          {error && (
            <div role="alert" style={errorStyle}>
              {error}
            </div>
          )}

          <button type="button" style={{ ...buttonStyle(busy, 'secondary'), marginTop: 18 }} onClick={signOut} disabled={busy}>
            Sign out
          </button>
        </section>
      </div>
    </main>
  );
}
