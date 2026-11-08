# Security - US-28 (#67) and US-26 (#62)

This document describes how PFEM addresses OWASP Top 10 hardening (SEC-1 to
SEC-13) and the administration / audit requirements (REQ-94, REQ-96, REQ-97):
what is implemented, where, what depends on how you deploy it, and what is **not**
claimed. Adding these controls does not make the system "OWASP compliant" and
does not make it legally DPDP-compliant; the checklist at the end lists what
remains your responsibility.

See also: [`BACKUP_AND_RESTORE.md`](BACKUP_AND_RESTORE.md),
[`API-US26-US28.md`](API-US26-US28.md), [`TESTING-US26-US28.md`](TESTING-US26-US28.md),
[`IMPLEMENTATION_REPORT.md`](IMPLEMENTATION_REPORT.md).

---

## 1. Control summary

| Req | Control | Where | Depends on deployment? |
|---|---|---|---|
| SEC-1 | HTTPS enforced (308 redirect for GET, 426 for writes), HSTS >= 1 year, TLS 1.2+ | `middleware/securityHeaders.js`, `deploy/nginx.conf.example` | **Yes** - TLS is terminated by your proxy |
| SEC-2 | bcrypt, cost >= 12 (cannot be configured lower) | `config/security.js`, `routes/auth.js`, `services/appLockService.js` | No |
| SEC-3 | AES-256-GCM for name, email, mobile, notes, attachment bytes and names | `utils/crypto.js`, `models/plugins/fieldEncryption.js` | Key management: yes. **Amounts: see 3.2** |
| SEC-4 | Every `/api` route authenticated by default; HS256 JWT, 24 h, `exp` required | `app.js` (gate), `middleware/authenticate.js` | No |
| SEC-5 | Ownership enforced in every query by `user_id` from the session | existing services + `test/security.integration.test.js` | No |
| SEC-6 | Input guard, NoSQL-operator rejection, validators, CSP, headers, CORS allow-list, CSRF origin check | `middleware/inputGuard.js`, `middleware/securityHeaders.js` | CSP for the **client** is set by the proxy |
| SEC-7 | 100 req/min/IP global; 10 req/min/account on auth endpoints; 429 + `Retry-After` | `middleware/rateLimit.js` | **Single process** (see 3.5) |
| SEC-8 | 30-min inactivity: browser timer **and** server-side session expiry | `client/src/sessionGuard.js`, `authenticate.js` | No |
| SEC-9 | Card/CVV/UPI-PIN/bank-password fields refused; no model has such a field | `middleware/inputGuard.js` | No |
| SEC-10 | Type, size, content screening; encrypted at rest; random keys; outside web root; signed URLs <= 15 min; owner check | `validators/file.js`, `services/storageService.js`, `routes/attachments.js` | No |
| SEC-11 | Auth/authz/export/admin events logged; no secrets or notes; generic errors | `services/auditService.js`, `app.js` error handler | No |
| SEC-12 | Secrets from env only; start-up validation; `.env` ignored; placeholders in `.env.example` | `config/security.js`, `.gitignore`, `test/secret-scan.test.js` | Supply real secrets |
| SEC-13 | Explicit consent; access, portability, correction, erasure | `routes/privacy.js`, `services/privacyService.js` | Organisational duties remain |
| REQ-94 | Admin user list, counts, suspend/restore; no financial data | `routes/admin.js`, `services/adminService.js` | No |
| REQ-96 | Audit trail, append-only, 12-month TTL, fail-closed for admin actions | `models/AuditLog.js`, `services/auditService.js` | MongoDB TTL monitor |
| REQ-97 | Daily encrypted backup, 7-day retention, verified restore | `services/backupService.js`, `services/backupScheduler.js` | Replica set recommended |

---

## 2. Required configuration

All in `server/.env` (see `server/.env.example`; every name is documented there).
In production the server **refuses to start** if any of these is missing, weak, a
placeholder, or switched on when it must not be (`config/security.js`).

| Variable | Purpose |
|---|---|
| `JWT_SECRET`, `EMAIL_VERIFICATION_SECRET` | 32+ random characters each |
| `ATTACHMENT_URL_SECRET`, `APP_LOCK_SECRET` | separate 32+ character secrets (production) |
| `ENCRYPTION_KEY` | 32 random bytes (64 hex): data at rest |
| `BLIND_INDEX_KEY` | 32 random bytes; **never change it** (production) |
| `BACKUP_ENCRYPTION_KEY` | 32 random bytes, different from `ENCRYPTION_KEY` |
| `CLIENT_ORIGIN` | exact `https://` origin(s); no `*` |
| `TRUST_PROXY` | proxy hops in front of the API (usually `1`) |
| `DEV_AUTH_HEADER`, `DEV_EMAIL_CONSOLE` | must be off in production |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Use a secret manager (AWS Secrets Manager, GCP Secret Manager, Vault, Doppler...)
to inject these as environment variables. The application only reads
`process.env`; it does not care how they got there.

