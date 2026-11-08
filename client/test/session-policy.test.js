import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_EVERY_MS, IDLE_LIMIT_MS, KEEP_ALIVE_EVERY_MS, SESSION_ENDED_CODES, endedMessage, isIdle, shouldKeepAlive,
} from '../src/sessionPolicy.js';

// US-28 (#67) SEC-8: 30-minute inactivity timeout on the web client.

test('SEC-8 the limit is exactly 30 minutes', () => {
  assert.equal(IDLE_LIMIT_MS, 30 * 60 * 1000);
});

test('SEC-8 a person is idle at 30 minutes and not a second before', () => {
  const t0 = 1_000_000;
  assert.equal(isIdle(t0, t0 + IDLE_LIMIT_MS - 1), false);
  assert.equal(isIdle(t0, t0 + IDLE_LIMIT_MS), true);
  assert.equal(isIdle(t0, t0 + 31 * 60 * 1000), true);
  assert.equal(isIdle(t0, t0), false);
});

test('SEC-8 the check runs often enough that sign-out is within a minute of the limit', () => {
  assert.ok(CHECK_EVERY_MS <= 60 * 1000);
});

test('SEC-8 the keep-alive fires only after real activity, and not more often than every few minutes', () => {
  const t0 = 10_000_000;
  // Nobody has touched the page since the last ping: no ping, however long it has been.
  assert.equal(shouldKeepAlive(t0, t0, t0 + 20 * 60 * 1000), false);
  // Active, but pinged a moment ago: wait.
  assert.equal(shouldKeepAlive(t0 + 1000, t0, t0 + 2000), false);
  // Active since, and the interval has passed: ping.
  assert.equal(shouldKeepAlive(t0 + 1000, t0, t0 + KEEP_ALIVE_EVERY_MS), true);
});

test('SEC-8 the keep-alive interval is well inside the 30-minute limit', () => {
  assert.ok(KEEP_ALIVE_EVERY_MS * 3 < IDLE_LIMIT_MS);
});

test('SEC-8 every server answer that ends a session is recognised, and the person is told why', () => {
  for (const code of ['SESSION_IDLE', 'TOKEN_EXPIRED', 'SESSION_REVOKED', 'TOKEN_INVALID', 'ACCOUNT_SUSPENDED']) {
    assert.ok(SESSION_ENDED_CODES.includes(code), code);
  }
  assert.ok(!SESSION_ENDED_CODES.includes('APP_LOCKED'), 'the app lock is a different mechanism and must not sign anyone out');
  assert.match(endedMessage('SESSION_IDLE'), /30 minutes/);
  assert.match(endedMessage('ACCOUNT_SUSPENDED'), /suspended/);
  assert.match(endedMessage('TOKEN_EXPIRED'), /sign in again/i);
});
