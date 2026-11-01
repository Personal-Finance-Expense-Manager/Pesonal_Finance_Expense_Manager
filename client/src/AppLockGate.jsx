import { useCallback, useEffect, useRef, useState } from 'react';
import { SESSION_CHANGED_EVENT, getToken } from './auth.js';
import {
  APP_LOCKED_EVENT,
  LOCK_CHANGED_EVENT,
  LockApiError,
  installLockWatcher,
  lockApi,
  lockWasEnabled,
  rememberLockEnabled,
} from './appLock.js';
import { HEARTBEAT_MS, IDLE_LOCK_MS, shouldLockAfterBackground } from './appLockPolicy.js';
import LockScreen from './LockScreen.jsx';
import { buttonStyle, colors, pageStyle } from './appLockStyles.js';

/**
 * Keeps the app behind the lock - US-05 (#17), SRS REQ-11 and SEC-8.
 *
 * The SERVER decides whether the session is locked (see
 * server/src/services/appLockService.js). This component asks, shows the lock
 * screen when the answer is "locked", and keeps the server told that the app
 * is still on screen:
 *
 *   - while the page is visible and unlocked it sends a heartbeat every 30 s;
 *   - when the page is hidden (tab switched away, phone locked, browser
 *     minimised) it stops, and locks the screen after two minutes - or at the
 *     moment the user comes back, if two minutes have passed by then;
 *   - the server independently refuses a session that has been silent for two
 *     minutes, so closing the tab or a crashed browser cannot leave it open.
 *
 * While locked the pages are NOT mounted, so nothing financial is left in the
 * page. Without a session, or with the lock off, children render as before.
 */

const PHASE = {
  OFF: 'off', // no session, or the lock is not turned on
  CHECKING: 'checking',
  UNLOCKED: 'unlocked',
  LOCKED: 'locked',
  OFFLINE: 'offline', // the server could not be reached and the lock was on
};

export default function AppLockGate({ children }) {
  const [token, setToken] = useState(getToken);
  const [storedPhase, setPhase] = useState(() => (getToken() ? PHASE.CHECKING : PHASE.OFF));
  // Without a session there is nothing to lock, whatever the last state was.
  const phase = token ? storedPhase : PHASE.OFF;
  const [notice, setNotice] = useState('');
  const hiddenAt = useRef(null);
  const hiddenTimer = useRef(null);

  useEffect(() => {
    installLockWatcher();
  }, []);

  // Follow sign-in and sign-out, also in other tabs.
  useEffect(() => {
    const sync = () => setToken(getToken());

    window.addEventListener(SESSION_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);

    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  /** Ask the server where things stand. The heartbeat also keeps an open session open. */
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setPhase(PHASE.OFF);
      return;
    }

    try {
      const status = await lockApi.heartbeat();

      rememberLockEnabled(status.enabled);
      setPhase(!status.enabled ? PHASE.OFF : status.locked ? PHASE.LOCKED : PHASE.UNLOCKED);
    } catch (error) {
      if (error instanceof LockApiError && error.status === 401) {
        // An expired or revoked session: the pages and the sign-in screen deal with it.
        setPhase(PHASE.OFF);
        return;
      }

      // The server cannot be reached. A user who has the lock on must not be
      // let in just because the network is down.
      setPhase((current) => {
        if (current === PHASE.UNLOCKED || current === PHASE.LOCKED) return current;
        return lockWasEnabled() ? PHASE.OFFLINE : PHASE.OFF;
      });
    }
  }, []);

  useEffect(() => {
    if (token) refresh();
  }, [token, refresh]);

  // The lock was turned on, off or changed from the settings page.
  useEffect(() => {
    window.addEventListener(LOCK_CHANGED_EVENT, refresh);

    return () => window.removeEventListener(LOCK_CHANGED_EVENT, refresh);
  }, [refresh]);

  const lockNow = useCallback(() => {
    setPhase((current) => (current === PHASE.UNLOCKED ? PHASE.LOCKED : current));
    lockApi.lock().catch(() => {});
  }, []);

  // Any request, from any page, that the server refuses as "locked".
  useEffect(() => {
    const onLocked = () => setPhase((current) => (current === PHASE.UNLOCKED ? PHASE.LOCKED : current));

    window.addEventListener(APP_LOCKED_EVENT, onLocked);

    return () => window.removeEventListener(APP_LOCKED_EVENT, onLocked);
  }, []);

  // Heartbeat while the app is open and on screen.
  useEffect(() => {
    if (phase !== PHASE.UNLOCKED) return undefined;

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, HEARTBEAT_MS);

    return () => window.clearInterval(timer);
  }, [phase, refresh]);

  // Background -> lock after two minutes (REQ-11).
  useEffect(() => {
    if (phase !== PHASE.UNLOCKED) return undefined;

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        window.clearTimeout(hiddenTimer.current);
        hiddenTimer.current = window.setTimeout(lockNow, IDLE_LOCK_MS);
        return;
      }

      window.clearTimeout(hiddenTimer.current);

      // Timers are throttled in the background, so judge by the clock.
      if (shouldLockAfterBackground(hiddenAt.current, Date.now())) lockNow();
      else refresh();

      hiddenAt.current = null;
    }

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(hiddenTimer.current);
    };
  }, [phase, lockNow, refresh]);

  function handleSignedOut(message) {
    setNotice(message || '');
    setToken(null);
    setPhase(PHASE.OFF);
    window.location.hash = '#/';
  }

  if (phase === PHASE.CHECKING) {
    return (
      <p role="status" style={{ padding: 24, color: '#94a3b8', fontFamily: 'system-ui' }}>
        Checking the app lock…
      </p>
    );
  }

  if (phase === PHASE.LOCKED) {
    return <LockScreen onUnlocked={() => setPhase(PHASE.UNLOCKED)} onSignedOut={handleSignedOut} />;
  }

  if (phase === PHASE.OFFLINE) {
    return (
      <main style={pageStyle}>
        <div style={{ maxWidth: 400, margin: '0 auto', paddingTop: 60, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24 }}>PFEM is locked</h1>
          <p style={{ color: colors.muted }}>The server cannot be reached, so the lock cannot be checked.</p>
          <button type="button" style={buttonStyle(false)} onClick={refresh}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      {notice && !token && (
        <p
          role="status"
          style={{ margin: 0, padding: 12, background: '#123524', color: '#bbf7d0', textAlign: 'center', fontSize: 14 }}
        >
          {notice}
        </p>
      )}
      {children}
    </>
  );
}
