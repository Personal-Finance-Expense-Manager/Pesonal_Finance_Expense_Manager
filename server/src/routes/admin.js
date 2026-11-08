import { Router } from 'express';
import { requireAdmin } from '../middleware/currentUser.js';
import {
  confirmAdminPassword,
  getUser,
  listAuditLogs,
  listUsers,
  restoreUser,
  suspendUser,
  userSummary,
} from '../services/adminService.js';
import {
  backupStatus,
  createBackup,
  listBackups,
  restoreBackup,
  verifyBackup,
} from '../services/backupService.js';
import { auditFailureCount, auditFromRequest, auditStrictFromRequest } from '../services/auditService.js';
import { ApiError, sendApiError } from '../utils/apiError.js';
import { parsePagination } from '../utils/pagination.js';

/**
 * Administration - US-26 (#62), SRS REQ-94, REQ-96, REQ-97.
 *
 * Mounted behind requireUser; requireAdmin then reads the role from the stored
 * user record (never from the request). Every handler is therefore reachable
 * only by an administrator.
 *
 *   GET   /api/admin/summary                    user counts and system status
 *   GET   /api/admin/users                      paginated, filterable user list
 *   GET   /api/admin/users/:id                  one account
 *   POST  /api/admin/users/:id/suspend          { reason }
 *   POST  /api/admin/users/:id/restore
 *   GET   /api/admin/audit-logs                 paginated, filterable audit trail
 *   GET   /api/admin/backups                    retained backups and job status
 *   POST  /api/admin/backups                    take a backup now
 *   POST  /api/admin/backups/:id/verify         decrypt and check, restore nothing
 *   POST  /api/admin/backups/:id/restore        { confirm: "RESTORE", password }
 *
 * Nothing here returns transaction amounts, balances, notes, attachments or
 * reports (see services/adminService.js).
 */
const router = Router();
router.use(requireAdmin);

const handle = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendApiError(res, next, error);
  }
};

router.get('/summary', handle(async (req, res) => {
  const [users, backups] = await Promise.all([userSummary(), backupStatus()]);
  res.json({ users, backups, audit: { write_failures_since_start: auditFailureCount() } });
}));

router.get('/users', handle(async (req, res) => {
  res.json(await listUsers(req.query, parsePagination(req.query)));
}));

router.get('/users/:id', handle(async (req, res) => {
  res.json({ data: await getUser(req.params.id) });
}));

router.post('/users/:id/suspend', handle(async (req, res) => {
  const data = await suspendUser(req.user, req.params.id, req.body?.reason, req.ip);
  res.json({ message: 'Account suspended. Its sessions have been ended.', data });
}));

router.post('/users/:id/restore', handle(async (req, res) => {
  const data = await restoreUser(req.user, req.params.id, req.ip);
  res.json({ message: 'Account restored.', data });
}));

router.get('/audit-logs', handle(async (req, res) => {
  res.json(await listAuditLogs(req.query, parsePagination(req.query, { defaultLimit: 50 })));
}));

router.get('/backups', handle(async (req, res) => {
  const [status, backups] = await Promise.all([backupStatus(), listBackups()]);
  res.json({ status, data: backups.map(({ sha256, ...rest }) => rest) });
}));

router.post('/backups', handle(async (req, res) => {
  await auditStrictFromRequest(req, { category: 'backup', action: 'admin.backup_requested', entityType: 'backup' });
  try {
    const backup = await createBackup({ trigger: 'manual', createdBy: req.user._id });
    await auditFromRequest(req, { category: 'backup', action: 'backup.created', entityType: 'backup', metadata: { id: backup.id, trigger: 'manual', consistency: backup.consistency } });
    const { sha256, ...data } = backup;
    res.status(201).json({ message: 'Backup created.', data });
  } catch (error) {
    await auditFromRequest(req, { category: 'backup', outcome: 'failure', action: 'backup.failed', entityType: 'backup', metadata: { trigger: 'manual', reason: error.message } });
    throw error;
  }
}));

router.post('/backups/:id/verify', handle(async (req, res) => {
  const result = await verifyBackup(req.params.id);
  await auditFromRequest(req, { category: 'backup', action: 'backup.verified', entityType: 'backup', metadata: { id: req.params.id } });
  res.json({ message: 'The backup is intact.', data: result });
}));

router.post('/backups/:id/restore', handle(async (req, res) => {
  const { confirm, password } = req.body ?? {};

  if (confirm !== 'RESTORE') {
    throw new ApiError(400, 'Type RESTORE to confirm. Restoring replaces all current data.');
  }
  if (!(await confirmAdminPassword(req.user._id, password))) {
    await auditFromRequest(req, { category: 'backup', outcome: 'denied', action: 'admin.backup_restore_denied', entityType: 'backup', metadata: { id: req.params.id, reason: 'password_check_failed' } });
    throw new ApiError(403, 'Your password is not correct.');
  }

  // A restore that cannot be recorded does not start.
  await auditStrictFromRequest(req, { category: 'backup', action: 'admin.backup_restore_started', entityType: 'backup', metadata: { id: req.params.id } });

  try {
    const result = await restoreBackup(req.params.id, { requestedBy: req.user._id });
    // The database has just been replaced; this record is written into the restored data.
    await auditFromRequest(req, { category: 'backup', action: 'admin.backup_restored', entityType: 'backup', metadata: { id: req.params.id, safety_backup_id: result.safety_backup_id } });
    res.json({
      message: 'The backup was restored. Sign in again if your session no longer exists.',
      data: result,
    });
  } catch (error) {
    await auditFromRequest(req, { category: 'backup', outcome: 'failure', action: 'admin.backup_restore_failed', entityType: 'backup', metadata: { id: req.params.id, reason: error.message } });
    throw error;
  }
}));

export default router;
