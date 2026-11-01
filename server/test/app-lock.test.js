import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {
  APP_LOCK_IDLE_MS,
  LockError,
  MAX_BIOMETRIC_DEVICES,
  MAX_PIN_ATTEMPTS,
  hashPin,
  isValidPin,
  pinMatchesHash,
  sessionIsUnlocked,
  unlockDeadline,
} from '../src/services/appLockService.js';

/**
 * US-05 (#17), REQ-11: the PIN and the lock policy, with no database.
 * Test data PIN 4826 is the one in Test Plan case UT_64.
 */

const SECRET = 'a'.repeat(40);
let saved;

before(() => {
  saved = { app: process.env.APP_LOCK_SECRET, jwt: process.env.JWT_SECRET };
  process.env.APP_LOCK_SECRET = SECRET;
});

after(() => {
  for (const [key, value] of [['APP_LOCK_SECRET', saved.app], ['JWT_SECRET', saved.jwt]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('PIN format (REQ-11: four digits)', () => {
  test('accepts exactly four ASCII digits', () => {
    for (const pin of ['4826', '0000', '9999', '0123']) assert.equal(isValidPin(pin), true, pin);
  });

  test('rejects anything else', () => {
    const bad = [
      '', '1', '482', '48261', '48 26', ' 4826', '4826 ', '4826\n', 'abcd', '48a6', '48-6', '4.26',
      '٤٨٢٦', // Arabic-Indic digits
      '４８２６', // full-width digits
      4826, // a JSON number would lose a leading zero
      null, undefined, true, ['4826'], { pin: '4826' },
    ];

    for (const pin of bad) assert.equal(isValidPin(pin), false, JSON.stringify(pin));
  });
});

describe('PIN storage (REQ-6 style hashing; never plaintext)', () => {
  test('stores a bcrypt hash with work factor 12, not the PIN', async () => {
    const hash = await hashPin('64b7f0f2a1b2c3d4e5f60718', '4826');

    assert.match(hash, /^\$2[aby]\$12\$/);
    assert.equal(hash.includes('4826'), false);
    assert.equal(hash.length, 60);
  });

  test('verifies the right PIN and refuses a wrong one', async () => {
    const id = '64b7f0f2a1b2c3d4e5f60718';
    const hash = await hashPin(id, '4826');

    assert.equal(await pinMatchesHash(id, '4826', hash), true);
    assert.equal(await pinMatchesHash(id, '4827', hash), false);
    assert.equal(await pinMatchesHash(id, '0000', hash), false);
  });

  test('is salted: the same PIN hashes differently each time', async () => {
    const id = '64b7f0f2a1b2c3d4e5f60718';
    const [a, b] = await Promise.all([hashPin(id, '4826'), hashPin(id, '4826')]);

    assert.notEqual(a, b);
  });

  test('is bound to the user: another user\'s hash does not verify the same PIN', async () => {
    const hash = await hashPin('64b7f0f2a1b2c3d4e5f60718', '4826');

    assert.equal(await pinMatchesHash('64b7f0f2a1b2c3d4e5f60719', '4826', hash), false);
  });

  test('is keyed with a server secret: a database copy cannot be searched for the PIN', async () => {
    const id = '64b7f0f2a1b2c3d4e5f60718';
    const hash = await hashPin(id, '4826');

    // An attacker holding only the database tries bcrypt on the bare PIN.
    assert.equal(await bcrypt.compare('4826', hash), false);
    assert.equal(await bcrypt.compare(`${id}:4826`, hash), false);

    // The same PIN under a different server secret does not match either.
    process.env.APP_LOCK_SECRET = 'b'.repeat(40);
    assert.equal(await pinMatchesHash(id, '4826', hash), false);
    process.env.APP_LOCK_SECRET = SECRET;
    assert.equal(await pinMatchesHash(id, '4826', hash), true);
  });

  test('falls back to JWT_SECRET, and refuses to run with no usable secret', async () => {
    delete process.env.APP_LOCK_SECRET;
    process.env.JWT_SECRET = 'j'.repeat(40);
    const hash = await hashPin('64b7f0f2a1b2c3d4e5f60718', '4826');
    assert.equal(await pinMatchesHash('64b7f0f2a1b2c3d4e5f60718', '4826', hash), true);

    process.env.JWT_SECRET = 'short';
    const originalError = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        () => hashPin('64b7f0f2a1b2c3d4e5f60718', '4826'),
        (error) => error instanceof LockError && error.status === 503
      );
    } finally {
      console.error = originalError;
      process.env.APP_LOCK_SECRET = SECRET;
    }
  });
});

describe('lock policy (REQ-11: re-lock after two minutes; SEC-8)', () => {
  const now = Date.UTC(2026, 10, 2, 9, 0, 0);

  test('the idle period is two minutes and PIN attempts are capped at five', () => {
    assert.equal(APP_LOCK_IDLE_MS, 120_000);
    assert.equal(MAX_PIN_ATTEMPTS, 5);
    assert.equal(MAX_BIOMETRIC_DEVICES, 5);
  });

  test('a user without the lock is never locked', () => {
    assert.equal(sessionIsUnlocked(false, null, now), true);
    assert.equal(sessionIsUnlocked(false, new Date(now - 1), now), true);
  });

  test('with the lock on, a session with no unlock time is locked', () => {
    assert.equal(sessionIsUnlocked(true, null, now), false);
    assert.equal(sessionIsUnlocked(true, undefined, now), false);
  });

  test('is unlocked up to, and locked from, the deadline', () => {
    assert.equal(sessionIsUnlocked(true, new Date(now + 1), now), true);
    assert.equal(sessionIsUnlocked(true, new Date(now), now), false);
    assert.equal(sessionIsUnlocked(true, new Date(now - 1), now), false);
  });

  test('a session unlocked now is locked again after two minutes of silence', () => {
    const until = unlockDeadline(now);

    assert.equal(until.getTime() - now, 120_000);
    assert.equal(sessionIsUnlocked(true, until, now + 119_999), true);
    assert.equal(sessionIsUnlocked(true, until, now + 120_000), false);
  });

  test('a heartbeat every 30 seconds keeps it unlocked indefinitely', () => {
    let until = unlockDeadline(now);

    for (let t = now + 30_000; t <= now + 3_600_000; t += 30_000) {
      assert.equal(sessionIsUnlocked(true, until, t), true);
      until = unlockDeadline(t);
    }
  });
});
