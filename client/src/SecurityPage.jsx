import { useCallback, useEffect, useState } from 'react';
import { clearSession, isSignedIn } from './auth.js';
import {
  APP_LOCKED_EVENT,
  LockApiError,
  biometricSupported,
  describeBiometricError,
  enrolBiometric,
  lockApi,
  rememberLockEnabled,
} from './appLock.js';
import { PIN_LENGTH, isCompletePin, sanitizePinInput } from './appLockPolicy.js';
import {
  buttonStyle,
  cardStyle,
  colors,
  errorStyle,
  inputStyle,
  labelStyle,
  noticeStyle,
  pageStyle,
} from './appLockStyles.js';

/**
 * App lock settings - US-05 (#17), SRS 5.1, REQ-11, HI-2.
 *
 * Open it at http://localhost:5173/#/security
 *
 * Turn the lock on with a four-digit PIN, change or turn it off, lock the app
 * now, and add the device's fingerprint / face as a quicker way to unlock.
 * The PIN is always the fallback: biometric is added on top of it.
 */

function PinField({ label, value, onChange }) {
  return (
    <label style={labelStyle}>
      {label}
      <input
        style={inputStyle}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={PIN_LENGTH}
        value={value}
        onChange={(event) => onChange(sanitizePinInput(event.target.value))}
        required
      />
    </label>
  );
}

