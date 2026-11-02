import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * US-11 (#27), SRS 5.3: REQ-34 - a transaction recorded without a network is
 * held, marked pending, and sent once connectivity returns.
 *
 * The queue reads localStorage inside each call, so a plain in-memory stub
 * installed before the import is enough to exercise it under node.
 */
const store = new Map();

globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};

const {
  enqueue, flush, pending, pendingCount, failedCount, retry, clearFailed, remove,
} = await import('../src/offlineQueue.js');

beforeEach(() => store.clear());

const body = (amount) => ({ type: 'expense', amount, account_id: 'a'.repeat(24) });

/** A sender that always succeeds, recording what it was given. */
function accepting(seen = []) {
  return async (sent) => {
    seen.push(sent);
    return { ok: true, status: 201 };
  };
}

test('REQ-34 a queued transaction is kept and marked pending', () => {
  enqueue(body('100.00'));
  assert.equal(pendingCount(), 1);
  assert.equal(pending()[0].status, 'pending');
});

test('REQ-34 the queue survives being read back from storage', () => {
  enqueue(body('100.00'));
  enqueue(body('250.00'));
  assert.deepEqual(pending().map((e) => e.body.amount), ['100.00', '250.00']);
});

test('REQ-34 flushing sends every pending transaction and empties the queue', async () => {
  const seen = [];
  enqueue(body('100.00'));
  enqueue(body('250.00'));

  const result = await flush(accepting(seen));

  assert.equal(result.sent, 2);
  assert.equal(result.remaining, 0);
  assert.equal(pendingCount(), 0);
  assert.deepEqual(seen.map((s) => s.amount), ['100.00', '250.00']);
});

test('REQ-34 flushing an empty queue does nothing and sends nothing', async () => {
  let called = false;
  const result = await flush(async () => {
    called = true;
    return { ok: true, status: 201 };
  });

  assert.equal(called, false);
  assert.deepEqual(result, { sent: 0, failed: 0, remaining: 0 });
});

test('REQ-34 still being offline keeps everything queued', async () => {
  enqueue(body('100.00'));
  enqueue(body('250.00'));

  const result = await flush(async () => {
    throw new TypeError('Failed to fetch');
  });

  assert.equal(result.sent, 0);
  assert.equal(result.remaining, 2);
  assert.equal(pendingCount(), 2);
});

test('REQ-34 losing the network midway keeps the transactions not yet sent', async () => {
  enqueue(body('100.00'));
  enqueue(body('250.00'));
  enqueue(body('300.00'));

  let calls = 0;
  const result = await flush(async () => {
    calls += 1;
    if (calls === 1) return { ok: true, status: 201 };
    throw new TypeError('Failed to fetch');
  });

  assert.equal(result.sent, 1);
  assert.equal(pendingCount(), 2);
  assert.deepEqual(pending().map((e) => e.body.amount), ['250.00', '300.00']);
});

test('REQ-34 a transaction the server refuses is kept, not silently lost', async () => {
  enqueue(body('100.00'));

  const result = await flush(async () => ({
    ok: false,
    status: 400,
    message: 'Account not found or unavailable.',
  }));

  assert.equal(result.failed, 1);
  assert.equal(failedCount(), 1);
  assert.equal(pending()[0].message, 'Account not found or unavailable.');
});

test('REQ-34 a refused transaction is not retried on the next flush', async () => {
  enqueue(body('100.00'));
  await flush(async () => ({ ok: false, status: 400, message: 'no' }));

  let calls = 0;
  await flush(async () => {
    calls += 1;
    return { ok: true, status: 201 };
  });

  assert.equal(calls, 0, 'a rejected transaction was sent again');
  assert.equal(failedCount(), 1);
});

test('REQ-34 a server error stays pending, because it may succeed later', async () => {
  enqueue(body('100.00'));

  await flush(async () => ({ ok: false, status: 503, message: 'later' }));

  assert.equal(failedCount(), 0);
  assert.equal(pendingCount(), 1);
  assert.equal(pending()[0].attempts, 1);
});

test('REQ-34 a transaction that failed can be retried once corrected', async () => {
  enqueue(body('100.00'));
  await flush(async () => ({ ok: false, status: 400, message: 'no' }));

  retry(pending()[0].id);
  assert.equal(pendingCount(), 1);

  const result = await flush(accepting());
  assert.equal(result.sent, 1);
  assert.equal(pending().length, 0);
});

test('REQ-34 a failed transaction can be discarded', async () => {
  enqueue(body('100.00'));
  enqueue(body('250.00'));
  await flush(async () => ({ ok: false, status: 400, message: 'no' }));

  assert.equal(failedCount(), 2);
  clearFailed();
  assert.equal(pending().length, 0);
});

test('REQ-34 one queued transaction can be removed without touching the rest', () => {
  enqueue(body('100.00'));
  const second = enqueue(body('250.00'));
  remove(second.id);

  assert.deepEqual(pending().map((e) => e.body.amount), ['100.00']);
});

test('REQ-34 unreadable storage does not break recording', () => {
  store.set('pfem_offline_queue', 'not json at all');
  assert.deepEqual(pending(), []);

  enqueue(body('100.00'));
  assert.equal(pendingCount(), 1);
});

test('REQ-34 each queued transaction gets its own id', () => {
  const a = enqueue(body('100.00'));
  const b = enqueue(body('100.00'));
  assert.notEqual(a.id, b.id);
});
