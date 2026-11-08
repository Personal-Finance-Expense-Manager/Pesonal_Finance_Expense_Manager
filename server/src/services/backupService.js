import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PassThrough, Readable } from 'node:stream';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { ApiError } from '../utils/apiError.js';
import { backupKey, createDecryptStream, createEncryptStream } from '../utils/backupCrypto.js';
import { BACKUP_RETENTION_DAYS_DEFAULT } from '../config/security.js';
import { setMaintenanceMode, restoreMarkerPath } from '../middleware/maintenance.js';

/**
 * Encrypted database backups - US-26 (#62), SRS REQ-97.
 *
 * WHAT IS BACKED UP
 *   Every collection in the application database - documents and index
 *   definitions (including TTL and partial indexes) - not a hand-picked subset.
 *   Collections are discovered at run time, so a model added later is included
 *   without touching this file. Uploaded receipt files live on disk, not in
 *   MongoDB; see docs/BACKUP_AND_RESTORE.md for how they are protected.
 *
 * CONSISTENCY
 *   On a replica set the dump runs in one snapshot-isolated session (MongoDB
 *   snapshot read concern), so all collections reflect the same instant even
 *   while users keep writing. A standalone mongod cannot do that; the backup is
 *   then "best_effort" (recorded in its manifest) and the documentation says to
 *   run production on a replica set. If the snapshot window is exceeded the dump
 *   is retried as best_effort rather than failing the nightly backup.
 *
 * FILE FORMAT
 *   NDJSON (Extended JSON, so ObjectId/Date/Decimal128 survive) -> gzip ->
 *   chunked AES-256-GCM (utils/backupCrypto.js). Written to *.tmp, fsynced and
 *   renamed, so a crash never leaves a half-written file that looks valid.
 *
 * RESTORE
 *   1. The whole file is decrypted and checked first - every authentication tag,
 *      the header, per-collection counts, the footer. Nothing is written if it
 *      is damaged, truncated or encrypted with another key.
 *   2. A fresh "pre-restore" backup of the current data is taken, so a restore
 *      can itself be undone.
 *   3. The API enters maintenance mode (503) while data is replaced.
 *   4. Each collection is rebuilt in a shadow collection, indexes included. A
 *      failure here (for example a unique index violated) aborts with the live
 *      data untouched.
 *   5. Only when every shadow is complete are they swapped in with
 *      renameCollection(dropTarget). Collections that did not exist at backup
 *      time are dropped. The swap is fast but not one atomic operation across
 *      collections; the pre-restore backup is the recovery path if it is
 *      interrupted.
 *
 * Backup and restore never run at the same time (a lock file in the backup
 * directory also covers several processes on one host).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(here, '../../backups');
const FORMAT = 1;
const ID_PATTERN = /^pfem-backup-\d{8}T\d{6}Z-[a-f0-9]{8}$/;
const SHADOW_PREFIX = '__restore_';
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const BATCH = 500;
const SNAPSHOT_ERRORS = new Set([20, 138, 239, 246, 244, 303, 115]);

const { EJSON } = mongoose.mongo.BSON;

export const backupDir = () => path.resolve(process.env.BACKUP_DIR || DEFAULT_DIR);
export const backupsEnabled = () => process.env.BACKUP_ENABLED !== 'false';

export function retentionDays() {
  const configured = Number(process.env.BACKUP_RETENTION_DAYS);
  return Number.isFinite(configured) && configured >= BACKUP_RETENTION_DAYS_DEFAULT
    ? Math.floor(configured) : BACKUP_RETENTION_DAYS_DEFAULT;
}

const paths = (id) => ({
  data: path.join(backupDir(), `${id}.pfembk`),
  manifest: path.join(backupDir(), `${id}.json`),
});

export const isValidBackupId = (id) => typeof id === 'string' && ID_PATTERN.test(id);

// ---------------------------------------------------------------------------
// Locking: one backup or restore at a time
// ---------------------------------------------------------------------------

let inProcessLock = null;

async function acquireLock(operation) {
  if (inProcessLock) throw new ApiError(409, `A ${inProcessLock} is already running. Try again when it has finished.`);

  await fs.mkdir(backupDir(), { recursive: true, mode: 0o700 });
  const lockPath = path.join(backupDir(), '.lock');

  const take = async () => {
    const handle = await fs.open(lockPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ operation, pid: process.pid, at: new Date().toISOString() }));
    await handle.close();
  };

  try {
    await take();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A lock left by a crashed process is cleared once it is clearly stale.
    const stat = await fs.stat(lockPath).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      await fs.unlink(lockPath).catch(() => {});
      await take();
    } else {
      throw new ApiError(409, 'Another backup or restore is already running. Try again when it has finished.');
    }
  }

  inProcessLock = operation;
  return async () => {
    inProcessLock = null;
    await fs.unlink(lockPath).catch(() => {});
  };
}

// ---------------------------------------------------------------------------
// Creating a backup
// ---------------------------------------------------------------------------

async function listUserCollections(db) {
  const all = await db.listCollections({}, { nameOnly: false }).toArray();
  return all
    .filter((c) => c.type !== 'view' && !c.name.startsWith('system.') && !c.name.startsWith(SHADOW_PREFIX))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Yield the backup as NDJSON lines. `stats` is filled in as it goes. */