export default function SecurityPage() {
  const [status, setStatus] = useState(null);
  const [canBiometric, setCanBiometric] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [bioPin, setBioPin] = useState('');
  const [offPin, setOffPin] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await lockApi.status();
      rememberLockEnabled(next.enabled);
      setStatus(next);
    } catch (requestError) {
      if (requestError.status !== 423) setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    if (!isSignedIn()) return;

    load();
    biometricSupported().then(setCanBiometric);
  }, [load]);

  function clearForms() {
    setPin('');
    setConfirmPin('');
    setCurrentPin('');
    setNewPin('');
    setConfirmNewPin('');
    setBioPin('');
    setOffPin('');
  }

  /** Run an action, showing its result or its error. */
  async function run(action, done, describe = (e) => e.message) {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result = await action();

      clearForms();
      setMessage(done);
      if (result && typeof result.enabled === 'boolean') setStatus(result);
      else await load();
    } catch (requestError) {
      clearForms();

      if (requestError instanceof LockApiError && requestError.data.signedOut) {
        // Too many wrong PINs: the server ended every session.
        clearSession();
        rememberLockEnabled(false);
        window.location.hash = '#/';
        return;
      }

      const left = requestError.data?.attemptsRemaining;
      const text = describe(requestError);

      setError(left !== undefined ? `${text} ${left} ${left === 1 ? 'try' : 'tries'} left before you are signed out.` : text);
    } finally {
      setBusy(false);
    }
  }

  function needPin(value, text = 'Enter your four-digit PIN.') {
    if (isCompletePin(value)) return true;

    setError(text);
    setMessage('');
    return false;
  }

  function turnOn(event) {
    event.preventDefault();

    if (!needPin(pin, 'Choose a four-digit PIN (digits only).')) return;
    if (pin !== confirmPin) return setError('The two PINs do not match.');

    run(() => lockApi.enable(pin, confirmPin), 'App lock is on. It locks after two minutes in the background.');
  }

  function change(event) {
    event.preventDefault();

    if (!needPin(currentPin, 'Enter your current four-digit PIN.')) return;
    if (!needPin(newPin, 'Choose a new four-digit PIN (digits only).')) return;
    if (newPin !== confirmNewPin) return setError('The two new PINs do not match.');

    run(() => lockApi.changePin(currentPin, newPin), 'Your PIN was changed.');
  }

  function turnOff(event) {
    event.preventDefault();

    if (!needPin(offPin)) return;

    run(() => lockApi.disable(offPin), 'App lock is off.');
  }

  function addBiometric(event) {
    event.preventDefault();

    if (!needPin(bioPin)) return;

    run(() => enrolBiometric(bioPin), 'Fingerprint / face unlock is on for this device.', describeBiometricError);
  }

  function lockNow() {
    run(async () => {
      await lockApi.lock();
      // The gate hears this and shows the lock screen.
      window.dispatchEvent(new Event(APP_LOCKED_EVENT));
    }, '');
  }

  if (!isSignedIn()) {
    return (
      <main style={pageStyle}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <h1 style={{ marginTop: 0 }}>App lock</h1>
          <p style={{ color: colors.muted }}>
            Sign in first. <a href="#/" style={{ color: colors.greenSoft }}>Go to sign in</a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <header style={{ marginBottom: 22 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>App lock</h1>
          <p style={{ margin: '6px 0 0', color: colors.muted }}>
            Keep your finances private if someone else picks up your phone. US-05 &middot; SRS REQ-11
          </p>
          <nav style={{ marginTop: 12, display: 'flex', gap: 14, fontSize: 14 }}>
            <a href="#/" style={{ color: colors.greenSoft }}>Home</a>
            <a href="#/dashboard" style={{ color: colors.greenSoft }}>Dashboard</a>
          </nav>
        </header>

        {error && <div role="alert" style={{ ...errorStyle, marginTop: 0, marginBottom: 18 }}>{error}</div>}
        {message && <p role="status" style={{ ...noticeStyle, marginTop: 0, marginBottom: 18 }}>{message}</p>}

        {!status && !error && <p role="status" style={{ color: colors.muted }}>Loading…</p>}

        {status && !status.enabled && (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Turn on app lock</h2>
            <p style={{ color: colors.muted, lineHeight: 1.6 }}>
              Choose a four-digit PIN. The app then asks for it after it has been in the background for two minutes.
              The lock is optional and you can turn it off at any time.
            </p>
            <form onSubmit={turnOn}>
              <PinField label="New PIN" value={pin} onChange={setPin} />
              <PinField label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} />
              <button style={buttonStyle(busy)} disabled={busy}>{busy ? 'Turning on…' : 'Turn on app lock'}</button>
            </form>
          </section>
        )}

        {status && status.enabled && (
          <>
            <section style={cardStyle}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>
                App lock is <span style={{ color: colors.greenSoft }}>on</span>
              </h2>
              <p style={{ color: colors.muted, lineHeight: 1.6 }}>
                The app locks after {Math.round(status.idleLockSeconds / 60)} minutes in the background, and asks for
                your PIN{status.biometricDevices > 0 ? ' or your fingerprint / face' : ''} to open again.
              </p>
              <button type="button" style={buttonStyle(busy, 'secondary')} onClick={lockNow} disabled={busy}>
                Lock now
              </button>
            </section>

            <section style={cardStyle}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Fingerprint or face</h2>

              {!canBiometric && (
                <p style={{ color: colors.muted, lineHeight: 1.6, marginBottom: 0 }}>
                  This browser cannot use the device sensor here. It needs a device with a fingerprint, face or
                  screen-lock set up, and the app opened over HTTPS (or on localhost). Your PIN always works.
                </p>
              )}

              {canBiometric && (
                <>
                  <p style={{ color: colors.muted, lineHeight: 1.6 }}>
                    {status.biometricDevices > 0
                      ? `Turned on for ${status.biometricDevices} device${status.biometricDevices === 1 ? '' : 's'}.`
                      : 'Unlock with your device instead of typing the PIN. Your PIN stays as the backup.'}{' '}
                    The check happens on your device; this app never receives your fingerprint or face.
                  </p>
                  <form onSubmit={addBiometric}>
                    <PinField label="Your PIN, to confirm" value={bioPin} onChange={setBioPin} />
                    <button style={buttonStyle(busy)} disabled={busy}>
                      {status.biometricDevices > 0 ? 'Add this device' : 'Turn on fingerprint / face'}
                    </button>
                  </form>
                </>
              )}

              {status.biometricDevices > 0 && (
                <button
                  type="button"
                  style={buttonStyle(busy, 'ghost')}
                  disabled={busy}
                  onClick={() => run(() => lockApi.removeBiometric(), 'Fingerprint / face unlock is off.')}
                >
                  Turn off fingerprint / face on all devices
                </button>
              )}
            </section>

            <section style={cardStyle}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Change PIN</h2>
              <form onSubmit={change}>
                <PinField label="Current PIN" value={currentPin} onChange={setCurrentPin} />
                <PinField label="New PIN" value={newPin} onChange={setNewPin} />
                <PinField label="Confirm new PIN" value={confirmNewPin} onChange={setConfirmNewPin} />
                <button style={buttonStyle(busy)} disabled={busy}>Change PIN</button>
              </form>
              <p style={{ color: colors.muted, fontSize: 13, marginBottom: 0 }}>
                Forgotten it? Lock the app and choose “Forgot PIN?” on the lock screen.
              </p>
            </section>

            <section style={cardStyle}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Turn off app lock</h2>
              <form onSubmit={turnOff}>
                <PinField label="Your PIN" value={offPin} onChange={setOffPin} />
                <button style={buttonStyle(busy, 'danger')} disabled={busy}>Turn off app lock</button>
              </form>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
