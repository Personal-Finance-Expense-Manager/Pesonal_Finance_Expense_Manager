/**
 * Session handling for the client - US-25 (#61), SRS 5.10: REQ-93.
 *
 * Sign-in stores the token here; every page sends it on every request as
 * `Authorization: Bearer <token>`. The server then decides who the caller is
 * from the session, never from an id the client supplies.
 *
 * (US-28: the early Sprint 1 interim, where feature pages identified the user by
 * a pasted id, has been removed from the client. The server's own development-only
 * switch, DEV_AUTH_HEADER, is a separate mechanism, off by default, and is never
 * used by the web client.)
 */

const TOKEN_KEY = 'pfem_token';
const USER_KEY = 'pfem_user';

/** Fired when the signed-in session starts or ends (US-05: the app lock follows it). */
export const SESSION_CHANGED_EVENT = 'pfem:session-changed';

function announceSessionChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

function read(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    // Storage can be unavailable in a private window.
    return '';
  }
}

function write(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Not fatal: the value simply does not survive a reload.
  }
}

export function getToken() {
  return read(TOKEN_KEY);
}

export function getUser() {
  const raw = read(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  write(TOKEN_KEY, token || '');
  write(USER_KEY, user ? JSON.stringify(user) : '');
  announceSessionChange();
}

export function clearSession() {
  write(TOKEN_KEY, '');
  write(USER_KEY, '');
  announceSessionChange();
}

export function isSignedIn() {
  return Boolean(getToken());
}

/**
 * Headers that identify the caller: the session token, nothing else. With no
 * session there are no credentials, and the server answers 401.
 */
export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
