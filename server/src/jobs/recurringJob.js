import { processDueRules } from '../services/recurringGenerationService.js';

/**
 * US-16 (REQ-54, REQ-60): generate due recurring transactions.
 *
 * Runs once at start-up (recovering anything missed while the server was
 * down) and then every minute. A tick before 00:05 IST finds nothing new to
 * do; from 00:05 IST it generates the day's transactions, so they appear
 * within a minute of the due time (PER-8 allows ten). Because every pass is a
 * catch-up that the database makes idempotent, the in-memory timer is only a
 * trigger - nothing depends on it firing exactly once.
 */
export function startRecurringJob({ intervalMs = Number(process.env.SCHEDULER_TICK_MS) || 60 * 1000 } = {}) {
  let running = false;

  async function run() {
    if (running) return; // never overlap with a slow previous pass
    running = true;
    try {
      const result = await processDueRules();
      if (result.generated || result.skipped || result.failed || result.recovered) {
        console.log('[recurring] pass complete:', result);
      }
    } catch (error) {
      console.error('[recurring] pass failed:', error.message);
    } finally {
      running = false;
    }
  }

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}
