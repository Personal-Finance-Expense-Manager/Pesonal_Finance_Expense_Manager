# Backups and restoration - US-26 (#62), REQ-97

## What you get

- An **automatic backup every 24 hours** while the API runs (`BACKUP_ENABLED`, default on).
- Each backup is **encrypted with AES-256-GCM** (authenticated; a changed, reordered or
  truncated file is rejected) under `BACKUP_ENCRYPTION_KEY`, with a fresh key derived per file.
- **Seven-day retention**: older backups are deleted automatically. The newest backup is
  never deleted, so expiry can never leave you with none.
- **Restore from any retained backup**, administrators only, after re-entering the
  administrator's password and typing `RESTORE`.
- Verification without restoring, a lock so backup and restore never overlap, and an audit
  record of everything.

## What a backup contains - and does not

**Contains:** every collection in the application database (found at run time, so new
models are included automatically), every document with its exact BSON types
(ObjectId, Date, Decimal128), and every index definition (unique, partial, TTL).
Encrypted fields stay encrypted inside the backup, so restoring needs the same
`ENCRYPTION_KEY` as the data it came from.

**Does not contain:**

| Not included | What to do |
|---|---|
| Uploaded receipt files (`UPLOAD_DIR`, on disk, not in MongoDB) | Back up the directory with your normal file/volume snapshot. The files are already encrypted at rest (`PFEMENC1`), so a copy is safe to store. A database restore does not delete or restore files: attachment records point at files by key, so restoring to an older backup can leave orphan files (harmless) or records whose file was deleted since (the API returns 404 for that file). |
| `.env` / secrets | Keep in your secret manager. **Keep `ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY` somewhere other than the backup directory.** |
| Anything outside the application database | - |

This is a logical, application-level backup. It is **not** a replacement for storage
snapshots or Atlas continuous backup if you need point-in-time recovery or an
hour-level recovery point. The recovery point of this feature is up to 24 hours.

## Consistency

| Deployment | Result recorded in the backup |
|---|---|
| Replica set (recommended, and what Atlas gives you) | `snapshot` - one point-in-time view across all collections, even while users write |
| Standalone `mongod` (the default local install) | `best_effort` - collections are read one after another; writes during the dump can leave collections slightly out of step (for example a transaction without the balance change). Fine for development; run a replica set in production. The server logs a warning when it falls back. |

If a dump runs longer than MongoDB's snapshot window
(`minSnapshotHistoryWindowInSeconds`, 300 s by default) it is retried as `best_effort`
rather than failing. Very large databases should use `mongodump`/Atlas snapshots.

## Configuration

```
BACKUP_ENCRYPTION_KEY=<32 random bytes, 64 hex chars>   REQUIRED; differs from ENCRYPTION_KEY
BACKUP_DIR=/var/backups/pfem                             default: server/backups (git-ignored)
BACKUP_RETENTION_DAYS=7                                  default 7
BACKUP_ENABLED=true                                      false on instances that must not run it
```

- `BACKUP_DIR` must not be inside `UPLOAD_DIR` or anything a web server serves. Files
  are created `0600`, the directory `0700`. Put it on a different disk from MongoDB and
  copy it off the host (object storage with versioning, another region).
- Without `BACKUP_ENCRYPTION_KEY` the API starts but runs **no** backups and says so
  at start-up. In production, start-up fails instead.
- Several API instances sharing one `BACKUP_DIR` take turns (lock file). Set
  `BACKUP_ENABLED=false` on all but one if you prefer.
- The job checks every 15 minutes and backs up when the newest backup is >= 24 h old,
  so a restart neither skips a day nor causes a burst.

## Operating it

From the admin screen (`/#/admin`, Backups) or:

```
GET  /api/admin/backups                       list + job status
POST /api/admin/backups                       back up now
POST /api/admin/backups/:id/verify            decrypt and check, change nothing
POST /api/admin/backups/:id/restore           { "confirm": "RESTORE", "password": "<your password>" }
```