**Key custody.** `ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY` must be stored
somewhere other than the database server and the backup directory. A backup
whose key lives beside it is not protected. Losing `ENCRYPTION_KEY` makes
encrypted data permanently unreadable; there is no recovery.

**Rotating `ENCRYPTION_KEY`.** Set a new `ENCRYPTION_KEY` with a new
`ENCRYPTION_KEY_ID`, and move the old one to `ENCRYPTION_KEYS_PREVIOUS=oldId:oldKey`.
New writes use the new key; old data stays readable. Re-encrypting old records
under the new key is not automated (the migration skips already-encrypted
values); until you do, keep the old key listed. `BLIND_INDEX_KEY` is separate
precisely so that rotating the encryption key does not break email lookups.

---

## 3. Notes on specific requirements

### 3.1 Authentication (SEC-4)

- `app.js` puts a gate in front of every `/api` route. Only `/api/health`,
  `/api/auth/*` (register, verify, resend, sign-in, password reset, sign-out),
  `/api/app-lock/*` (these authenticate themselves, because lock state belongs to
  the session) and signed attachment links are exempt. A router added later
  without its own check is closed by default.
- A token must be HS256, signed with `JWT_SECRET`, carry `exp`, be younger than
  24 hours, and match a non-revoked, non-idle `Session` record. `alg: none`, other
  HMAC algorithms, missing `exp` and old tokens with a long `exp` are rejected 401
  (`test/security.integration.test.js`).
- The role is read from the stored user, never from the token.
- **Every web page authenticates with the session JWT only** (`Authorization: Bearer`,
  `client/src/auth.js`). The earlier "demo user id" boxes, the `pfem_dev_user_id`
  storage key and the client-side `X-User-Id` fallback have been removed, and
  `client/test/session-auth.test.js` fails if they return. A signed-out visitor
  sees a sign-in prompt on every page.
- The server still accepts `DEV_AUTH_HEADER` / `X-User-Id`, but only when it is
  explicitly switched on and never in production; it is off by default, is never an
  administrator, and production refuses to start with it on. It exists only for the
  server's own integration suites and local scripts (`DEVIATIONS.md`, deviation 1).

### 3.2 Encryption at rest (SEC-3) - **read this**

**Encrypted in the application (AES-256-GCM, random IV per value, authenticated):**
`User.name`, `User.email`, `User.mobile_number`, `Transaction.note`,
`Transfer.note`, `RecurringRule.note`, `Attachment.file_name`, and the **bytes of
every attachment**. The email is looked up through a keyed HMAC ("blind index"),
so sign-in and uniqueness still work. Every encrypted backup is also protected.

**Not encrypted by the application: transaction amounts, balances and other
numbers.** This is a deliberate deviation from the wording of SEC-3 and is listed
in `DEVIATIONS.md`. Reason: the system computes balances, budgets, totals,
charts and reports with MongoDB aggregation (`$sum` over amounts, about 16
pipelines across 8 services). Application-level encryption of amounts would make
all of those impossible in the database and would mean rewriting them to decrypt
and sum in Node - a large change to working code, a performance risk (PER
requirements) and a regression risk, which the task asked to avoid.

**What protects amounts instead - you must do this in production:**
run MongoDB with encryption at rest (MongoDB Atlas, which encrypts storage with
AES-256 by default; or encrypted volumes - LUKS/dm-crypt, EBS, GCE persistent disk
encryption - or the Enterprise encrypted storage engine). Backups are encrypted
by the application in any case.

If your assessors require amounts to be encrypted by the application, the options
are (a) MongoDB Queryable Encryption / client-side field-level encryption (needs
Atlas or Enterprise, and limits what aggregations can do), or (b) a rewrite of
the aggregations. Neither is done here.

**Search.** Notes can no longer be searched in the database. The transaction
list's `search=` filter now loads the candidate rows (after every other filter),
decrypts the notes and matches in memory. This is correct and tested, but for a
user with a very large number of transactions it is slower than an index. Names
and emails cannot be searched by fragment either; the admin screen finds a user
by exact email.

**Existing data.** Records written before this feature are plaintext. They keep
working (a value without the `enc:v1:` prefix is read as-is), and
`npm run migrate:encryption` encrypts them (use `-- --dry-run` first; it is
idempotent). Take a backup first. See `BACKUP_AND_RESTORE.md`.

### 3.3 Rate limiting (SEC-7)

