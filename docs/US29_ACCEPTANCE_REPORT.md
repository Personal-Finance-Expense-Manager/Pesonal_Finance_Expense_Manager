# US-29 acceptance report

Reviewed and tested on 8 November 2026, on `feature/US-29-safety-requirements`.
Acceptance text comes from the SRS and issue #68 shown in the supplied screenshots.
Existing working-tree edits were preserved. Nothing was committed or pushed.

## Acceptance matrix

| Criterion | Result | Evidence and limits |
|---|---|---|
| SAF-1: no investment, tax, insurance, credit advice or product recommendations | Implemented; source reviewed | Recorded-data reporting and arithmetic only; shared financial disclaimer. No recommendation service was found. This is not a claim that every possible text output was formally proved safe. |
| SAF-2: explain every projection | Implemented for the displays found | Savings goal monthly requirements, spending report projections and exported report PDFs explain that they are arithmetic estimates from recorded data, not guarantees. Client build and server-rendered page tests passed; no browser or PDF visual inspection was performed. |
| SAF-3: named confirmation, soft deletion, 30-day recovery | Implemented for ordinary deletions; policy exception remains | Existing transaction/transfer recycle bin plus new recovery for accounts, budgets, categories, goals, receipts, reminders and recurring rules. Histories and receipt files are retained. Expiry and cross-owner refusal are tested. Privacy account erasure remains an explicitly confirmed permanent operation; this exception needs product acceptance. Recovery cannot recreate records permanently deleted by older versions. |
| SAF-4: encrypted daily backups, seven days, RPO 24 h, RTO 4 h | Local restore target demonstrated; operational acceptance remains partial | Encryption/integrity/retention tests pass. Retention cannot be configured below seven days. Scheduler starts at 23h45m to allow for the 15-minute poll interval. The measured local restore drill passed; production scale, outages, storage failure, file receipts and the whole recovery procedure are not certified. Standalone backup consistency remains `best_effort`. |
| SAF-5: failed/interrupted transfers, savings and imports leave no partial financial record | Durable compensation implemented; strict atomicity remains partial | Transfers remain a single document. Savings/imports now write a durable journal before financial changes. Real child-process termination, cleanup failure, lost acknowledgement and repeated recovery are tested. Affected users are blocked with 503 while the journal is unresolved. Offline reconciliation restores pending operations or finalises committed ones. This is not ACID isolation or immediate rollback during an outage. |
| SAF-6: unavailable instead of stale balances | Implemented on reviewed paths; bounded verification | Accounts/Dashboard clear figures during recomputation and discard older responses. Failed/missing transaction totals show `Unavailable`, not zero. Unresolved operations block financial API requests; interrupted restore swaps leave maintenance mode on. Requests admitted before a journal exists and cross-tab freshness are not globally serialised. No browser fault-injection run was performed. |
| SAF-7: warning before irreversible actions | Implemented on reviewed destructive flows | Ordinary delete confirmations name the target and explain 30-day recovery. Existing privacy erasure names all data and requires password plus typed DELETE. Transaction expiry/permanent purge is explained before deletion. No new manual permanent-purge endpoint was introduced. |
| SAF-8: no other-user/admin financial exposure | Application controls tested; scope bounded | Full ownership/admin integration suites pass. New recovery queries are owner-scoped, return an allow-list, reject unknown types and do not expose object keys or raw documents. Another user's pending journal does not block or expose data. This does not constrain a privileged database operator or prove absence of all possible vulnerabilities. |

US-29 must not be described as fully satisfying the literal SRS: SAF-4 has operational
limits, SAF-5 does not provide multi-document ACID isolation on standalone MongoDB,
and the erasure exception to SAF-3 requires explicit acceptance.

## Durable recovery on standalone MongoDB

`FinancialOperation` has a unique owner index, no TTL, and journaled write concern.
It holds IDs, operation state and an exact decimal delta, not CSV contents or notes.
The intent is acknowledged before the associated financial writes begin.

- Contributions/withdrawals place an operation ID on the goal in the same atomic
  update as its amount and completion status. The ledger ID is assigned in advance.
  Pending recovery removes that ledger record and reverses the goal delta only if
  the operation marker still matches, clearing the marker in that same update.
  Repeating recovery does not apply the reversal twice.
