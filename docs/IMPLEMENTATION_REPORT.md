# Implementation report - US-26 (#62), US-28 (#67), and US-29 (#68)

## US-29 continuation - 8 November 2026

The current acceptance map, implementation details, measured restore drill and
remaining standalone-MongoDB limitations are in [US29_ACCEPTANCE_REPORT.md](US29_ACCEPTANCE_REPORT.md).
That report supersedes the earlier US-29 findings. Existing working-tree changes
were retained and extended; nothing was committed or pushed.

Current checks: **407 backend unit tests passed; 375 MongoDB integration tests
passed, 1 snapshot-only test skipped; 89 frontend tests passed; production build
passed; lint 0 errors / 15 pre-existing warnings; Git whitespace check passed.** Final focused
recovery/goal and recovery/auth reruns passed 18 and 36 tests respectively; the final
recovery/CLI guard rerun passed 14 tests.
The local 1,000-document recovery drill measured **980 ms** in the full passing run;
this does not certify production RTO or receipt-file restoration.

The remaining literal acceptance gaps are documented rather than declared complete:
multi-document ACID isolation is unavailable on standalone MongoDB; recovery is a
durable offline compensation protocol with a fail-closed API fence. Production
RPO/RTO and the exception for confirmed privacy erasure remain bounded/open.

The sections below preserve the historical US-26/US-28 report and its old test
results; they are not the current US-29 run.

---

Status key: **Done** = implemented and covered by automated tests that were run.
**Done, needs deployment** = the application part is done and tested; a production
setting or infrastructure piece is still required. **Partial / deviation** = not as
literally worded; see the note and `DEVIATIONS.md`.

## 1. Phase 1 findings (what already existed)

Reused, not duplicated: `User.role` and `requireAdmin`; `Session` with `jti` and
revocation, 24-hour JWT in `authenticate`; bcrypt cost 12 in registration and reset;
the five-failure lockout; email verification; `AuditLog` + `recordAudit` (transactions
and a few events); signed attachment URLs (5 min), random object keys, storage outside
the web root, magic-byte checks; CSV formula-injection protection; the app lock and its
heartbeat; JSON export (REQ-87); the purge job; the `X-User-Id` dev header.

Missing: admin API/UI, a general audit trail (the old model required an entity and had no
retention), backups, rate limiting, security headers/HTTPS, input-injection guard,
field encryption, consent and privacy workflows, idle timeout, environment validation,
a way to become administrator.

Weaknesses found and fixed: any token without `exp` would have been accepted;
`DEV_AUTH_HEADER` was **on** in `.env.example` and worked whenever `NODE_ENV` was not
literally `production`; CORS allowed `*` when `CLIENT_ORIGIN` was unset; there was no rate limiting on
authentication and no source IP was recorded anywhere;
transaction audit entries held amounts and notes; the 404 handler echoed the request path;
the error handler answered malformed JSON with the message "Internal server error"; the test harness had an
index race (a failing baseline test).

## 2. US-26 - requirement map

| Req | Status | Implementation |
|---|---|---|
| **REQ-94** admin views counts and statuses | Done | `GET /api/admin/summary`, `GET /api/admin/users` (pagination, filters) - `routes/admin.js`, `services/adminService.js`, UI `AdminPage.jsx` |
| REQ-94 suspend / restore | Done | `POST /api/admin/users/:id/suspend|restore`; sessions revoked at once; sign-in blocked; `authenticate.js` also checks status on every request |
| REQ-94 admin-only on the backend | Done | `app.use('/api/admin', requireUser, ...)` + `requireAdmin` reads the role from the database; forged claims and the dev header fail (tests) |
| REQ-94 no financial data for admins | Done | allow-listed `users` projection only, no route to money; tests inspect real responses for amounts, balances, notes, hashes |
| **REQ-96** events recorded | Done | auth (success, failure, lockout, register, verify, reset, logout), rejected tokens, admin denials, exports (JSON, CSV, report CSV/PDF, portability), bulk deletions, admin actions, backups, privacy, security signals |
| REQ-96 actor, action, timestamp, IP | Done | `models/AuditLog.js`; IP from `req.ip` (not forgeable, `TRUST_PROXY`) |
| REQ-96 12-month retention | Done, needs deployment | `expires_at` >= 365 d + TTL index; relies on MongoDB's TTL monitor. Pre-existing records have no `expires_at` and are kept |
| REQ-96 users cannot read/modify | Done | no user route; model refuses update/delete; only `GET /api/admin/audit-logs` |
| REQ-96 no secrets / full notes / financial data | Done | `sanitizeForAudit`; transaction audits store field names; tests scan the trail |
| REQ-96 logging failures not silent | Done | admin actions and restore fail closed (503); others best effort with stderr JSON line, counter, shown on the overview |
| **REQ-97** automatic backup every 24 h | Done | `backupScheduler.js` (checks every 15 min against newest file age) |
| REQ-97 authenticated encryption | Done | chunked AES-256-GCM, per-file HKDF key, chunk index and final flag authenticated (`utils/backupCrypto.js`) |
| REQ-97 7-day retention + cleanup | Done | `cleanupExpiredBackups`; never removes the only/newest backup |
| REQ-97 restore from any retained backup, admin only | Done | API (password + `RESTORE`) and CLI; verify -> safety backup -> maintenance mode -> shadow collections -> swap |
| REQ-97 validation, errors, concurrency, consistency | Done | lock file + in-process lock, atomic file publish, snapshot reads on replica set (`best_effort` recorded on standalone), integrity checks, 422/409/404 mapping |
| REQ-97 "entire database" | Done for MongoDB | all collections and indexes; **receipt files on disk are not in it** (back up `UPLOAD_DIR`) |

