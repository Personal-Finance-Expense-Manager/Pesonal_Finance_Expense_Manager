import { purgeExpired } from '../services/recycleBinService.js';

/**
 * Scheduled purge of the recycle bin (REQ-29: "purge it permanently
 * thereafter"). Runs once at start-up and then every six hours; each run is
 * idempotent, so restarts and overlapping instances are harmless.
 */
export function startPurgeJob({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  async function run() {
    try {
      const result = await purgeExpired();
      if (result.transactions || result.transfers) {
        console.log('[purge] removed expired recycle-bin records', result);
      }
    } catch (error) {
      console.error('[purge] failed:', error.message);
    }
  }

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref(); // never keep the process alive just for this
  return timer;
}
