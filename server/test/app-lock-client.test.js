import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEARTBEAT_MS,
  IDLE_LOCK_MS,
  base64urlToBytes,
  bytesToBase64url,
  decodeAuthenticationOptions,
  decodeRegistrationOptions,
  encodeAssertionCredential,
  encodeRegistrationCredential,
  isCompletePin,
  msUntilLock,
  sanitizePinInput,
  shouldLockAfterBackground,
} from '../../client/src/appLockPolicy.js';
import { APP_LOCK_IDLE_MS } from '../src/services/appLockService.js';

/**
 * US-05 (#17), REQ-11: the browser-side rules. The client has no test runner of
 * its own, so its pure logic lives in client/src/appLockPolicy.js and is
 * checked here with the server's node:test suite.
 */

describe('re-lock after two minutes in the background (UT_64)', () => {
  const hiddenAt = 1_000_000;

  test('the client and server agree on two minutes', () => {
    assert.equal(IDLE_LOCK_MS, 120_000);
    assert.equal(IDLE_LOCK_MS, APP_LOCK_IDLE_MS);
  });

  test('the heartbeat is more frequent than the idle period, with room to spare', () => {
    assert.ok(HEARTBEAT_MS * 2 < IDLE_LOCK_MS);
  });

  test('a short trip to another app does not lock', () => {
    assert.equal(shouldLockAfterBackground(hiddenAt, hiddenAt), false);
    assert.equal(shouldLockAfterBackground(hiddenAt, hiddenAt + 30_000), false);
    assert.equal(shouldLockAfterBackground(hiddenAt, hiddenAt + 119_999), false);
  });

  test('two minutes or more locks', () => {
    assert.equal(shouldLockAfterBackground(hiddenAt, hiddenAt + 120_000), true);
    assert.equal(shouldLockAfterBackground(hiddenAt, hiddenAt + 3_600_000), true);
  });

  test('an app that was never hidden is not locked by the timer', () => {
    assert.equal(shouldLockAfterBackground(null, hiddenAt), false);
    assert.equal(shouldLockAfterBackground(undefined, hiddenAt), false);
  });

  test('works out how long is left to wait', () => {
    assert.equal(msUntilLock(hiddenAt, hiddenAt), 120_000);
    assert.equal(msUntilLock(hiddenAt, hiddenAt + 100_000), 20_000);
    assert.equal(msUntilLock(hiddenAt, hiddenAt + 500_000), 0);
  });
});

describe('PIN entry', () => {
  test('keeps only up to four digits', () => {
    assert.equal(sanitizePinInput('48a26x9'), '4826');
    assert.equal(sanitizePinInput('  4 8 2 6 '), '4826');
    assert.equal(sanitizePinInput('123456'), '1234');
    assert.equal(sanitizePinInput(null), '');
    assert.equal(sanitizePinInput(undefined), '');
  });

  test('knows when a PIN is complete', () => {
    assert.equal(isCompletePin('4826'), true);
    assert.equal(isCompletePin('482'), false);
    assert.equal(isCompletePin(4826), false);
  });
});

describe('WebAuthn <-> JSON', () => {
  test('base64url round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = bytesToBase64url(bytes);

    assert.match(text, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual([...base64urlToBytes(text)], [...bytes]);
  });

  test('matches the server\'s encoding', () => {
    assert.equal(bytesToBase64url(Buffer.from([1, 2, 3])), Buffer.from([1, 2, 3]).toString('base64url'));
    assert.deepEqual([...base64urlToBytes('AQID')], [1, 2, 3]);
  });

  test('decodes registration options into what create() needs', () => {
    const decoded = decodeRegistrationOptions({
      challenge: 'AQID',
      rp: { id: 'localhost', name: 'PFEM' },
      user: { id: 'BAUG', name: 'a@example.test', displayName: 'A' },
      excludeCredentials: [{ type: 'public-key', id: 'BwgJ', transports: ['internal'] }],
      authenticatorSelection: { userVerification: 'required' },
    });

    assert.deepEqual([...decoded.challenge], [1, 2, 3]);
    assert.deepEqual([...decoded.user.id], [4, 5, 6]);
    assert.deepEqual([...decoded.excludeCredentials[0].id], [7, 8, 9]);
    assert.equal(decoded.authenticatorSelection.userVerification, 'required');
  });

  test('decodes authentication options into what get() needs', () => {
    const decoded = decodeAuthenticationOptions({
      challenge: 'AQID',
      rpId: 'localhost',
      allowCredentials: [{ type: 'public-key', id: 'BAUG' }],
      userVerification: 'required',
    });

    assert.deepEqual([...decoded.challenge], [1, 2, 3]);
    assert.deepEqual([...decoded.allowCredentials[0].id], [4, 5, 6]);
    assert.equal(decoded.userVerification, 'required');
  });

  test('encodes the credentials the server expects', () => {
    const buffer = (...bytes) => Uint8Array.from(bytes).buffer;

    assert.deepEqual(
      encodeRegistrationCredential({
        id: 'abc',
        type: 'public-key',
        response: {
          clientDataJSON: buffer(1),
          attestationObject: buffer(2, 3),
          getTransports: () => ['internal'],
        },
      }),
      {
        id: 'abc',
        type: 'public-key',
        response: { clientDataJSON: 'AQ', attestationObject: 'AgM', transports: ['internal'] },
      }
    );

    assert.deepEqual(
      encodeAssertionCredential({
        id: 'abc',
        type: 'public-key',
        response: { clientDataJSON: buffer(1), authenticatorData: buffer(2), signature: buffer(3) },
      }),
      {
        id: 'abc',
        type: 'public-key',
        response: { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw' },
      }
    );
  });

  test('a credential without getTransports still encodes', () => {
    const out = encodeRegistrationCredential({
      id: 'abc',
      type: 'public-key',
      response: { clientDataJSON: new ArrayBuffer(1), attestationObject: new ArrayBuffer(1) },
    });

    assert.deepEqual(out.response.transports, []);
  });
});