Without the API (disaster recovery - the API need not be running):

```
cd server
npm run backup -- create
npm run backup -- list
npm run backup -- verify  pfem-backup-20261106T020000Z-ab12cd34
npm run backup -- restore pfem-backup-20261106T020000Z-ab12cd34 --yes
npm run backup -- cleanup
```

**Stop the API before a CLI restore.** Maintenance mode (503 to everyone) only exists
inside the process that performs the restore, so a separate API process would keep
serving while data is replaced.

## How a restore works, and what can go wrong

1. The whole file is decrypted and checked first: every authentication tag, the header,
   each collection's document count, the footer, and the checksum recorded when the
   backup was made. **A damaged, truncated, tampered or wrong-key backup is rejected
   before anything changes** (HTTP 422).
2. A **safety backup** of the current data is taken (`trigger: pre-restore`). If the
   restore turns out to be a mistake, restore that one.
3. The API answers **503** to everything except `/api/health` while data is replaced.
4. Each collection is rebuilt in a shadow collection together with its indexes. A
   problem here (for example a unique-index violation) aborts with the live data
   untouched.
5. Only when every shadow is complete are they swapped in (`renameCollection` with
   `dropTarget`). Collections that did not exist in the backup are dropped.

Limits to know about:

- Step 5 is fast but **not one atomic operation across collections**. If the process
  is killed during it, the database can hold a mix of old and restored collections.
  Recovery: restore the safety backup (or the same backup again) with the CLI.
- **Everything written after the backup is lost**, including users who registered,
  transactions entered and audit records written since. Users created after the backup
  no longer exist. The restore's own record (`admin.backup_restored`) is written into
  the restored database; the "started" record lives only in the safety backup.
- **Sessions come from the backup.** An administrator whose session was created after
  the backup is signed out and must sign in again (their account is in the backup if it
  existed then).
- **Erasure requests** made after the backup are undone by restoring it (the erased
  person's data returns). Re-apply erasures after any restore; keep a log of them.
- The restore needs enough free disk for a full second copy of the data while shadows
  are built.
- Restores are not tested against sharded clusters (`renameCollection` is unsupported
  on sharded collections).

## Verifying your backups regularly

US-29 adds a repeatable **isolated** restore drill. From `server`, run:

```text
npm run test:integration:isolated -- test/backup.integration.test.js
```

The runner allocates a fresh database, verifies that it did not already exist,
and supplies temporary directories and keys. It never targets the development
database and does not configure MongoDB. The drill measures verification, the
safety backup, restore and exact equality of a 1,000-document fixture. Its test
diagnostic contains the real elapsed milliseconds. It excludes filesystem receipts,
off-host retrieval and operator response; see `US29_ACCEPTANCE_REPORT.md` for the
actual results and limits. Snapshot-only concurrency testing is skipped on standalone
MongoDB, while best-effort backup/restore tests execute.

If a restore fails **after collection swaps begin**, the API now remains in
maintenance mode. Stop all writer instances and use the CLI to restore the
pre-restore safety backup before resuming service. Do not merely clear maintenance
mode on a partially restored database. A durable `.restore-incomplete.json` marker in `BACKUP_DIR` keeps the API and
startup schedulers unavailable across process restarts. It records the original
safety-backup ID and is removed only after successful recovery. Keep every writer
offline until recovery is verified.

An unrestored backup is a hope, not a backup. Monthly: restore the newest backup into
a **separate** database (point a copy of the API at a scratch `MONGO_URI` with the same
keys), sign in, and check data. `POST /api/admin/backups/:id/verify` checks integrity
only, not that your application is happy with the data.

## Key loss and rotation

- Lose `BACKUP_ENCRYPTION_KEY` and every backup made with it is unreadable. There is no
  recovery path by design.
- To rotate: set the new key, take a new backup, and let old ones expire (7 days). Old
  backups cannot be read with the new key; keep the old key until they have expired if
  you might still need them.
