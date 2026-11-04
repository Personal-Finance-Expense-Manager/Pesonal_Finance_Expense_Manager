import { runBillScheduler } from '../services/billSchedulerService.js';

/**
 * US-17 (REQ-57, REQ-59): mark overdue bills and send due reminders.
 * Runs at start-up and every minute; each pass is idempotent.
 */
export function startBillReminderJob({ intervalMs = Number(process.env.SCHEDULER_TICK_MS) || 60 * 1000 } = {}) {
  let running = false;

  async function run() {
    if (running) return;
    running = true;
    try {
      const result = await runBillScheduler();
      if (result.overdue || result.delivered || result.failed || result.not_configured) {
        console.log('[bill-reminders] pass complete:', result);
      }
    } catch (error) {
      console.error('[bill-reminders] pass failed:', error.message);
    } finally {
      running = false;
    }
  }

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}