## 3. US-28 - requirement map

| Req | Status | Implementation / note |
|---|---|---|
| SEC-1 HTTPS in production | Done, needs deployment | `enforceHttps` (308 / 426), health exempt; production start-up requires `TRUST_PROXY` |
| SEC-1 TLS 1.2+ | Done, needs deployment | `deploy/nginx.conf.example` - **not testable in this repo** |
| SEC-1 HSTS >= 1 year | Done | `max-age=31536000; includeSubDomains` from API and nginx example |
| SEC-1 dev still works | Done | enforcement defaults to production only |
| SEC-2 bcrypt >= 12 | Done | `bcryptRounds()` floor 12; registration, reset, app-lock PIN use it; no password-change endpoint exists in this codebase (US-25) - when added it must use `bcryptRounds()` |
| SEC-3 AES-256 for names, emails, notes, attachments | Done | `utils/crypto.js`, `fieldEncryption` plugin; blind index for email; migration script; key ring for rotation |
| SEC-3 **transaction amounts** | **Partial / deviation** | not encrypted by the application (see `SECURITY.md` 3.2, `DEVIATIONS.md` 11). **Decision needed from the team** |
| SEC-3 no hardcoded keys | Done | env only; secret-scan test |
| SEC-4 authenticate every protected request | Done | default-deny gate in `app.js`; public list is six auth routes, health, app-lock (self-authenticating), signed file links |
| SEC-4 **web client authenticates with the JWT only** | Done | the demo-user mechanism (`DEV_USER_KEY`, `pfem_dev_user_id`, `X-User-Id` fallback, "demo user id" forms, `userId` props/params) is removed from all 13 affected pages and the shared helpers (`auth.js`, `pageKit.js`, `receipts.js`, `ReceiptAttachments.jsx`); signed-out visitors see a sign-in prompt (`SignInRequired.jsx`); verified by `client/test/session-auth.test.js`, `pages-render.test.js` and a run against the real server |
| SEC-4 signed JWT, 24 h, 401 | Done | HS256 only, `exp` required, `maxAge` 24 h, `none`/other algs/tampered/expired rejected |
| SEC-5 ownership / IDOR | Done (verified, not rewritten) | existing services scope by `user_id`; new tests across accounts, transactions, categories, budgets, goals, attachments, listings. Other resources were reviewed by pattern, not individually tested (tags, recurring rules, reminders, notifications are covered through listing leakage checks) |
| SEC-6 server-side validation | Done | existing validators + `inputGuard` + 4xx on malformed JSON |
| SEC-6 NoSQL operator injection | Done | `$`/`.` keys rejected in body and query; encrypted-field filters throw rather than match nothing |
| SEC-6 XSS / output encoding | Done | JSON only, `nosniff`, strict API CSP; React escapes; client scanned for HTML sinks; files served `sandbox` |
| SEC-6 CSP | Done, needs deployment | API: `default-src 'none'`; client CSP in `deploy/nginx.conf.example` (set where the client is served) |
| SEC-6 CSRF | Done | bearer token + no cookies + `Origin` allow-list for writes |
| SEC-6 cookie flags | N/A | no cookies are used; documented |
| SEC-6 CORS | Done | allow-list, no `*`, no credentials; production requires explicit https origins |
| SEC-6 secure headers | Done | HSTS, nosniff, frame-deny, referrer, permissions-policy, COOP/CORP, no-store, no `X-Powered-By` |
| SEC-7 100/min/IP global | Done | in-memory (see deviation 15) |
| SEC-7 10/min/account auth | Done | register, verify, resend, login, both reset endpoints; 429 + `Retry-After` |
| SEC-7 no forwarded-IP trust | Done | `trust proxy` only for configured hops; spoofing tested |
| SEC-8 30-min client timeout | Done | `sessionGuard.js`, `sessionPolicy.js` |
| SEC-8 2-min app lock preserved | Done | untouched; existing app-lock tests pass |
| SEC-8 server enforcement | Done | `Session.last_activity_at`; heartbeat does not count |
| SEC-9 no bank/card credentials | Done | field-name guard on every request; no model field; client scanned. Note: it blocks by **field name**; it cannot stop a person typing a card number into a free-text note |
| SEC-10 type/size validation, malicious files | Done | extension + type + magic bytes + structure + active content + markers; 5 MB; not antivirus |
| SEC-10 storage, keys, signed URLs, ownership | Done | outside web root, 128-bit names, encrypted, <= 15 min (hard cap), owner and status checked, audited refusals |
| SEC-11 secure logging, no leaks | Done | see REQ-96; generic errors; request path no longer echoed; dev mail console is dev-only and refused in production |
| SEC-12 secrets | Done | env only; start-up validation; `.env.example` placeholders; `.env` ignored; backups ignored; scan tests |
| SEC-13 consent at registration | Done | separate required checkbox/field, versioned, time, IP, purposes |
| SEC-13 access / correction / portability / erasure | Done (scope noted) | `routes/privacy.js`; **email change excluded**; backups age out within 7 days |
| SEC-13 legal compliance | **Not claimed** | notice text, grievance officer, breach notification, children's data are organisational duties (`SECURITY.md` 3.9) |

