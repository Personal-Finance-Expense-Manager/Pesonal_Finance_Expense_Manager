import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Throw-away directory and keys, set before the app is imported.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pfem-backups-'));
process.env.BACKUP_DIR = dir;
process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.BACKUP_RETENTION_DAYS = '7';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startApi, stopApi, apiUrl, createUser, createAccount, createCategory, record } from './helpers/integration.js';
import { PASSWORD, bearer, createAdminUser, createRealUser, signIn } from './helpers/auth.js';
import {
  cleanupExpiredBackups, createBackup, listBackups, restoreBackup, retentionDays, verifyBackup,
} from '../src/services/backupService.js';
import { runBackupCycle } from '../src/services/backupScheduler.js';
import { inMaintenanceMode } from '../src/middleware/maintenance.js';
import AuditLog from '../src/models/AuditLog.js';
import User from '../src/models/User.js';
import Transaction from '../src/models/Transaction.js';

/**
 * US-26 (#62), REQ-97: encrypted automated backups, 7-day retention, restore.
 * Needs a MongoDB replica set for the snapshot-consistency test.
 */

let admin; let adminApi; let owner; let account; let category;

before(async () => {
  await startApi();
  admin = await createAdminUser();
  adminApi = bearer(apiUrl(), (await signIn(admin)).token);
  owner = await createUser('backupowner');
  account = await createAccount(owner);
  category = await createCategory(owner);
  await record(owner, { type: 'expense', amount: '250.00', account_id: String(account._id), category_id: String(category._id), note: 'unique-note-for-backup' });
});

after(async () => {
  await stopApi();
  await fs.rm(dir, { recursive: true, force: true });
});

const db = () => mongoose.connection.db;
const clearBackups = async () => {
  for (const name of await fs.readdir(dir)) if (name !== '.lock') await fs.rm(path.join(dir, name), { force: true });
};

// ---------------------------------------------------------------------------

test('REQ-97 a backup covers every collection and index, not a chosen few', async () => {
  const backup = await createBackup({ trigger: 'manual', createdBy: admin._id });
  const live = (await db().listCollections().toArray()).filter((c) => !c.name.startsWith('system.')).map((c) => c.name).sort();

  assert.deepEqual(backup.collections.map((c) => c.name).sort(), live);
  for (const { name, documents } of backup.collections) {
    assert.equal(documents, await db().collection(name).countDocuments(), name);
  }
  assert.equal(backup.consistency, 'snapshot', 'a replica set gives a point-in-time snapshot');
  assert.ok(backup.documents > 5);
  assert.ok((await verifyBackup(backup.id)).ok);
});

test('REQ-97 the backup file is encrypted: no readable data, names or markers in it', async () => {
  const [backup] = await listBackups();
  const bytes = await fs.readFile(path.join(dir, `${backup.id}.pfembk`));

  assert.equal(bytes.subarray(0, 8).toString(), 'PFEMBK01');
  for (const needle of ['unique-note-for-backup', 'backupowner', 'example.test', 'transactions', '"type":"doc"', 'ObjectId', 'password_hash']) {
    assert.ok(!bytes.includes(needle), `plaintext "${needle}" found in the backup`);
  }
  // Compressed-then-encrypted data should look random: no byte value dominates.
  const histogram = new Array(256).fill(0);
  for (const b of bytes) histogram[b] += 1;
  assert.ok(Math.max(...histogram) / bytes.length < 0.02);

  const stat = await fs.stat(path.join(dir, `${backup.id}.pfembk`));
  assert.equal(stat.mode & 0o077, 0, 'readable by the owner only');
});

