# Deviations from the baseline documents

Guideline 2(i) of the Mini-Project Part-2 brief requires deviations from the
submitted SRS, SADS and Test Plan to be documented and explained at the final
demonstration. This file is that record.

**Baseline documents:** SRS v1.1, SADS, Test Plan v1.0
**Last updated:** 27 October 2026

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

**Remaining.** The interim header is retained for this sprint so that any page
or script not yet migrated keeps working. It should be deleted when Sprint 2 is
frozen.

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

## Summary for the demonstration

| # | Deviation | Status |
|---|---|---|
| 1 | Sign-in not wired to feature routes | Fixed in Sprint 2 (PR #89) |
| 2 | Email delivery stubbed in development | Accepted; real SMTP before deployment |
| 3 | Transactions router merged unmounted | Fixed (PR #83) |
| 4 | Test Plan results partial | In progress; blank where the feature does not exist |

No requirement has been dropped. All 97 functional requirements and all 32
performance, safety and security requirements remain covered by the backlog, as
recorded in `BACKLOG.md`.
