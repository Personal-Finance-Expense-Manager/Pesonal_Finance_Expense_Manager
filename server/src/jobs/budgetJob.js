
import { processBudgetAutomation } from '../services/budgetAutomationService.js';

/**
 * US-15: process expired budgets at startup and every five minutes.
 */
export function startBudgetJob({
  intervalMs = 5 * 60 * 1000,
} = {}) {
  async function run() {
    try {
      const result = await processBudgetAutomation();

      if (result.created > 0) {
        console.log('[budget-automation] Generated budgets:', result);
      }
    } catch (error) {
      console.error('[budget-automation] Job failed:', error.message);
    }
  }

  run();

  const timer = setInterval(run, intervalMs);
  timer.unref();

  return timer;
}