- Imports persist their transaction, transfer and tag-link IDs before each batch.
  Pending recovery removes exactly those financial records, including partially
  acknowledged ordered inserts. Unused tag definitions may remain; recovery does
  not delete pre-existing or shared tags.
- Successful operations persist a committed decision before journal cleanup.
  Recovery of a committed operation retains financial records and clears its marker.
- Only one savings/import journal per user can exist. Acquisition failure stops
  before the financial callback. Financial API requests return 503 while a journal
  exists, and recurring generation skips an affected user when it observes one.
- If cleanup fails, the journal stays in MongoDB. The API does not silently serve
  known-incomplete financial data. The goal routes now preserve the 503 and the
  reconciliation message rather than turning the error into a generic 500.

This is a recoverable compensation protocol, not a distributed transaction. It does
not make all concurrent financial routes serialisable, promise exactly-once delivery
after a lost HTTP response, roll back while MongoDB is unreachable, or recover from
loss of the database/journal itself. A process crash can leave the user unavailable
until an operator completes recovery. Direct DB readers bypass the API fence.

Offline procedure (documented and tested with isolated fixtures; **not executed on
the development database**):

1. Stop **every** API and scheduler instance writing this database.
2. Run `node scripts/reconcile-financial.js` from `server` for a read-only inventory.
3. Review it, then run
   `node scripts/reconcile-financial.js --apply --all-writers-stopped`.
4. Check account/goal figures and restart services only after reconciliation succeeds.

The apply command refuses to start without the explicit offline acknowledgement;
the script cannot itself verify that other machines/processes have stopped. Recovery
is deliberately not automatically applied to journals that may still be active.

## Recovery lifecycle

`/#/recovery`, linked from the shared footer, lists recoverable non-transaction
resources. `GET /api/recovery` and `POST /api/recovery/:resource/:id/restore` require
the signed-in owner. Transactions/transfers retain their existing recycle-bin UI.

Soft-deleted resources are hidden from normal model reads and aggregations. Historical
category and goal ledger relationships are kept instead of being rewritten. Funded
goals can now be recovered without refunding or deleting their ledger history.
Accounts with financial history still require archiving rather than deletion.

Restoration checks the 30-day boundary and required account/category/transaction
dependencies, attachment capacity, and active account/category/budget conflicts.
Restored recurring rules are **paused** so restoration does not unexpectedly generate
payments; legacy `status=deleted` recurring rules are also discoverable. Restore the
parent transaction before its attachment, within that parent's recovery window.

Non-transaction tombstones have no TTL and are not automatically purged by this
change: retaining referenced history is safer than cascading destruction. The UI
recovery window still ends after 30 days. Existing transaction expiry continues to
purge its children/files; its file lookup now includes independently deleted receipt
records. Privacy erasure removes both active and tombstoned records and receipt files.
Deleting a category now retains its associations instead of the old REQ-40 reassignment
to Uncategorized; this safety-driven behavior change is recorded in `DEVIATIONS.md`.

## Database isolation and actual tests

The inspected development URI selected local database **pfem**. `TEST_MONGO_URI`
was unset. Credentials and secret values were not printed.

`npm run test:integration:isolated` now generates a random name of the form
`pfem_us29_test_<24 hex characters>`, connects to that name, verifies it does not
already exist, and creates an ownership marker. The suite receives that exact name
and run token. Every integration bootstrap checks them before any reset or cleanup,
including the separate auth/app-lock bootstraps. A generic name containing `test`
is no longer sufficient. File storage/backups use temporary directories and keys;
verification uses a fresh test secret and SMTP is disabled by the runner. The runner
does not start MongoDB, configure topology, reset development data, or remove the
test database after the run.

| Executed check | Result |
|---|---|
| Backend default suite | **407 passed, 0 failed** |
| Full isolated MongoDB integration suite | **375 passed, 0 failed, 1 skipped** (376 tests) |
| Focused recovery + goal integration rerun | **18 passed, 0 failed** |
| Focused recovery + auth bootstrap integration rerun | **36 passed, 0 failed** |
| Final recovery/CLI guard integration rerun | **14 passed, 0 failed** |
| Frontend suite | **89 passed, 0 failed** |
| Frontend production build | Passed |
| Frontend lint | 0 errors, 15 pre-existing warnings; RecoveryPage warning fixed in final pre-commit review |
| Git diff whitespace check | Passed |

