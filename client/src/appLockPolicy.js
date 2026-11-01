/**
 * The rules of the app lock that need no browser to run - US-05 (#17), REQ-11.
 *
 * Kept free of React, the DOM and Vite so the server's `node --test` suite can
 * import and check it (server/test/app-lock-client.test.js): the client has no
 * test runner of its own.
 */

/** REQ-11: re-lock after two minutes in the background. */
export const IDLE_LOCK_MS = 2 * 60 * 1000;

/** How often the visible app tells the server it is still in use. */
export const HEARTBEAT_MS = 30 * 1000;

export const PIN_LENGTH = 4;

/** Keep only digits, at most four - for a PIN box that must never show letters. */
export function sanitizePinInput(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, PIN_LENGTH);
}

export function isCompletePin(value) {
  return typeof value === 'string' && /^\d{4}$/.test(value);
}

/** True once the app has been out of sight for the whole idle period. */
export function shouldLockAfterBackground(hiddenAt, now) {
  return typeof hiddenAt === 'number' && now - hiddenAt >= IDLE_LOCK_MS;
}

/** Milliseconds of the idle period still left after the app was hidden. */
export function msUntilLock(hiddenAt, now) {
  return Math.max(0, IDLE_LOCK_MS - (now - hiddenAt));
}

// ---------------------------------------------------------------------------
// WebAuthn <-> JSON. The browser API wants ArrayBuffers; the server speaks
// base64url strings.
// ---------------------------------------------------------------------------

export function bytesToBase64url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(text) {
  const padded = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  return bytes;
}

/** Server registration options -> the argument of navigator.credentials.create(). */
export function decodeRegistrationOptions(options) {
  return {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    user: { ...options.user, id: base64urlToBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((item) => ({
      ...item,
      id: base64urlToBytes(item.id),
    })),
  };
}

/** Server authentication options -> the argument of navigator.credentials.get(). */
export function decodeAuthenticationOptions(options) {
  return {
    ...options,
    challenge: base64urlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials || []).map((item) => ({
      ...item,
      id: base64urlToBytes(item.id),
    })),
  };
}

/** The result of create(), as JSON for the server. */
export function encodeRegistrationCredential(credential) {
  return {
    id: credential.id,
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64url(credential.response.clientDataJSON),
      attestationObject: bytesToBase64url(credential.response.attestationObject),
      transports:
        typeof credential.response.getTransports === 'function'
          ? credential.response.getTransports()
          : [],
    },
  };
}

/** The result of get(), as JSON for the server. */
export function encodeAssertionCredential(credential) {
  return {
    id: credential.id,
    type: credential.type,
    response: {
      clientDataJSON: bytesToBase64url(credential.response.clientDataJSON),
      authenticatorData: bytesToBase64url(credential.response.authenticatorData),
      signature: bytesToBase64url(credential.response.signature),
    },
  };
}
