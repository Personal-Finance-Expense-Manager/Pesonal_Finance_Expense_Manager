import {
  backupsEnabled,
  cleanupExpiredBackups,
  createBackup,
  listBackups,
  recordBackupFailure,
  recordBackupSuccess,
} from './backupService.js';
import { recordAudit } from './auditService.js';

/**
 * Automated backups - US-26 (#62), REQ-97.
 *
 * Every 15 minutes this checks whether the newest backup is older than 24 hours
 * and, if so, takes one. Checking against the files on disk (not a timer that
 * restarts with the process) means a restart neither skips a day nor produces a
 * burst of backups. Expired backups (older than the retention period, 7 days by
 * default) are removed after each check.
 *
 * On several API instances sharing one backup directory the lock file in
 * backupService makes the instances take turns; BACKUP_ENABLED=false turns the
 * job off on the instances that should not run it.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runBackupCycle(now = Date.now()) {
  if (!backupsEnabled()) return { skipped: 'disabled' };

  const newest = (await listBackups())[0];
  const due = !newest || now - new Date(newest.created_at).getTime() >= DAY_MS;
  let created = null;

  if (due) {
    try {
      created = await createBackup({ trigger: 'scheduled' });
      recordBackupSuccess();
      await recordAudit({
        category: 'backup',
        action: 'backup.created',
        entityType: 'backup',
        metadata: { id: created.id, trigger: 'scheduled', consistency: created.consistency, documents: created.documents },
      });
    } catch (error) {
      if (error.status === 409) return { skipped: 'busy' }; // another process is already doing it
      recordBackupFailure(error.message);
      console.error('[backup] scheduled backup failed:', error.message);
      await recordAudit({
        category: 'backup',
        outcome: 'failure',
        action: 'backup.failed',
        entityType: 'backup',
        metadata: { trigger: 'scheduled', reason: error.message },
      });
    }
  }

  const removed = await cleanupExpiredBackups(now).catch((error) => {
    console.error('[backup] cleanup failed:', error.message);
    return [];
  });
  if (removed.length) {
    await recordAudit({ category: 'backup', action: 'backup.expired_removed', entityType: 'backup', metadata: { removed: removed.length } });
  }

  return { created: created?.id ?? null, removed };
}

export function startBackupScheduler({ intervalMs = 15 * 60 * 1000 } = {}) {
  if (!backupsEnabled()) {
    console.warn('[backup] BACKUP_ENABLED=false: automated backups are OFF.');
    return null;
  }

  runBackupCycle().catch((error) => console.error('[backup] cycle failed:', error.message));
  const timer = setInterval(() => {
    runBackupCycle().catch((error) => console.error('[backup] cycle failed:', error.message));
  }, intervalMs);
  timer.unref();
  return timer;
}
