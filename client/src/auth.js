/**
 * Session handling for the client - US-25 (#61), SRS 5.10: REQ-93.
 *
 * Sign-in stores the token here; every page sends it on every request. The
 * server then decides who the caller is from the session, never from an id the
 * client supplies.
 *
 * The X-User-Id fallback is the Sprint 1 interim: the feature screens were
 * built before sign-in existed, so they identified the user with a pasted id.
 * It only works when the server is running with DEV_AUTH_HEADER=true, and it
 * is used only when there is no token. It disappears with the demo-user boxes.
 */

const TOKEN_KEY = 'pfem_token';
const USER_KEY = 'pfem_user';
const DEV_USER_KEY = 'pfem_dev_user_id';

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
}

export function clearSession() {
  write(TOKEN_KEY, '');
  write(USER_KEY, '');
}

export function isSignedIn() {
  return Boolean(getToken());
}

/**
 * Headers that identify the caller.
 *
 * Prefers the session token. Falls back to the development header only when
 * there is no token, so a signed-in user is never identified by a pasted id.
 */
export function authHeaders(devUserId) {
  const token = getToken();
  if (token) return { Authorization: `Bearer ${token}` };

  const fallback = (devUserId ?? read(DEV_USER_KEY)).trim();
  return fallback ? { 'X-User-Id': fallback } : {};
}
