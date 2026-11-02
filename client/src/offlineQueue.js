/**
 * Recording a transaction without a network - US-11 (#27), SRS 5.3: REQ-34.
 *
 * REQ-34 names the mobile client. There is no mobile client in this release -
 * the product is a web application - so the requirement is met in the client
 * that exists, and the deviation is recorded in DEVIATIONS.md.
 *
 * How it works:
 *   - a transaction recorded while offline is kept here, marked pending
 *   - the queue is flushed when the browser reports connectivity again, and
 *     on a timer, so a connection that returns without firing the event is
 *     still picked up well inside the sixty seconds REQ-34 allows
 *   - a transaction that the server rejects on its own terms (a 4xx: a
 *     deleted account, an invalid category) is not retried for ever; it is
 *     marked failed and kept, so the entry is never silently lost
 *
 * The queue lives in localStorage, so it survives the tab being closed. That
 * is per-browser and per-device, which is the correct scope: a pending entry
 * belongs to the device it was typed on until it reaches the server.
 */

const QUEUE_KEY = 'pfem_offline_queue';

/** Well inside the sixty seconds REQ-34 allows, without polling hard. */
export const FLUSH_INTERVAL_MS = 15000;

function read() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Unreadable or unavailable storage must not break recording.
    return [];
  }
}

function write(entries) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
  } catch {
    // Full or unavailable storage: the entry does not survive a reload, but
    // the one in memory is still sent on this visit.
  }
}

export function pending() {
  return read();
}

export function pendingCount() {
  return read().filter((entry) => entry.status !== 'failed').length;
}

export function failedCount() {
  return read().filter((entry) => entry.status === 'failed').length;
}

/** Queue a transaction that could not be sent, and return the stored entry. */
export function enqueue(body) {
  const entries = read();

  const entry = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    body,
    queued_at: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
    message: '',
  };

  entries.push(entry);
  write(entries);
  return entry;
}

export function remove(id) {
  write(read().filter((entry) => entry.id !== id));
}

export function clearFailed() {
  write(read().filter((entry) => entry.status !== 'failed'));
}

/** Retry an entry the server refused, by putting it back in the queue. */
export function retry(id) {
  write(
    read().map((entry) =>
      entry.id === id ? { ...entry, status: 'pending', message: '' } : entry
    )
  );
}

/**
 * Send everything pending.
 *
 * `send` posts one transaction and resolves with { ok, status, message }. It
 * is injected so this module stays free of fetch and of the session, and can
 * be tested without either.
 *
 * Resolves with a summary: { sent, failed, remaining }.
 */
export async function flush(send) {
  const entries = read();

  if (entries.length === 0) return { sent: 0, failed: 0, remaining: 0 };

  let sent = 0;
  let failed = 0;
  const kept = [];

  for (const entry of entries) {
    if (entry.status === 'failed') {
      kept.push(entry);
      continue;
    }

    let result;

    try {
      result = await send(entry.body);
    } catch {
      // No network yet: keep it exactly as it was and stop trying, so the
      // whole queue is not burned through while still offline.
      kept.push(entry, ...entries.slice(entries.indexOf(entry) + 1));
      break;
    }

    if (result.ok) {
      sent += 1;
      continue;
    }

    // A 4xx is the server's considered answer, and retrying cannot change it.
    // A 5xx or a timeout might succeed later, so it stays pending.
    if (result.status >= 400 && result.status < 500) {
      failed += 1;
      kept.push({
        ...entry,
        status: 'failed',
        attempts: entry.attempts + 1,
        message: result.message || 'The server rejected this transaction.',
      });
    } else {
      kept.push({ ...entry, attempts: entry.attempts + 1 });
    }
  }

  // Keep the list unique: the break above can re-add entries already kept.
  const seen = new Set();
  const deduped = kept.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });

  write(deduped);

  return {
    sent,
    failed,
    remaining: deduped.filter((entry) => entry.status !== 'failed').length,
  };
}
