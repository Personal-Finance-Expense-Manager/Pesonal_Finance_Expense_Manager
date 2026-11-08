# Testing - US-26 (#62) and US-28 (#67)

## Running

```
# unit tests (no database) - what CI runs
cd server && npm test

# integration tests: real Express app, real MongoDB, real JWTs
cd server
TEST_MONGO_URI="mongodb://127.0.0.1:27017/pfem_test?replicaSet=rs0" npm run test:integration

# client
cd client && npm test && npm run lint && npm run build
```

- `npm test` needs no setup: with no `ENCRYPTION_KEY` the tests use a throw-away key
  (only under `node --test` / `NODE_ENV=test`).
- Integration tests **drop the database** named in `TEST_MONGO_URI`. Use a test database.
- Use a **replica set** (even a single-node one) to exercise the snapshot-consistency
  backup test. On a standalone server that one test still passes (the backup records
  `best_effort`). To start one locally:
  `mongod --dbpath /tmp/rs --replSet rs0` then once in `mongosh`: `rs.initiate()`;
  add `?replicaSet=rs0` to the URI.
- Integration tests read `JWT_SECRET` from the environment (`set -a; . ./.env; set +a`),
  as the existing suites already required.
- CI (`.github/workflows/ci.yml`) runs only the unit suite and has no MongoDB. Adding the
  integration suite there needs a MongoDB service started as a replica set; not done here.

## What each new file covers

| File | Kind | Covers |
|---|---|---|
| `test/security-unit.test.js` | unit | AES-256-GCM (round trip, randomised, tamper, key rotation, malformed key), backup stream encryption (multi-chunk, wrong key, flipped byte, truncation, chunk removal), input guard, rate-limiter logic, bcrypt/idle/audit floors, signed-URL cap, production env validation, audit sanitiser, upload content screening |
| `test/secret-scan.test.js` | unit | no hardcoded secrets/keys/JWTs/credentialed URIs in source, no fallback values for secrets, `.env` ignored and untracked, `.env.example` complete with placeholders only, nothing logs credentials, dev mail console gated, no card/CVV fields or HTML sinks in the client |
| `test/admin-audit.integration.test.js` | integration | role enforcement on every admin route, forged role claim, dev header never admin, counts, pagination/filters, **no financial data in any admin response**, suspend/restore (sessions revoked, sign-in blocked), self/admin protection, audit content (actor, role, IP, time), **fail-closed** admin actions, best-effort failure reporting, no secrets in the trail, exports, bulk-delete, append-only model, 12-month TTL, spoofed `X-Forwarded-For` |
| `test/backup.integration.test.js` | integration | all collections/indexes covered, file is ciphertext, exact restore (types, indexes, dropped extras), safety backup, tamper / wrong key / truncation refused with the DB untouched, id path traversal, missing key, concurrency lock, stale lock, 7-day retention and "never delete the only backup", daily scheduler, failing job audited, admin API (role, password, confirm), maintenance mode, snapshot consistency under concurrent writes |
| `test/security.integration.test.js` | integration | every protected area 401 without token; expired, tampered, `alg:none`, wrong-secret, other-algorithm, no-`exp`, over-24 h tokens; revoked session; 30-minute idle expiry (server side), heartbeat does not extend it, cap not raisable; cross-user access to accounts, transactions, categories, budgets, goals, attachments; signed links; encrypted files; link stops on suspension; malicious uploads; operator injection (body, query); validation; prohibited credential fields; no model fields for them; headers, CORS, CSRF origin guard, no cookies; error leakage |
| `test/rate-limit.integration.test.js` | integration | 11th sign-in/min per account -> 429; per-account not per-IP; case-insensitive; forged `X-Forwarded-For` ignored; register/verify/resend/reset share the limit; global 100/min/IP; health exempt; audited once per window |
| `test/transport.integration.test.js` | integration | HTTPS redirect (GET 308) / refusal (write 426), HSTS >= 1 year via trusted proxy, hostile Host, production CORS origins |
| `test/privacy.integration.test.js` | integration | consent required and stored; end-to-end register-verify-login; bcrypt >= 12; ciphertext in the database for name/email/mobile/note/file name while the API shows plaintext; unique email; encrypted search; damaged value tolerated; migration (dry run, idempotent, legacy records still work); access, portability, correction (mass assignment blocked), consent for old accounts; erasure (everything removed, files deleted, sessions ended, tombstone, other users untouched, audit has no PII) |
| `test/dev-auth.integration.test.js` | integration | the server's development-only `X-User-Id` bypass: off by default, ignored in production even when switched on, never an administrator, a real token always wins, production start-up refuses it |
| `client/test/session-policy.test.js` | unit | the 30-minute limit, keep-alive rules, ended-session codes |
| `client/test/session-auth.test.js` | unit | the client sends only `Authorization: Bearer` (never a user id, whatever is in storage); no source file mentions the demo-user mechanism; no helper takes a user id; every file that calls the API sends the token; every feature page has a signed-out state; no hard-coded API address |
| `client/test/pages-render.test.js` | unit | every one of the 15 feature pages is server-rendered **signed out** (shows the sign-in prompt, no user-id box) and **signed in** (renders content, no prompt) |

## Changes to existing tests (and why)

No test was deleted. Three were changed because the behaviour they pinned is what the
requirements ask to change, or because of how test data is built:

1. `test/transaction-edit.integration.test.js`: the audit entry used to hold the old and
   new **amount and note**. SEC-11/REQ-96 forbid logging those, so it now asserts the
   entry lists the changed field names and contains neither value.
2. `test/attachment-validation.test.js` and `test/attachments.integration.test.js`: the
   sample JPEG/PNG/PDF were a magic number plus filler. Content screening (SEC-10)
   requires the end marker/`IEND`/`%%EOF`, so the fixtures are now minimal well-formed files.
3. `test/auth-integration.integration.test.js`: its clean-up deleted users with a database
   regex on `email`, which cannot work on an encrypted column; it now finds leftovers by
   decrypted address.
4. `test/helpers/integration.js`: after `dropDatabase()` the harness now recreates the
   models' indexes. Previously the drop could remove indexes Mongoose was still building,
   which made `REQ-58` fail on a fresh database (it failed before these changes too).

## Results of the final run

| Suite | Result |
|---|---|
| Server unit (`npm test`) | **386 / 386** passed (352 existing + 34 new) |
| Server integration | **360 / 360** passed (243 existing + 117 new), MongoDB 7.0.34, single-node replica set |
| Client unit (`npm test`) | **84 / 84** passed (38 existing + 46 new) |
| Real server process | booted from `src/index.js`; register, verify, sign in, then **24 endpoints** used by the pages probed: 23 returned 200 with a Bearer token and the admin one 403 (the test user is not an administrator); all 24 returned 401 without a token |
| Client `npm run lint` | 0 errors, 15 warnings (the same 15 as before the change) |
| Client `npm run build` | succeeds |

Before any change, the integration suite had **one** failing test (`REQ-58`, an index
timing problem in the harness, described above); it passes now.

Not run: the CI workflow itself, a real browser session (every page was server-rendered signed in
and out and the client was built, linted and unit tested, but nothing was clicked through in a browser), load/performance tests of
encrypted search on large data, `npm audit`, a penetration test, TLS against a real
certificate (the transport tests simulate a trusted proxy with headers).