## 4. Files

**New (server):** `config/security.js`, `config/privacy.js`, `utils/crypto.js`, `utils/backupCrypto.js`,
`models/plugins/fieldEncryption.js`, `middleware/{securityHeaders,inputGuard,rateLimit,maintenance}.js`,
`routes/{admin,privacy}.js`, `services/{adminService,privacyService,backupService,backupScheduler,encryptionMigration}.js`,
`scripts/{migrate-encryption,promote-admin,backup-cli}.js`.

**New (client):** `AdminPage.jsx`, `PrivacyPage.jsx`, `SignInRequired.jsx`, `sessionGuard.js`, `sessionPolicy.js`; tests `session-policy`, `session-auth`, `pages-render`.

**New (other):** `deploy/nginx.conf.example`, `docs/{SECURITY,BACKUP_AND_RESTORE,API-US26-US28,TESTING-US26-US28,IMPLEMENTATION_REPORT}.md`.

**New (tests):** `security-unit`, `secret-scan`, `admin-audit.integration`, `backup.integration`,
`security.integration`, `rate-limit.integration`, `transport.integration`, `privacy.integration`,
`helpers/auth.js`, `client/test/session-policy.test.js`.

**Modified (server):** `app.js`, `index.js`, `package.json`, `.env.example`; middleware `authenticate.js`,
`currentUser.js`; models `User`, `Session`, `AuditLog`, `Transaction`, `Transfer`, `RecurringRule`,
`Attachment`; routes `auth`, `attachments`, `data`, `reports`, `transactions`; services `auditService`,
`transactionService`, `attachmentService`, `storageService`, `recycleBinService`, `appLockService`;
`utils/signedUrl.js`, `validators/file.js`.

**Modified (client):** `App.jsx` (consent checkbox, nav, sign-out notice), `Root.jsx` (routes), `main.jsx`; and, to remove the demo-user mechanism, `auth.js`, `pageKit.js`, `receipts.js`, `ReceiptAttachments.jsx` and the pages `AccountsPage`, `BudgetsPage`, `CategoriesPage`, `ChartsPage`, `DashboardPage`, `ImportExportPage`, `ReportsPage`, `TotalsPage`, `TransactionsPage`, `BillRemindersPage`, `RecurringPage`, `SavingsGoalsPage`. Also `TransactionsPage` and `receipts.js` now follow `VITE_API_URL` instead of a hard-coded `http://localhost:5000` (a deployed client would otherwise have called the wrong host).