test('REQ-97 restoring brings back the exact data, types and indexes, and removes what was added later', async () => {
  const [backup] = await listBackups();
  const before = await Transaction.find({}).lean();
  const usersBefore = await User.countDocuments();

  // Damage the database in several ways.
  await Transaction.deleteMany({});
  await User.deleteMany({ _id: { $ne: admin._id } });
  await db().collection('surprise_collection').insertOne({ made: 'after the backup' });
  await db().collection('accounts').dropIndexes();

  const result = await restoreBackup(backup.id, { requestedBy: admin._id });

  assert.equal(result.restored_backup_id, backup.id);
  assert.ok(result.safety_backup_id && result.safety_backup_id !== backup.id);
  assert.equal(inMaintenanceMode(), false, 'maintenance mode is switched off again');

  const after = await Transaction.find({}).lean();
  assert.equal(after.length, before.length);
  assert.equal(String(after[0]._id), String(before[0]._id));
  assert.equal(after[0].note, 'unique-note-for-backup', 'encrypted fields come back readable');
  assert.equal(after[0].amount.constructor.name, 'Decimal128');
  assert.equal(after[0].amount.toString(), '250.00');
  assert.equal(await User.countDocuments(), usersBefore);
  assert.equal((await db().listCollections({ name: 'surprise_collection' }).toArray()).length, 0, 'collections created after the backup are removed');
  assert.ok((await db().collection('accounts').indexes()).length > 1, 'index definitions were restored');
  assert.equal((await db().listCollections().toArray()).filter((c) => c.name.startsWith('__restore_')).length, 0, 'no shadow collections left');
});

test('REQ-97 the restore took a safety backup of what it replaced, and that can be restored too', async () => {
  const backups = await listBackups();
  const safety = backups.find((b) => b.trigger === 'pre-restore');
  assert.ok(safety);
  assert.ok((await verifyBackup(safety.id)).ok);
});

test('REQ-97 a tampered backup is refused and the live database is left untouched', async () => {
  const backup = await createBackup({ trigger: 'manual' });
  const file = path.join(dir, `${backup.id}.pfembk`);
  const bytes = await fs.readFile(file);
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  await fs.writeFile(file, bytes);

  const countBefore = await Transaction.countDocuments();
  await db().collection('canary').insertOne({ alive: true });

  await assert.rejects(restoreBackup(backup.id), (error) => error.status === 422);
  assert.equal(await Transaction.countDocuments(), countBefore);
  assert.equal(await db().collection('canary').countDocuments(), 1, 'nothing was replaced');
  assert.equal(inMaintenanceMode(), false);
  await assert.rejects(verifyBackup(backup.id), (error) => error.status === 422);
});

test('REQ-97 a backup encrypted under a different key cannot be restored', async () => {
  const backup = await createBackup({ trigger: 'manual' });
  const real = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  try {
    await assert.rejects(restoreBackup(backup.id), (error) => error.status === 422);
  } finally {
    process.env.BACKUP_ENCRYPTION_KEY = real;
  }
  assert.ok((await verifyBackup(backup.id)).ok);
});

test('REQ-97 a truncated backup (interrupted copy) is refused', async () => {
  const backup = await createBackup({ trigger: 'manual' });
  const file = path.join(dir, `${backup.id}.pfembk`);
  const bytes = await fs.readFile(file);
  await fs.writeFile(file, bytes.subarray(0, bytes.length - 50));
  await assert.rejects(verifyBackup(backup.id), (error) => error.status === 422);
});

test('REQ-97 backup ids that are not ours (path traversal, junk) are never opened', async () => {
  for (const id of ['../../etc/passwd', '..\\..\\x', 'pfem-backup-../x', '', 'nope', null, undefined]) {
    await assert.rejects(restoreBackup(id), (error) => error.status === 404, String(id));
    await assert.rejects(verifyBackup(id), (error) => error.status === 404, String(id));
  }
});

