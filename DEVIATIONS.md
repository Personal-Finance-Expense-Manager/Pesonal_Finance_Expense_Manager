# Deviations from the baseline documents

Guideline 2(i) of the Mini-Project Part-2 brief requires deviations from the
submitted SRS, SADS and Test Plan to be documented and explained at the final
demonstration. This file is that record.

**Baseline documents:** SRS v1.1, SADS, Test Plan v1.0
**Last updated:** 31 October 2026

---

## 1. Sign-in was not wired into the feature routes during Sprint 1

**Status:** fixed in Sprint 2 (PR #89, US-25)

**What happened.** US-06 (accounts) was built before US-04 (sign-in) merged, so
`middleware/currentUser.js` was written with an interim: the user is identified
by an `X-User-Id` request header, gated on `NODE_ENV !== 'production'` and
`DEV_AUTH_HEADER=true`. Its own comment said to replace it when US-04 landed.
US-04 landed the next day and the follow-up was never captured as a task, so
every screen built afterwards copied the same interim.

**How it was found.** An end-to-end system test at the close of Sprint 1
presented a valid session token to `/api/reports/dashboard` and received 401,
while a pasted user id received 200.

**Why it mattered.** The application could not run with `DEV_AUTH_HEADER` off,
so it was not deployable, and SEC-4 and SEC-5 require the server to authenticate
every request and enforce ownership from the session rather than from anything
the client supplies.

**Resolution.** `requireUser` now hands any request carrying a Bearer token to
the US-04 `authenticate` middleware. The development header applies only when no
token is present. 22 integration tests assert that a token authenticates all six
feature routers and that forged tokens, revoked sessions and suspended accounts
are refused.

**Update (US-28).** The web client has now been fully migrated: no page, helper
or stored key uses the pasted-id mechanism any more; every request carries
`Authorization: Bearer`, and a signed-out visitor sees a sign-in prompt
(`client/src/SignInRequired.jsx`). `client/test/session-auth.test.js` and
`client/test/pages-render.test.js` fail if the mechanism returns.

**Remaining.** The header is still accepted by the **server**, but only when
`DEV_AUTH_HEADER=true` and never in production (start-up refuses it). It is kept
because about thirty server integration suites sign their requests with it
(`apiAs` in `test/helpers/integration.js`) and some local scripts rely on it.
Removing it means rewriting those suites to mint real sessions
(`test/helpers/auth.js` already does this and is used by the new suites). Until
then it is an accepted development-only deviation, tested in
`test/dev-auth.integration.test.js`.

---

## 2. Email delivery is stubbed in development

**Status:** accepted for the academic deliverable

**Deviation from:** SRS REQ-4, which specifies a six-digit code sent by email.

**What was done.** No team machine has an SMTP server, so registration returned
503 and could not be completed or demonstrated. With `DEV_EMAIL_CONSOLE=true`,
and only when `NODE_ENV` is not `production`, the verification code is printed
to the API console instead of being emailed (PR #88).

**Why this is acceptable.** Nothing about the verification itself changes: the
code is still randomly generated, still hashed with `EMAIL_VERIFICATION_SECRET`
before storage, still expires after ten minutes, and is still limited to three
attempts and three resends per hour. Only the delivery channel differs.

**Before any deployment.** Configure real SMTP credentials and remove the flag.

---

## 3. The transactions router was merged without being mounted

**Status:** fixed (PR #83)

**What happened.** US-08 (#24) merged `routes/transactions.js` in PR #82, but
`app.js` never mounted it, so every `/api/transactions` endpoint returned the
404 handler. The feature was complete but unreachable.

**How it was found.** While building US-12 (categories), which required the
transaction-category link.

**Resolution.** Mounted with `requireUser`, matching the other feature routers,
and carried in PR #83 at the request of the story's owner. Verified: `POST
/api/transactions` returns 201, unauthenticated returns 401.

**Lesson recorded.** A merged story is not a working story. Acceptance criteria
should be exercised through the running application, not only through unit
tests, before an issue is closed.

---

## 4. Test Plan results are recorded only for completed features

**Status:** in progress

**Deviation from:** the Test Plan, which carries 148 manual test cases with
Actual Result and Test Result to be completed during manual testing.

**What was done.** Results are being recorded for the test cases covering
features that exist. Cases belonging to Sprint 2 modules - recurring entries,
savings goals, import and export, administration - are deliberately left blank
until those stories are delivered.

**Why.** Recording a result for a feature that has not been built would make
the document untrue. A partially completed Test Plan that is accurate is worth
more than a complete one that is not.

---

## 5. Receipt files are stored on the API server's disk

**Status:** accepted for the academic deliverable (US-23, #57)

**Deviation from:** SRS DE-3 and the use-case actors, which name an external
object store for receipt images.

**What was done.** No team machine or free tier gives us an object store, so
`services/storageService.js` writes each file to a directory on the API
server (`UPLOAD_DIR`, default `server/uploads`, already in `.gitignore`) under
a random 32-character name. That name is the `object_key` on the Attachment
record, exactly as the data model describes. The file is never served
directly: the owner asks for a URL and gets one signed with HMAC-SHA256 that
expires after 5 minutes (REQ-81).

**Also different.** A PDF receipt is shown as a "PDF" tile rather than a
rendered first page. Rendering a PDF page needs a PDF library on the server or
the client, which was out of proportion for a thumbnail. Images show a real
preview.

**Before any deployment.** Replace the three functions in `storageService.js`
(`saveObject`, `objectPath`, `deleteObject`) with an object-store client; the
routes, signed URLs and records do not change.

---

## 6. Import and export: decisions the SRS leaves open

**Status:** accepted (US-24, #58)

These are not departures from a stated requirement, but choices the SRS does
not make, recorded so they can be explained at the demonstration.

- **Accounts and categories are not created by an import.** A row naming an
  account or category the user does not have is reported as invalid, with the
  name. Creating them silently would let a typo add a new account.
- **Transfers can be imported.** REQ-83 speaks of transactions; transfers are
  included so that an exported file imports back completely.
- **File size.** The CSV is sent inside a JSON request and the API accepts at
  most 1 MB of JSON, so a file is limited to about 900 KB or 5,000 rows. PER-9's
  1,000-row file is well inside this.
- **Receipt files are not inside the JSON export (REQ-87).** The export lists
  each attachment's name, type and size; the image and PDF files themselves are
  downloaded from the transaction. Embedding them would make the file many
  times larger and could not be opened in a text editor.

---

## 7. Performance targets that could not be shown

**Status:** open (US-27, #14). Results in `PERFORMANCE.md`.

- **PER-7 (200 concurrent users) is not demonstrated.** With 100 active
  users every response stayed far inside its target. At 200 the only test
  machine available (2 vCPUs running the API, the database and the load
  generator together) ran out of CPU and response times reached about 2 s, with
  no errors. `npm run bench` repeats the test on any machine; it should be run
  against a real MongoDB with the load generator on separate hardware before
  PER-7 is claimed.
- **Measured on a MongoDB-compatible emulator.** No real MongoDB server could
  be installed in the test environment, so the server times come from FerretDB
  on PostgreSQL. They are expected to be slower than MongoDB, not faster.
- **PER-8 cannot be measured yet.** The scheduler that generates recurring
  entries and reminders belongs to US-16 and US-17, which are not merged.
- **PER-11 does not apply as written.** There is no mobile app package, only
  the web client (74 KB gzipped on first load), and the offline cache belongs to
  US-11.

---

## 8. App lock (US-05): web client, WebAuthn biometric, server-enforced lock

**Status:** implemented; deviations accepted for the web release

**Deviates from:** SRS REQ-11, SEC-8, HI-2, Test Plan UT_64.

**Web client, not a mobile client.** REQ-11, HI-2 and SEC-8 speak of the
"mobile client" and "the background". PFEM is a React web application, so
"background" is taken to mean the page is hidden (tab switched away, browser
minimised, phone locked, tab closed). The lock engages after two minutes of
that, exactly as REQ-11 says.

**Biometric through WebAuthn.** A web page cannot read a fingerprint or a face,
and must not. The supported mechanism is a WebAuthn *platform authenticator*
(Touch ID, Windows Hello, Android biometrics): the device checks the person and
signs a server challenge; the server stores only the public key and verifies the
signature. Nothing is simulated. Two limits of the platform: (a) the browser
cannot demand a fingerprint specifically, so with `userVerification: required`
the device may accept its own screen-lock PIN or password instead; (b) it needs
HTTPS, or `localhost` in development, and a device with something set up. Where
it is unavailable the option is not shown and the PIN is used (HI-2's
"falling back to a four-digit PIN").

**The PIN is the base lock; biometric is added to it.** Biometric cannot be
turned on without a PIN, and adding a device needs the PIN again. This follows
HI-2 and means the lock never depends on a sensor that may be absent.

**The server enforces the lock.** While the lock is on, every API route except
the lock's own routes and sign-out answers `423 APP_LOCKED` unless the session
was unlocked in the last two minutes (`sessions.app_unlocked_until`). The
visible app sends a heartbeat every 30 seconds; a hidden or closed app sends
none, so the session re-locks on the server by itself. The lock screen is a
convenience over that, not the protection.

**PIN storage and guessing.** Four digits are only 10,000 possibilities, so the
PIN is stored as bcrypt (work factor 12, as REQ-6) of an HMAC keyed with
`APP_LOCK_SECRET` (falls back to `JWT_SECRET`): a stolen copy of the database
cannot be searched offline. Five consecutive wrong PINs revoke every session of
the user, so the next step needs the account password and its own REQ-8
lockout. Attempts are counted atomically *before* the comparison, so parallel
guesses cannot exceed five. This five-attempt rule is not in the SRS; it is the
minimum that makes a four-digit PIN defensible.

**Additions the SRS does not list, needed to make an optional lock usable.**
Change PIN, turn the lock off (both need the PIN), and "Forgot PIN?" (needs the
account password, sharing the REQ-8 sign-in lockout). Without the last, a
forgotten PIN would lock the user out for good. Turning the lock on, or
changing or resetting the PIN, locks the user's other signed-in devices.

**Known limits.**
1. The interim `X-User-Id` development header (deviation 1) bypasses sessions
   and therefore the lock. It is development-only (`DEV_AUTH_HEADER`, never in
   production), no web page uses it any more, and the app-lock routes ignore
   it. Removing it from the server (see deviation 1, "Remaining") closes this.
2. A receipt link already issued (US-23, valid at most 15 minutes) is a signed
   URL and keeps working for its short life after the lock engages.
3. Changing `APP_LOCK_SECRET` (or `JWT_SECRET` when it is the fallback)
   invalidates stored PINs; affected users use "Forgot PIN?".
4. UT_64 needs a two-minute wait in a real browser; the automated tests move
   the clock by editing the session instead. The Actual Result in the Test Plan
   should come from a manual run.

## 9. Offline capture is in the web client, and a queued transaction carries no receipt

**Requirement:** REQ-34 - "The system shall allow a transaction to be created on
the **mobile client** while offline, shall mark it as pending synchronisation,
and shall synchronise it to the server within 60 seconds of connectivity being
restored."

**What was built:** the behaviour REQ-34 describes, in the client that exists.
This release is a web application; there is no mobile client, and one was never
in the backlog. A transaction recorded with no network is held on the device,
shown as pending, and sent when connectivity returns - by the browser's
`online` event, and by a 15-second timer that covers a connection returning
without the event firing, which happens after sleep or behind a captive portal.
Both paths are well inside the sixty seconds the requirement allows.

**Why:** building a mobile client to satisfy one requirement was never in
scope for this project, and the requirement's intent - an entry made with no
network is not lost - is met where users actually record transactions.

**Consequences:**

1. The queue is per browser and per device. A transaction typed offline on one
   machine appears on another only once it has reached the server. That is the
   correct scope: until it syncs, the entry exists only where it was typed.
2. A transaction queued offline carries **no receipt**. Uploading a file needs
   the server, so receipts can only be attached once the transaction exists.
   Attach the receipt after it syncs.
3. A queued transaction the server then refuses - a deleted account, a category
   that no longer exists - is **kept and shown as failed**, not discarded. The
   entry can be retried or discarded by hand. Nothing typed is silently lost.
4. The queue lives in `localStorage`, so it survives the tab closing but not
   clearing site data.

---

## 10. Recurring transactions and bill reminders (US-16, US-17): decisions and limits

- **End date or count, not both.** The SRS says "an end date, an occurrence
  count, or neither"; a rule with both is refused.
- **Start date today or later.** A start date in the past would back-fill history
  on the first run. Back-filling is reserved for occurrences the scheduler
  genuinely missed (REQ-60).
- **The scheduler runs inside the API process** (as the budget and purge jobs
  do), every minute, with a catch-up pass at start-up. There is no separate
  worker or queue. The database, not the timer, prevents duplicates.
- **Push notifications have no provider.** The channel, subscription storage and
  delivery log exist; delivery needs a provider account (see README). Until one
  is registered push is recorded as `skipped_not_configured`, never `sent`.
- **Paying a bill needs an account.** A reminder can save a default account and
  category; without one the page asks at payment time.
- **Rule delete is a soft delete** (status `deleted`) so generated transactions
  keep a valid link; the rule is hidden everywhere.
- **Resume continues from the first occurrence on or after today**, so an
  occurrence due on the day of resuming is created.
- **Unavailable account at generation time:** the occurrence is recorded as
  skipped, the user gets an in-app notice and the rule continues. A deleted
  category produces an uncategorised transaction rather than a lost one.
- **`POST /api/transactions` now calls a shared `createTransactionRecord`**
  (behaviour unchanged) so the API, the scheduler and bill payment share one
  implementation.

## Summary for the demonstration

| # | Deviation | Status |
|---|---|---|
| 1 | Sign-in not wired to feature routes | Fixed in Sprint 2 (PR #89) |
| 2 | Email delivery stubbed in development | Accepted; real SMTP before deployment |
| 3 | Transactions router merged unmounted | Fixed (PR #83) |
| 4 | Test Plan results partial | In progress; blank where the feature does not exist |
| 5 | Receipt files on the API server's disk, PDF thumbnail is a tile | Accepted; object store before deployment |
| 6 | Import and export: open points decided (no auto-created accounts, file size, receipts not in JSON) | Accepted |
| 7 | PER-7 not shown at 200 users; PER-8 and PER-11 not measurable yet | Open; see PERFORMANCE.md |
| 8 | App lock: web client, WebAuthn biometric, lock enforced by the server | Accepted for the web release |
| 9 | Offline capture in the web client; a queued transaction carries no receipt | Accepted for the web release |
| 10 | Recurring and bill reminders: push has no provider; end date or count (not both); start today or later | Accepted; see section 10 |

No requirement has been dropped. All 97 functional requirements and all 32
performance, safety and security requirements remain covered by the backlog, as
recorded in `BACKLOG.md`.

---

## US-26 / US-28 (administration, audit trail, backups, OWASP hardening)

Numbered continuing the table above. Full detail: `docs/SECURITY.md`,
`docs/IMPLEMENTATION_REPORT.md`.

| # | Requirement | What the SRS says | What we built | Why |
|---|---|---|---|---|
| 11 | SEC-3 | AES-256 encryption at rest for names, emails, **transaction amounts**, notes, attachments | AES-256-GCM in the application for name, email, mobile, notes, attachment bytes and names. **Amounts are not encrypted by the application**; they rely on storage-layer encryption (Atlas / encrypted volume) plus encrypted backups. | Balances, budgets, totals, charts and reports are MongoDB aggregations over amounts (~16 `$sum` pipelines in 8 services). Field-level encryption would make them impossible in the database. Needs a decision: Queryable Encryption (Atlas/Enterprise) or a rewrite of the aggregations. |
| 12 | SEC-3 | (implied) notes searchable | The transaction `search=` is now matched in memory after decryption | The database cannot search ciphertext. Slower for users with very many transactions. |
| 13 | REQ-96 / SEC-11 | Audit records for transactions (SRS 5.3) | Transaction edit audit entries now store the **names of changed fields**, not old/new amounts and notes | Logging amounts/notes contradicts SEC-11 and REQ-96. One existing test was updated accordingly. |
| 14 | SEC-1 | HTTPS / TLS 1.2+ / HSTS | Enforced and tested in the API for requests the proxy reports as HTTPS; TLS itself is in `deploy/nginx.conf.example` | TLS is terminated by the proxy, not by Node. Cannot be verified without a real certificate. |
| 15 | SEC-7 | Rate limits | Implemented in process memory | Correct for one API instance; several instances need a shared (Redis) store. |
| 16 | SEC-10 | Malicious file prevention | Content screening (structure, active PDF content, embedded markup) | Not an antivirus; ClamAV is infrastructure. Receipts remain on the API server's disk (deviation 5). |
| 17 | REQ-97 | Automated encrypted backup of the database | Built-in, all collections + indexes, snapshot-consistent on a replica set, best-effort on standalone; receipt **files are not in the database backup** | Files live on disk; back up `UPLOAD_DIR` separately. |
| 18 | SEC-13 | Access/correction/portability/erasure | Implemented for name, mobile, and the whole account; **email change is not offered** | Email is the identity and needs a verification flow (US-25 territory). Erased data leaves backups within 7 days. |
| 19 | SEC-4 | Dev header exempt only in development | `DEV_AUTH_HEADER` now defaults to **false** in `.env.example` and production start-up refuses it. **The web client no longer uses it at all** (every page sends the JWT). | The previous example enabled it by default. It is now needed only by the server's own integration suites and scripts (see deviation 1, "Remaining"). |
| 20 | SEC-13 | Consent at registration | `POST /api/auth/register` now **requires** `dataProcessingConsent: true` | Any teammate's script or test that registers through the API must send it. |