**Modified (project):** `.gitignore`, `README.md`, `DEVIATIONS.md`.

**Modified (existing tests; none deleted):** see `TESTING-US26-US28.md`, "Changes to existing tests".

## 5. Test results (actually run)

| Suite | Result |
|---|---|
| Server unit | 386 / 386 |
| Server integration (MongoDB 7.0.34, replica set) | 360 / 360 |
| Client unit | 84 / 84 |
| Real server process, 24 page endpoints | 23 x 200 with token, 1 x 403 (admin, non-admin user); all 401 without |
| Client lint | 0 errors, 15 warnings (unchanged from before) |
| Client build | OK |

Details and what was *not* run: `TESTING-US26-US28.md`.

## 6. Known limitations and open decisions

1. **Amounts are not encrypted by the application** - decide: encrypted storage only (current),
   Queryable Encryption, or rewrite aggregations.
2. **Rate limits are per process.** Shared store needed for more than one instance.
3. **TLS/HSTS/CSP for the client are configuration** (`deploy/nginx.conf.example`), verified only by
   simulated proxy headers, not against a real certificate or scanner.
4. **Backups:** recovery point up to 24 h; consistent snapshot needs a replica set; receipt files are
   separate; keys must be kept off the backup host; restore is not atomic across collections (safety
   backup is the recovery path); not tested on sharded clusters or very large databases.
5. **Audit trail** resists the application, not a database administrator; no external log shipping.
   Old records lack `expires_at`.
6. **Search over notes** is in memory after decryption.
7. **Token in `localStorage`** (existing design).
8. **Content screening, not antivirus;** receipts remain on the API server's disk.
9. **Privacy:** no email-change flow; legal/organisational duties remain.
10. **Not done:** nothing was exercised in a real browser (every page was server-rendered signed in and out, and the client was built, linted and unit tested); no penetration test; no
    `npm audit`; CI does not run integration tests; no password-change endpoint exists to harden.
11. **Behaviour changes teammates will notice:** registration needs `dataProcessingConsent`;
    `ENCRYPTION_KEY` is required to start; `DEV_AUTH_HEADER` is off in the example and no web page uses it any more (sign in with `demo@pfem.local` / `Demo@12345` from `npm run seed:dev`, or register); user lookups by
    regex on `email`/`name` are impossible (use exact email); `User.find({ name: ... })` throws;
    `lean()` and aggregation results are decrypted for `User`, `Transaction`, `Transfer`,
    `RecurringRule`, `Attachment` but **raw `collection.find()` returns ciphertext**.

## 7. Deployment (summary - full steps in `SECURITY.md` section 4)

1. MongoDB replica set with encryption at rest.
2. Generate and store secrets; `NODE_ENV=production`; `TRUST_PROXY=1`; `CLIENT_ORIGIN=https://...`.
3. nginx from `deploy/nginx.conf.example`; API bound to `127.0.0.1`.
4. Take a backup, then `npm run migrate:encryption -- --dry-run`, then for real.
5. `npm run admin:promote -- you@example.com`.
6. Back up `UPLOAD_DIR` and copy `BACKUP_DIR` off the host; keep keys elsewhere.
7. Publish the privacy notice and set `PRIVACY_POLICY_VERSION`.

## 8. Final-review addendum: web client authentication

A review found that the web client still contained the Sprint 1 demo-user mechanism
(`DEV_USER_KEY`, `pfem_dev_user_id`, an `X-User-Id` fallback in `authHeaders`, and
"demo user id" forms on eleven pages). It worked only because the server still accepted
the header in development, and it contradicted SEC-4. It has been removed.

What changed: `authHeaders()` and `makeApi()` take no arguments and send only
`Authorization: Bearer <token>`; `attachmentRequest`/`uploadAttachment`/`ReceiptAttachments`
no longer carry a user id; every page shows a shared sign-in prompt when nobody is signed
in (`SignInRequired`), and the pages that previously had none (`SavingsGoalsPage`,
`AdminPage`, `PrivacyPage`) now do. `npm run seed:dev` now tells developers to sign in with
the demo account and records its consent. The server's `DEV_AUTH_HEADER` bypass was **not**
changed in behaviour (only its comment); it is covered by new tests proving it is off by
default, ignored in production and never grants admin.

Not changed, deliberately: the server keeps the development-only header because about
thirty server integration suites authenticate with it (`DEVIATIONS.md`, deviation 1,
"Remaining"). Removing it means rewriting those suites to use real sessions.
