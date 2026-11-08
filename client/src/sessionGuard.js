import { API_URL } from './pageKit.js';
import { clearSession, getToken, isSignedIn } from './auth.js';
import {
  CHECK_EVERY_MS, SESSION_ENDED_CODES, endedMessage, isIdle, shouldKeepAlive,
} from './sessionPolicy.js';

/**
 * Session timeout and session-ended handling - US-28 (#67), SEC-8.
 *
 *  - 30 minutes without a pointer, key, scroll or touch event signs the person
 *    out (all tabs share one activity clock through localStorage).
 *  - While a person IS active, a small request every few minutes tells the
 *    server so, because the server enforces the same 30-minute limit itself and
 *    would otherwise end a session during, say, a long form with no API calls.
 *  - Any API answer that says the session is over (idle, expired, revoked,
 *    suspended) signs the person out at once and explains why.
 *
 * The two-minute background app lock (US-05) is separate and untouched.
 */
const ACTIVITY_KEY = 'pfem_last_activity';
const NOTICE_KEY = 'pfem_notice';
let installed = false;

function readActivity() {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || Date.now();
  } catch {
    return Date.now();
  }
}

function writeActivity(now) {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now));
  } catch {
    // Private window: the in-memory copy below still works for this tab.
  }
}

/** A message left for the sign-in screen, shown once. */
export function takeNotice() {
  try {
    const text = sessionStorage.getItem(NOTICE_KEY) || '';
    sessionStorage.removeItem(NOTICE_KEY);
    return text;
  } catch {
    return '';
  }
}

export function endSession(code) {
  const hadSession = isSignedIn();
  const token = getToken();
  clearSession();
  if (!hadSession) return;

  try {
    sessionStorage.setItem(NOTICE_KEY, endedMessage(code));
  } catch {
    // Not fatal: the person is still signed out.
  }
  // Best effort: tell the server too. It may already have ended the session.
  if (token) {
    fetch(`${API_URL}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  window.location.assign(`${window.location.pathname}`);
}

export function installSessionGuard() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  let last = readActivity();
  let lastPing = Date.now();
  let lastWrite = 0;

  const markActive = () => {
    const now = Date.now();
    last = now;
    if (now - lastWrite > 1000) {
      lastWrite = now;
      writeActivity(now);
    }
  };
  for (const name of ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel']) {
    window.addEventListener(name, markActive, { passive: true, capture: true });
  }
  window.addEventListener('storage', (event) => {
    if (event.key === ACTIVITY_KEY && event.newValue) last = Math.max(last, Number(event.newValue));
  });

  setInterval(() => {
    if (!isSignedIn()) return;
    const now = Date.now();
    last = Math.max(last, readActivity());

    if (isIdle(last, now)) {
      endSession('SESSION_IDLE');
      return;
    }
    if (shouldKeepAlive(last, lastPing, now)) {
      lastPing = now;
      fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${getToken()}` } }).catch(() => {});
    }
  }, CHECK_EVERY_MS);

  // Watch every API answer for "your session is over".
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = String(args[0]?.url ?? args[0] ?? '');

    if ((response.status === 401 || response.status === 403) && url.startsWith(API_URL) && isSignedIn() && !/\/api\/auth\/(login|logout)/.test(url)) {
      try {
        const body = await response.clone().json();
        if (SESSION_ENDED_CODES.includes(body?.code)) endSession(body.code);
      } catch {
        // Not JSON: leave it to the caller.
      }
    }
    return response;
  };
}
