
import 'dotenv/config';
import app from './app.js';
import { connectDB } from './config/db.js';
import { startPurgeJob } from './jobs/purgeJob.js';
import { startBudgetJob } from './jobs/budgetJob.js';
import { startRecurringJob } from './jobs/recurringJob.js';
import { startBillReminderJob } from './jobs/billReminderJob.js';
import { startBackupScheduler } from './services/backupScheduler.js';
import { assertEnvironment } from './config/security.js';
import { keyRing } from './utils/crypto.js';
import { inMaintenanceMode } from './middleware/maintenance.js';

const PORT = process.env.PORT || 5000;

async function start() {
  // US-28 SEC-12: refuse to run production with missing or placeholder secrets,
  // and stop early (in every environment) if the encryption key is absent.
  assertEnvironment();
  keyRing();

  if (process.env.DEV_AUTH_HEADER === 'true') {
    console.warn('[config] DEV_AUTH_HEADER is on: requests may claim any user with X-User-Id. Development only.');
  }

  const connected = await connectDB();

  if (connected && !inMaintenanceMode()) {
    startPurgeJob();
    startBudgetJob();

    // US-26 REQ-97: a backup every 24 hours, expired ones removed. Needs BACKUP_ENCRYPTION_KEY.
    if (process.env.BACKUP_ENCRYPTION_KEY) startBackupScheduler();
    else console.warn('[backup] BACKUP_ENCRYPTION_KEY is not set: automated backups are OFF.');

    // US-16 / US-17. SCHEDULER_ENABLED=false turns them off (for example on a
    // second instance, or while debugging); they are safe to run on several.
    if (process.env.SCHEDULER_ENABLED !== 'false') {
      startRecurringJob();
      startBillReminderJob();
    }
  }

  if (connected && inMaintenanceMode()) console.warn('[recovery] Incomplete restore detected: API and scheduled jobs remain unavailable until offline recovery completes.');

  app.listen(PORT, () => {
    console.log(`[api] PFEM server listening on http://localhost:${PORT}`);
    console.log(`[api] health check: http://localhost:${PORT}/api/health`);
  });
}

start();