- Global: 100 requests per minute per client IP (`/api/health` exempt).
- Authentication: 10 requests per minute **per account** (the email in the body,
  hashed, case-insensitive; for the password-reset confirmation, a digest of the
  token; otherwise the IP) on register, verify-email, resend-code, login and both
  password-reset endpoints. The existing five-failure account lockout (REQ-4)
  still applies underneath.
- The client IP is `req.ip`. Express ignores `X-Forwarded-For` unless
  `TRUST_PROXY` names the number of proxy hops, so a client cannot choose its own
  address. This is tested with forged headers.
- **Limitation:** counters live in process memory. With several API instances each
  has its own counters (the effective limit is multiplied). Behind a load balancer
  with more than one instance, give `createRateLimiter` a shared store (Redis)
  that implements `hit(key)`; the interface is a single method.
- Tests switch the limiter off by default (the older suites send hundreds of
  requests a minute); `RATE_LIMIT_IN_TEST=true` turns it on.
- A normal page load makes several API calls. 100/minute/IP can be reached by a
  busy single user or by many users behind one NAT. It is configurable
  (`RATE_LIMIT_GLOBAL_PER_MINUTE`) if your users hit it, but the requirement says 100.

### 3.4 Sessions (SEC-8)

- The browser signs the person out after 30 minutes without a pointer, key,
  scroll or touch event, across tabs. While the person is active it pings
  `/api/auth/me` every 5 minutes so the server also sees activity.
- **The server enforces the limit itself:** a session whose `last_activity_at` is
  more than 30 minutes old is revoked on the next request (401 `SESSION_IDLE`).
  `SESSION_IDLE_TIMEOUT_MINUTES` can lower the limit but not raise it.
- The app-lock heartbeat and status calls are background timers, not a person, so
  they do not refresh the session. The two-minute background app lock (REQ-11) is
  unchanged.
- The JWT's 24-hour lifetime is an absolute cap on top of inactivity.

### 3.5 CSRF and cookies (SEC-6)

The API authenticates with an `Authorization: Bearer` header and sets **no
cookies**, so there is no ambient credential for a cross-site page to ride on.
As a second layer, a state-changing request carrying an `Origin` that is not in
`CLIENT_ORIGIN` is refused 403. If cookies are ever introduced they must be
`Secure; HttpOnly; SameSite=Strict` and a CSRF token added; none exist today, so
there is nothing to flag.

The token is kept in the browser's `localStorage` (existing design, `client/src/auth.js`).
That is readable by any script that runs on the page, which is why the CSP in
`deploy/nginx.conf.example` forbids inline and third-party scripts and why the
client never writes HTML from data. Moving the token to an `HttpOnly` cookie
would be a larger change (and would then need CSRF tokens); it is not done here.

### 3.6 Attachments (SEC-10)

Allowed: JPEG, PNG, PDF up to 5 MB. Checks: extension, declared type and magic
bytes must agree; JPEG must end with its end marker; PNG must have its header and
`IEND`; PDF must end with `%%EOF` and must not contain `/JavaScript`, `/JS`,
`/OpenAction`, `/AA`, `/Launch`, `/EmbeddedFile` and similar (including
hex-escaped names); any file containing `<script`, `<iframe`, `<svg`, `<?php`,
`javascript:` is refused. Files are stored under random 128-bit names in
`UPLOAD_DIR` (outside the web root), encrypted, and served only through a signed
URL that expires in 5 minutes (hard cap 15) for the file's owner while the owner
is active. They are served with `Content-Security-Policy: sandbox`, `nosniff`
and `no-store`.

**Limitation:** this is a content screen, not an antivirus. It stops the common
attacks (executables, polyglots, scripted PDFs). A real malware scan (ClamAV) is
an infrastructure addition; hook it in at `validateAttachment`. Receipt files
are on the API server's disk (existing deviation #5): use an encrypted volume or
move to an object store with server-side encryption before production.

### 3.7 Audit trail (REQ-96, SEC-11)

Recorded: sign-in (success, each failure with a reason, lockout), registration,
email verification, password reset, sign-out, rejected tokens, admin denials,
exports (JSON, CSV, report CSV/PDF, portability), bulk deletions (recycle-bin
purge), every administrator action, backups and restores, consent/profile/erasure
events, rate-limit trips, rejected injection and prohibited-field requests, and
refused attachment links. Each record has the actor id (null if unauthenticated),
action, timestamp and source IP, plus category, outcome and sanitised metadata.

- **Never stored:** passwords, tokens, verification codes, secrets, email
  addresses, notes, amounts, balances. `sanitizeForAudit` redacts by key name as
  a second line of defence, and tests check the trail for known secrets after
  real sign-ins. Transaction edits now record **which fields changed**, not their
  values (this changes an earlier behaviour and one existing test, see
  `DEVIATIONS.md`).