test('REQ-97 a missing or malformed key stops the backup before anything is written', async () => {
  const real = process.env.BACKUP_ENCRYPTION_KEY;
  const files = async () => (await fs.readdir(dir)).filter((n) => n !== '.lock').sort();
  const filesBefore = await files();
  try {
    for (const bad of [undefined, 'short', 'zz'.repeat(32)]) {
      if (bad === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
      else process.env.BACKUP_ENCRYPTION_KEY = bad;
      await assert.rejects(createBackup({ trigger: 'manual' }), /BACKUP_ENCRYPTION_KEY/);
    }
  } finally {
    process.env.BACKUP_ENCRYPTION_KEY = real;
  }
  assert.deepEqual(await files(), filesBefore, 'nothing was written, and no half-written file is left behind');
});

test('REQ-97 two backups started together do not run at once (one is told to wait)', async () => {
  const results = await Promise.allSettled([createBackup({ trigger: 'manual' }), createBackup({ trigger: 'manual' })]);
  const done = results.filter((r) => r.status === 'fulfilled');
  const refused = results.filter((r) => r.status === 'rejected');
  assert.equal(done.length, 1);
  assert.equal(refused[0].reason.status, 409);
});

test('REQ-97 a restore cannot start while a backup is running', async () => {
  const [first] = await listBackups();
  const running = createBackup({ trigger: 'manual' });
  await assert.rejects(restoreBackup(first.id), (error) => error.status === 409);
  await running;
});

test('REQ-97 a lock left by a crashed process is not permanent', async () => {
  await fs.writeFile(path.join(dir, '.lock'), '{}');
  const old = new Date(Date.now() - 3 * 3600 * 1000);
  await fs.utimes(path.join(dir, '.lock'), old, old);
  const backup = await createBackup({ trigger: 'manual' });
  assert.ok(backup.id);
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

async function age(id, days) {
  const manifest = path.join(dir, `${id}.json`);
  const info = JSON.parse(await fs.readFile(manifest, 'utf8'));
  info.created_at = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  await fs.writeFile(manifest, JSON.stringify(info));
}

test('REQ-97 backups older than seven days are removed; newer ones and the newest overall are kept', async () => {
  await clearBackups();
  assert.equal(retentionDays(), 7);

  const ids = [];
  for (let i = 0; i < 4; i += 1) ids.push((await createBackup({ trigger: 'scheduled' })).id);
  await age(ids[0], 30);
  await age(ids[1], 8);
  await age(ids[2], 6.9);
  await age(ids[3], 0.1);

  const removed = await cleanupExpiredBackups();
  assert.deepEqual(removed.sort(), [ids[0], ids[1]].sort());
  assert.deepEqual((await listBackups()).map((b) => b.id).sort(), [ids[2], ids[3]].sort());

  for (const id of [ids[0], ids[1]]) {
    await assert.rejects(fs.stat(path.join(dir, `${id}.pfembk`)));
    await assert.rejects(fs.stat(path.join(dir, `${id}.json`)));
  }
  // Every remaining backup can still be restored from.
  for (const id of [ids[2], ids[3]]) assert.ok((await verifyBackup(id)).ok);
});

test('REQ-97 cleanup never deletes the only backup, however old', async () => {
  await clearBackups();
  const only = await createBackup({ trigger: 'scheduled' });
  await age(only.id, 90);
  assert.deepEqual(await cleanupExpiredBackups(), []);
  assert.equal((await listBackups()).length, 1);
});

test('REQ-97 a daily cycle: takes a backup when none is under 24h old, otherwise not, and expires old ones', async () => {
  await clearBackups();

  const first = await runBackupCycle();
  assert.ok(first.created);
  const second = await runBackupCycle();
  assert.equal(second.created, null, 'a backup under 24 hours old suppresses another');

  await age(first.created, 1.2); // now more than 24 hours old
  const third = await runBackupCycle();
  assert.ok(third.created, 'due again after 24 hours');

  await age(first.created, 9);
  const fourth = await runBackupCycle();
  assert.deepEqual(fourth.removed, [first.created]);

  const created = await AuditLog.countDocuments({ action: 'backup.created', category: 'backup' });
  assert.ok(created >= 2, 'scheduled backups are audited');
});

test('REQ-97 a failing scheduled backup is reported and audited, and cleanup still runs', async () => {
  await clearBackups();
  const real = process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.BACKUP_ENCRYPTION_KEY;
  const quiet = console.error;
  console.error = () => {};
  let result;
  try {
    result = await runBackupCycle();
  } finally {
    console.error = quiet;
    process.env.BACKUP_ENCRYPTION_KEY = real;
  }
  assert.equal(result.created, null);
  assert.ok(await AuditLog.findOne({ action: 'backup.failed', outcome: 'failure' }));
});

test('REQ-97 automated backups can be switched off explicitly', async () => {
  process.env.BACKUP_ENABLED = 'false';
  try {
    assert.deepEqual(await runBackupCycle(), { skipped: 'disabled' });
  } finally {
    delete process.env.BACKUP_ENABLED;
  }
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

test('REQ-97 an administrator can take, list and verify backups through the API; the checksum is not exposed', async () => {
  await clearBackups();
  const created = await adminApi.post('/api/admin/backups');
  assert.equal(created.status, 201);
  assert.equal(created.body.data.trigger, 'manual');
  assert.equal(created.body.data.sha256, undefined);

  const list = await adminApi.get('/api/admin/backups');
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.status.retention_days, 7);
  assert.equal(list.body.status.enabled, true);

  const verified = await adminApi.post(`/api/admin/backups/${created.body.data.id}/verify`);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.ok, true);
  assert.equal((await adminApi.post('/api/admin/backups/nonexistent/verify')).status, 404);
});

test('REQ-97 restoring through the API needs admin role, the typed confirmation and the admin\'s own password', async () => {
  const [backup] = await listBackups();
  const url = `/api/admin/backups/${backup.id}/restore`;

  const member = await createRealUser('notadmin');
  const memberApi = bearer(apiUrl(), (await signIn(member)).token);
  assert.equal((await memberApi.post(url, { confirm: 'RESTORE', password: PASSWORD })).status, 403);
  assert.equal((await bearer(apiUrl(), null).post(url, { confirm: 'RESTORE', password: PASSWORD })).status, 401);

  assert.equal((await adminApi.post(url, { password: PASSWORD })).status, 400, 'confirmation phrase missing');
  assert.equal((await adminApi.post(url, { confirm: 'RESTORE' })).status, 403, 'password missing');
  assert.equal((await adminApi.post(url, { confirm: 'RESTORE', password: 'Wrong-Password1!' })).status, 403);
  assert.ok(await AuditLog.findOne({ action: 'admin.backup_restore_denied' }));
});

test('REQ-97 an administrator restores through the API; it is audited before and after', async () => {
  const [backup] = await listBackups();
  await Transaction.deleteMany({});

  const res = await adminApi.post(`/api/admin/backups/${backup.id}/restore`, { confirm: 'RESTORE', password: PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.restored_backup_id, backup.id);
  assert.equal(await Transaction.countDocuments(), 1);

  // "restored" is written into the restored database. "started" was written
  // before the data was replaced, so it lives on in the automatic safety backup.
  const restored = await AuditLog.findOne({ action: 'admin.backup_restored' }).lean();
  assert.ok(restored);
  assert.equal(String(restored.user_id), String(admin._id));
  assert.equal(restored.metadata.safety_backup_id, res.body.data.safety_backup_id);
  assert.ok(restored.ip_address);
  assert.ok((await verifyBackup(res.body.data.safety_backup_id)).ok);
  assert.ok(!JSON.stringify(res.body).includes('unique-note-for-backup'));
});

test('REQ-97 while a restore runs the API answers 503, and a bad restore does not leave it stuck', async () => {
  const { setMaintenanceMode } = await import('../src/middleware/maintenance.js');
  setMaintenanceMode(true);
  try {
    assert.equal((await bearer(apiUrl(), null).get('/api/accounts')).status, 503);
    assert.equal((await fetch(`${apiUrl()}/api/health`)).status, 200, 'the health probe still answers');
  } finally {
    setMaintenanceMode(false);
  }
  assert.notEqual((await bearer(apiUrl(), null).get('/api/accounts')).status, 503);
});

test('REQ-97 a backup taken while writes continue is internally consistent (snapshot isolation)', async () => {
  const target = await createUser('snap');
  const acc = await createAccount(target);
  const cat = await createCategory(target);
  let stop = false;
  const writer = (async () => {
    while (!stop) {
      await record(target, { type: 'expense', amount: '1', account_id: String(acc._id), category_id: String(cat._id) });
    }
  })();
  const backup = await createBackup({ trigger: 'manual' });
  stop = true;
  await writer;

  // Restore into the live database and check each counted document is present exactly once.
  const info = (await listBackups()).find((b) => b.id === backup.id);
  const counted = info.collections.find((c) => c.name === 'transactions').documents;
  await restoreBackup(backup.id);
  assert.equal(await Transaction.countDocuments({}), counted);
  const ids = (await Transaction.find({}).select('_id').lean()).map((t) => String(t._id));
  assert.equal(new Set(ids).size, ids.length);
});