async function* dumpLines({ db, session, meta, stats }) {
  const collections = await listUserCollections(db);

  yield `${JSON.stringify({ type: 'header', format: FORMAT, ...meta })}\n`;

  for (const info of collections) {
    const collection = db.collection(info.name);
    const indexes = (await collection.indexes().catch(() => []))
      .filter((index) => index.name !== '_id_')
      .map(({ v, ns, ...spec }) => spec);

    yield `${JSON.stringify({ type: 'collection', name: info.name, options: info.options || {}, indexes })}\n`;

    let count = 0;
    const cursor = collection.find({}, { session, batchSize: 1000 });
    for await (const doc of cursor) {
      count += 1;
      yield `${JSON.stringify({ type: 'doc', c: info.name, d: EJSON.stringify(doc, { relaxed: false }) })}\n`;
    }

    stats.collections.push({ name: info.name, documents: count });
    stats.documents += count;
    yield `${JSON.stringify({ type: 'collection_end', name: info.name, count })}\n`;
  }

  yield `${JSON.stringify({ type: 'footer', collections: stats.collections.length, documents: stats.documents })}\n`;
}

async function writeBackupFile(id, { snapshot, trigger, createdBy }) {
  const db = mongoose.connection.db;
  const { data, manifest } = paths(id);
  const tmp = `${data}.tmp`;
  const client = mongoose.connection.getClient();
  const session = snapshot ? client.startSession({ snapshot: true }) : undefined;
  const stats = { collections: [], documents: 0 };

  try {
    const serverInfo = await db.admin().serverInfo().catch(() => ({}));
    const meta = {
      id,
      database: db.databaseName,
      created_at: new Date().toISOString(),
      consistency: snapshot ? 'snapshot' : 'best_effort',
      mongo_version: serverInfo.version || null,
      trigger,
    };

    const source = Readable.from(dumpLines({ db, session, meta, stats }));
    await pipeline(source, zlib.createGzip(), createEncryptStream(backupKey()), createWriteStream(tmp, { mode: 0o600 }));

    const handle = await fs.open(tmp, 'r+');
    await handle.sync();
    await handle.close();
    await fs.rename(tmp, data);

    const bytes = await fs.readFile(data);
    const info = {
      id,
      file: path.basename(data),
      created_at: meta.created_at,
      size_bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      consistency: meta.consistency,
      trigger,
      created_by: createdBy ? String(createdBy) : null,
      mongo_version: meta.mongo_version,
      format: FORMAT,
      documents: stats.documents,
      collections: stats.collections,
    };

    // The manifest is written last: a backup without one is never offered.
    await fs.writeFile(`${manifest}.tmp`, JSON.stringify(info, null, 2), { mode: 0o600 });
    await fs.rename(`${manifest}.tmp`, manifest);
    return info;
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    await fs.unlink(data).catch(() => {});
    throw error;
  } finally {
    await session?.endSession().catch(() => {});
  }
}

