/**
 * Inactivity policy - US-28 (#67), SRS SEC-8. Pure functions, so they are unit
 * tested without a browser (client/test/session-policy.test.js).
 *
 * The browser ends a session after 30 minutes without a person using the app.
 * The server enforces the same limit on its own (it revokes an idle session), so
 * this timer is a courtesy that signs the person out promptly, not the control.
 */
export const IDLE_LIMIT_MS = 30 * 60 * 1000;
export const KEEP_ALIVE_EVERY_MS = 5 * 60 * 1000;
export const CHECK_EVERY_MS = 15 * 1000;

/** Server answers that mean "this session is over" (with their `code`). */
export const SESSION_ENDED_CODES = ['SESSION_IDLE', 'TOKEN_EXPIRED', 'SESSION_REVOKED', 'TOKEN_INVALID', 'ACCOUNT_SUSPENDED'];

export function isIdle(lastActivityMs, nowMs, limitMs = IDLE_LIMIT_MS) {
  return nowMs - lastActivityMs >= limitMs;
}

/** Ping the server only when a person was active since the last ping. */
export function shouldKeepAlive(lastActivityMs, lastPingMs, nowMs, everyMs = KEEP_ALIVE_EVERY_MS) {
  return lastActivityMs > lastPingMs && nowMs - lastPingMs >= everyMs;
}

export function endedMessage(code) {
  if (code === 'SESSION_IDLE') return 'You were signed out after 30 minutes of inactivity.';
  if (code === 'ACCOUNT_SUSPENDED') return 'This account has been suspended. Contact support.';
  return 'Your session has ended. Please sign in again.';
}