- **Append-only:** the model refuses update/delete operations. Records leave only
  when MongoDB's TTL monitor deletes them after `expires_at` (>= 365 days, never
  configurable lower). Records written before this change have no `expires_at`
  and are kept until you remove them.
- **Private:** there is no user-facing route to the audit trail; only
  `GET /api/admin/audit-logs`, administrators only.
- **Failure handling:** administrator actions and restores are **fail closed** -
  if the audit record cannot be written the action does not happen (HTTP 503).
  Ordinary events are best effort: the user's action is not blocked, but the
  failure is printed to stderr as a JSON line (non-sensitive fields only),
  counted, and shown on the admin overview.
- **Limitation:** the application cannot stop someone with direct database
  access from altering the collection. For tamper evidence, ship logs to an
  external append-only store (SIEM / object-lock bucket) - not done here.
- Ownership failures (an attempt to read another user's record) return 404 by
  design (so existence is not revealed) and are not individually audited, because
  they are indistinguishable from "not found" at the service layer. Token,
  role, origin, attachment-link and input failures are audited.
- **Erasure vs audit:** an erased user's audit records are kept for their
  12-month period (they hold the user id only, no personal data).

### 3.8 Administrators (REQ-94)

- There is **no API to become an administrator**. Use
  `npm run admin:promote -- someone@example.com` on the server (also `--demote`);
  it is written to the audit trail.
- Admin endpoints select an explicit allow-list of account fields from the
  `users` collection only. No code path reaches transactions, accounts, budgets,
  goals, reports or attachments, so no admin endpoint can return amounts,
  balances, notes, files or reports. Tests assert this on the live responses.
- An admin cannot suspend themselves or another admin. Suspension ends the
  user's sessions immediately and blocks sign-in (the person is told so only
  after giving the correct password).

### 3.9 Privacy and DPDP (SEC-13)

Implemented: explicit, separate consent at registration (stored with notice
version, purposes, time, source IP); access report (`GET /api/privacy/me`);
portability (`GET /api/privacy/export`, the REQ-87 export); correction of name and
mobile; erasure of the account and every record (all collections with a
`user_id`, discovered at run time, plus receipt files), which is also how consent
is withdrawn; accounts that predate consent can record it.

**Not implemented / your responsibility** (this is not legal advice and the
software alone does not make PFEM compliant):
- the published privacy notice itself (and bumping `PRIVACY_POLICY_VERSION`);
- a grievance officer and a way to reach them, notice to the Data Protection
  Board and affected users on a breach, verifiable parental consent for children's
  data, and any significant-data-fiduciary obligations;
- changing the **email address** (it is the identity and needs a verification
  flow; correction covers name and mobile only);
- erasure from **backups** is not immediate: erased data leaves encrypted backups
  as they expire (<= 7 days). Say so in the notice.

### 3.10 Existing behaviour that was kept

bcrypt cost 12, the five-failure lockout, the 15-minute reset link, email
verification, the signed-URL scheme, `X-File-Name` upload, the CSV
formula-injection protection and the app lock were already sound and are reused.

---

## 4. Deployment checklist

1. Run MongoDB as a **replica set** (consistent backups) with **encryption at rest**.
2. Create secrets (section 2) in a secret manager; set `NODE_ENV=production`.
3. Put nginx (or equivalent) in front using `deploy/nginx.conf.example`; set
   `TRUST_PROXY=1`, `CLIENT_ORIGIN=https://...`. Bind the API to `127.0.0.1`.
4. Back up, then `npm run migrate:encryption -- --dry-run`, then without
   `--dry-run`.
5. `npm run admin:promote -- you@example.com`.
6. Confirm `BACKUP_DIR` is outside the web root and outside `UPLOAD_DIR`, on a
   volume other than the database, and copy backups off the host.
7. Run the scanner/checks: `curl -I http://host/` (redirect), `curl -I https://host/api/health`
   (HSTS, CSP, no `X-Powered-By`), SSL Labs (TLS 1.2+).
8. Publish the privacy notice; set `PRIVACY_POLICY_VERSION`.
9. Review `npm audit` for server and client before release.

## 5. Residual risks

- Amounts are not encrypted by the application (3.2).
- Token in `localStorage` (3.5).
- In-memory rate limits (3.3); no CAPTCHA.
- Content screening, not antivirus (3.6).
- Audit trail is tamper-resistant against the application, not against a database admin (3.7).
- Dependencies are not scanned by this project's CI; run `npm audit`.
- Not independently pen-tested.
