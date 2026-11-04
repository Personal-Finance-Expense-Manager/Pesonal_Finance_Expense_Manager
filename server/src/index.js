
import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { startPurgeJob } from './jobs/purgeJob.js';
import { startBudgetJob } from './jobs/budgetJob.js';
import { startRecurringJob } from './jobs/recurringJob.js';
import { startBillReminderJob } from './jobs/billReminderJob.js';

const PORT = process.env.PORT || 5000;

async function start() {
  const connected = await connectDB();

  if (connected) {
    startPurgeJob();
    startBudgetJob();

    // US-16 / US-17. SCHEDULER_ENABLED=false turns them off (for example on a
    // second instance, or while debugging); they are safe to run on several.
    if (process.env.SCHEDULER_ENABLED !== 'false') {
      startRecurringJob();
      startBillReminderJob();
    }
  }

  app.listen(PORT, () => {
    console.log(`[api] PFEM server listening on http://localhost:${PORT}`);
    console.log(`[api] health check: http://localhost:${PORT}/api/health`);
  });
}

start();