const newId = () => {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `pfem-backup-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
};

async function createBackupUnlocked({ trigger = 'manual', createdBy = null } = {}) {
  if (mongoose.connection.readyState !== 1) throw new ApiError(503, 'The database is not connected.');
  backupKey(); // fail early with a clear message if the key is missing or malformed

  const id = newId();
  try {
    return await writeBackupFile(id, { snapshot: true, trigger, createdBy });
  } catch (error) {
    // A standalone server cannot do snapshot reads, and a very long dump can
    // outlive the snapshot window. Fall back to a best-effort dump, and say so.
    if (SNAPSHOT_ERRORS.has(error?.code) || /snapshot|atClusterTime|read concern/i.test(error?.message || '')) {
      console.warn('[backup] snapshot read unavailable, using a best-effort dump:', error.message);
      return writeBackupFile(newId(), { snapshot: false, trigger, createdBy });
    }
    throw error;
  }
}

/** Create a backup now. Resolves to the manifest. */
export async function createBackup(options = {}) {
  const release = await acquireLock('backup');
  try {
    return await createBackupUnlocked(options);
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// Listing, verifying and expiring
// ---------------------------------------------------------------------------

export async function listBackups() {
  let names;
  try {
    names = await fs.readdir(backupDir());
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const result = [];
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    const id = name.slice(0, -5);
    if (!isValidBackupId(id)) continue;
    try {
      const info = JSON.parse(await fs.readFile(path.join(backupDir(), name), 'utf8'));
      const stat = await fs.stat(paths(id).data);
      if (info.id === id && stat.isFile()) result.push(info);
    } catch {
      // A manifest without its data file (or vice versa) is not a usable backup.
    }
  }
  return result.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Split a stream of text into lines. Errors from the stream reject the iteration. */
async function* linesOf(stream) {
  let rest = '';
  for await (const chunk of stream) {
    rest += chunk.toString('utf8');
    let at;
    while ((at = rest.indexOf('\n')) !== -1) {
      yield rest.slice(0, at);
      rest = rest.slice(at + 1);
    }
  }
  if (rest) yield rest;
}

/** Decrypt and parse the whole file, calling `onRecord` for each line. Throws on any defect. */
async function readBackup(id, onRecord) {
  const { data } = paths(id);
  // pipeline() (unlike .pipe()) passes a failure in any stage - a bad key, a
  // flipped byte, a truncated file - to the reader instead of leaving it hanging.
  const output = new PassThrough();
  pipeline(createReadStream(data), createDecryptStream(backupKey()), zlib.createGunzip(), output).catch((error) => output.destroy(error));
  const lines = linesOf(output);

  const summary = { header: null, footer: null, counts: new Map(), documents: 0 };
  let current = null;
  let order = 0;

  try {
    for await (const line of lines) {
      if (!line) continue;
      const record = JSON.parse(line);
      order += 1;

      if (order === 1) {
        if (record.type !== 'header' || record.format !== FORMAT) throw new Error('Unsupported or missing backup header.');
        summary.header = record;
      } else if (record.type === 'collection') {
        if (current) throw new Error('A collection started before the previous one ended.');
        current = { name: record.name, seen: 0 };
      } else if (record.type === 'doc') {
        if (!current || current.name !== record.c) throw new Error('A document is outside its collection.');
        current.seen += 1;
        summary.documents += 1;
      } else if (record.type === 'collection_end') {
        if (!current || current.name !== record.name || current.seen !== record.count) {
          throw new Error(`Document count for "${record.name}" does not match.`);
        }
        summary.counts.set(record.name, record.count);
        current = null;
      } else if (record.type === 'footer') {
        summary.footer = record;
      }

      await onRecord?.(record);
    }
  } catch (error) {
    if (error.name === 'BackupCryptoError' || error.code === 'Z_DATA_ERROR' || error.code === 'Z_BUF_ERROR') {
      throw new ApiError(422, error.name === 'BackupCryptoError' ? error.message : 'The backup is corrupt.');
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, `The backup is not valid: ${error.message}`);
  }

  if (!summary.header || !summary.footer || current) throw new ApiError(422, 'The backup is incomplete.');
  if (summary.footer.documents !== summary.documents || summary.footer.collections !== summary.counts.size) {
    throw new ApiError(422, 'The backup totals do not match its contents.');
  }
  if (summary.header.id !== id) throw new ApiError(422, 'The backup does not match its name.');
  return summary;
}

async function requireBackup(id) {
  if (!isValidBackupId(id)) throw new ApiError(404, 'Backup not found.');
  const found = (await listBackups()).find((b) => b.id === id);
  if (!found) throw new ApiError(404, 'Backup not found.');
  return found;
}

async function checkBackup(id) {
  const manifest = await requireBackup(id);
  const bytes = await fs.readFile(paths(id).data);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
    throw new ApiError(422, 'The backup file does not match its recorded checksum.');
  }
  return readBackup(id);
}

/** Check a backup end to end without restoring it. */
export async function verifyBackup(id) {
  const summary = await checkBackup(id);
  return { id, ok: true, documents: summary.documents, collections: summary.counts.size, consistency: summary.header.consistency };
}

/**
 * Delete backups older than the retention period (REQ-97: 7 days). The newest
 * backup is never removed, so expiry can never leave the system with none.
 */
export async function cleanupExpiredBackups(now = Date.now()) {
  const backups = await listBackups();
  const cutoff = now - retentionDays() * 24 * 60 * 60 * 1000;
  const removed = [];

  for (const [position, backup] of backups.entries()) {
    if (position === 0) continue;
    if (new Date(backup.created_at).getTime() >= cutoff) continue;
    await fs.unlink(paths(backup.id).data).catch(() => {});
    await fs.unlink(paths(backup.id).manifest).catch(() => {});
    removed.push(backup.id);
  }

  // Leftovers of an interrupted run.
  for (const name of await fs.readdir(backupDir()).catch(() => [])) {
    if (!name.endsWith('.tmp')) continue;
    const stat = await fs.stat(path.join(backupDir(), name)).catch(() => null);
    if (stat && now - stat.mtimeMs > 60 * 60 * 1000) await fs.unlink(path.join(backupDir(), name)).catch(() => {});
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

async function buildShadows(db, id, token) {
  const shadows = new Map(); // collection name -> shadow name
  let batch = [];
  let current = null;
  let currentShadow = null;

  const flush = async () => {
    if (batch.length && currentShadow) await db.collection(currentShadow).insertMany(batch, { ordered: true });
    batch = [];
  };

  await readBackup(id, async (record) => {
    if (record.type === 'collection') {
      current = record;
      currentShadow = `${SHADOW_PREFIX}${token}_${record.name}`;
      shadows.set(record.name, currentShadow);
      const options = { ...(record.options || {}) };
      delete options.uuid;
      await db.createCollection(currentShadow, options);
    } else if (record.type === 'doc') {
      batch.push(EJSON.parse(record.d, { relaxed: false }));
      if (batch.length >= BATCH) await flush();
    } else if (record.type === 'collection_end') {
      await flush();
      if (current.indexes?.length) await db.collection(currentShadow).createIndexes(current.indexes);
      current = null;
    }
  });

  return shadows;
}

/**
 * Restore the database to a retained backup. Throws before touching live data if
 * the backup is damaged. Resolves to a summary; `safetyBackupId` names the
 * automatic backup of the state that was replaced.
 */
export async function restoreBackup(id, { requestedBy = null } = {}) {
  await requireBackup(id);
  const release = await acquireLock('restore');
  const db = mongoose.connection.db;
  const token = crypto.randomBytes(4).toString('hex');
  let shadows = new Map();
  let maintenance = false;
  let swapStarted = false;
  let completed = false;

  try {
    // 1. Prove the backup is whole before anything is changed.
    const checked = await checkBackup(id);

    // 2. Keep a way back.
    const safety = await createBackupUnlocked({ trigger: 'pre-restore', createdBy: requestedBy });

    // 3. Stop writes while data is replaced.
    setMaintenanceMode(true);
    maintenance = true;
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 4. Build every collection beside the live one.
    shadows = await buildShadows(db, id, token);

    // 5. Swap, then remove collections the backup did not contain.
    // Persist the fence before the first rename, so restarting Node cannot
    // accidentally expose a database containing partially swapped collections.
    let previousMarker = null;
    try { previousMarker = JSON.parse(await fs.readFile(restoreMarkerPath(), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporaryMarker = `${restoreMarkerPath()}.${token}.tmp`;
    const marker = await fs.open(temporaryMarker, 'wx', 0o600);
    try {
      await marker.writeFile(JSON.stringify({ backup_id: id, safety_backup_id: safety.id,
        original_safety_backup_id: previousMarker?.original_safety_backup_id || previousMarker?.safety_backup_id || safety.id }));
      await marker.sync();
    } finally { await marker.close(); }
    await fs.rename(temporaryMarker, restoreMarkerPath());
    for (const [name, shadow] of shadows) {
      swapStarted = true;
      await db.collection(shadow).rename(name, { dropTarget: true });
    }
    shadows = new Map();

    const keep = new Set(checked.counts.keys());
    for (const info of await listUserCollections(db)) {
      if (!keep.has(info.name)) await db.dropCollection(info.name);
    }

    completed = true;
    await fs.unlink(restoreMarkerPath());
    return {
      restored_backup_id: id,
      safety_backup_id: safety.id,
      collections: checked.counts.size,
      documents: checked.documents,
      consistency: checked.header.consistency,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const failure = new ApiError(500, `The restore did not complete: ${error.message}`);
    failure.cause = error;
    throw failure;
  } finally {
    for (const shadow of shadows.values()) await db.dropCollection(shadow).catch(() => {});
    // Once a swap starts, a failure may have left collections from two moments.
    // Keep reads/writes unavailable until the operator restores the safety backup.
    if (maintenance && (!swapStarted || completed)) setMaintenanceMode(false);
    await release();
  }
}

// ---------------------------------------------------------------------------
// Status for the scheduler and the admin screen
// ---------------------------------------------------------------------------

const status = { lastSuccessAt: null, lastFailureAt: null, lastFailureMessage: null };

export const recordBackupSuccess = (at = new Date()) => {
  status.lastSuccessAt = at;
};
export const recordBackupFailure = (message, at = new Date()) => {
  status.lastFailureAt = at;
  status.lastFailureMessage = String(message).slice(0, 300);
};

export async function backupStatus() {
  const backups = await listBackups();
  return {
    enabled: backupsEnabled(),
    retention_days: retentionDays(),
    interval_hours: 24,
    last_success_at: backups[0]?.created_at ?? null,
    last_failure_at: status.lastFailureAt,
    last_failure_message: status.lastFailureMessage,
    count: backups.length,
  };
}
