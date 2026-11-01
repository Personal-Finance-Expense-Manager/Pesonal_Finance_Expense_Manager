import { getToken } from './auth.js';
import {
  decodeAuthenticationOptions,
  decodeRegistrationOptions,
  encodeAssertionCredential,
  encodeRegistrationCredential,
} from './appLockPolicy.js';

/**
 * Talking to the app-lock API - US-05 (#17), SRS REQ-11, HI-2.
 *
 * Every call carries the session token. The server decides whether the app is
 * locked; this file only asks and shows. See server/src/services/appLockService.js.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const HINT_KEY = 'pfem_app_lock_on';

/** Fired when something changes the lock, so the gate re-reads its state. */
export const LOCK_CHANGED_EVENT = 'pfem:lock-changed';

/** Fired when the server answers a request with "the app is locked". */
export const APP_LOCKED_EVENT = 'pfem:app-locked';

export class LockApiError extends Error {
  constructor(status, data) {
    super(data?.message || 'The request failed.');
    this.status = status;
    this.data = data || {};
  }
}

async function request(method, path, body) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}/api/app-lock${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new LockApiError(response.status, data);

  return data;
}

function changed(result) {
  window.dispatchEvent(new Event(LOCK_CHANGED_EVENT));
  return result;
}

export const lockApi = {
  status: () => request('GET', '/status'),
  heartbeat: () => request('POST', '/heartbeat', {}),
  lock: () => request('POST', '/lock', {}),
  unlockWithPin: (pin) => request('POST', '/unlock', { method: 'pin', pin }),
  enable: (pin, confirmPin) => request('POST', '/pin', { pin, confirmPin }).then(changed),
  changePin: (currentPin, newPin) => request('POST', '/pin/change', { currentPin, newPin }).then(changed),
  resetPin: (password, newPin) => request('POST', '/pin/reset', { password, newPin }).then(changed),
  disable: (pin) => request('POST', '/disable', { pin }).then(changed),
  removeBiometric: () => request('DELETE', '/biometric').then(changed),
};

// ---------------------------------------------------------------------------
// A hint, kept in the browser, that this user has the lock on. It is used for
// one thing only: if the server cannot be reached when the app opens, a user
// who has the lock on is shown the lock screen rather than the app. It grants
// nothing - the server still refuses every request while locked.
// ---------------------------------------------------------------------------

export function rememberLockEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(HINT_KEY, '1');
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // Storage can be unavailable in a private window.
  }
}

export function lockWasEnabled() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Tell the gate when ANY request - from any page - is refused because the app
 * is locked, so the lock screen appears at once instead of an error message.
 * Installed once.
 */
export function installLockWatcher() {
  if (window.__pfemLockWatcher) return;
  window.__pfemLockWatcher = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    if (response.status === 423) {
      response
        .clone()
        .json()
        .then((data) => {
          if (data?.code === 'APP_LOCKED') window.dispatchEvent(new Event(APP_LOCKED_EVENT));
        })
        .catch(() => {});
    }

    return response;
  };
}

// ---------------------------------------------------------------------------
// Device biometric through WebAuthn (HI-2). The browser asks the device's own
// sensor; this app never sees a fingerprint or a face, only a signature.
// ---------------------------------------------------------------------------

export async function biometricSupported() {
  try {
    return (
      window.isSecureContext &&
      'PublicKeyCredential' in window &&
      (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

/** Add this device's biometric. Needs the PIN again. Resolves with the new status. */
export async function enrolBiometric(pin) {
  const { options } = await request('POST', '/biometric/register/options', { pin });

  const credential = await navigator.credentials.create({
    publicKey: decodeRegistrationOptions(options),
  });

  if (!credential) throw new Error('No biometric was created.');

  return changed(
    await request('POST', '/biometric/register/verify', {
      credential: encodeRegistrationCredential(credential),
    })
  );
}

/** Unlock with this device's biometric. Rejects if cancelled or not recognised. */
export async function unlockWithBiometric() {
  const { options } = await request('POST', '/biometric/options', {});

  const credential = await navigator.credentials.get({
    publicKey: decodeAuthenticationOptions(options),
  });

  if (!credential) throw new Error('No biometric was provided.');

  return request('POST', '/unlock', {
    method: 'biometric',
    credential: encodeAssertionCredential(credential),
  });
}

/** A short message for what went wrong with the browser's biometric prompt. */
export function describeBiometricError(error) {
  if (error instanceof LockApiError) return error.message;

  switch (error?.name) {
    case 'NotAllowedError':
      return 'The biometric check was cancelled or timed out.';
    case 'InvalidStateError':
      return 'This device is already set up for biometric unlock.';
    case 'NotSupportedError':
    case 'SecurityError':
      return 'This browser or address cannot use the device biometric. Use your PIN.';
    default:
      return 'The biometric check did not work. Use your PIN.';
  }
}