The full passing run used `pfem_us29_test_e8fea1acb27bbd0430098489`. Later focused
runs also used independently allocated databases. Test databases and temporary
artifacts were retained. The one skipped integration test requires snapshot isolation
under concurrent writes; it is explicitly unavailable on standalone MongoDB. POSIX
file-mode assertions are not applicable on Windows; Windows ACLs were not validated.

The initial full run exposed two app-lock timing assertions, the old expectation of
permanent receipt deletion, and missing registration-test secret setup. These were
corrected: expiry is checked after the request, the receipt test verifies retained
file/recovery/revoked URL, and the isolated runner supplies ephemeral test secrets.
A new recurring-rule test fixture also needed its required `anchor_date`; that fixture
was corrected. The final results above are actual reruns, not inferred successes.

## Measured recovery-time drill

The full passing run measured **980 ms** for backup verification, safety backup,
restore, and exact equality of a 1,000-document fixture (including Decimal128 values).
The restored backup had **1,006 documents** in total. The four-hour threshold was
14,400,000 ms; the test compares the measured duration to that threshold. Backup
consistency was explicitly **best_effort**, with idle fixture writers.

Other measured local runs ranged from 944 ms to 4,929 ms. These are real timings,
not mocked clocks. A separate integration test interrupts the second collection
rename after the first succeeds, verifies maintenance stays on, then restores the
pre-restore safety backup and verifies maintenance ends. A persistent
restore marker retains that fence across Node restarts; startup schedulers remain
off while it exists. The test also discards the process-local flag and verifies
that the on-disk fence still holds.

This proves the tested local fixture restored within four hours. It does not certify
production dataset size, disks, off-host retrieval, key recovery, staff response time,
receipt-file restoration, or a four-hour recovery after arbitrary host failures.
Receipts still require the separate filesystem backup procedure. Seven-day retention
can be extended by configuration, and the last backup is preserved even when old.
Polling headroom reduces scheduling delay but cannot promise a 24-hour RPO through
outages or arbitrarily long backup jobs.

No development database reset, replica-set configuration, secret disclosure,
commit, push, GitHub issue edit, or external message was performed.

## Final pre-commit review

The RecoveryPage mount effect now starts its request without synchronously resetting
state that was already initialised, and cancels the request on unmount. Its new lint
warning is resolved without suppression. After this narrow fix: frontend 89/89,
production build passed, lint 0 errors / 15 pre-existing warnings, secret-scan
9/9, and Git whitespace check passed. Backend 407/407 and integration 375 passed /
1 snapshot-only skip are the completed prior runs; the frontend-only fix did not
require rerunning database suites. Nothing is staged, committed or pushed.

The empty untracked root file `dir` predates this work and has no Git history. Its
creation/last-write timestamp is 8 November 2026, 07:43 UTC (13:13 IST). There is no
evidence identifying its creating command or process, so it is not confirmed to be
accidental. It has no US-29 role, was left untouched, and should be excluded when
staging. The acceptance report itself is still
untracked and must be explicitly included with the new implementation/test files.
Environment files, local database/storage files, backups, logs and production build
output are excluded from the change inventory; the tracked `.env.example` remains
an unchanged template. No real credentials or generated secret values were found
in the reviewed source changes.

The follow-up approval review also corrected a narrow RecoveryPage bug: refresh
errors after restoration now reach the outer error handler rather than being
overwritten by a success message; the paused-rule notice is shown only for rules.
Root's lazy recovery route remains inside AppLockGate and Suspense. Fresh checks
after this correction: frontend 89/89, relevant backend safety/goal/secret-scan
tests 30/30, production build passed, lint 0 errors / 15 pre-existing warnings,
and whitespace check passed. All 14 new US-29 files are intentional; `dir` is the
only unrelated untracked item. No sensitive or generated runtime artifacts were
found in the changed-file inventory. No staging, commit, push or data deletion
was performed.
