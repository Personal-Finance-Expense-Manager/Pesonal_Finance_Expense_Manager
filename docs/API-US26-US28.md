# API reference - US-26 (#62) and US-28 (#67)

Base URL: `http://localhost:5000`. All routes need `Authorization: Bearer <token>`
(from `POST /api/auth/login`) unless stated. Responses are JSON. Errors look like
`{ "message": "..." }`, sometimes with a `code`.

## Cross-cutting behaviour

| Status | Meaning |
|---|---|
| 400 | Validation failed, or the request contained a `$`/`.` key (operator injection), or a prohibited credential field (`cardNumber`, `cvv`, `upi_pin`, `bank_password`...) |
| 401 | No/invalid/expired token. `code`: `TOKEN_EXPIRED`, `TOKEN_INVALID`, `SESSION_REVOKED`, `SESSION_IDLE` (30 min inactivity), `ACCOUNT_SUSPENDED` |
| 403 | Not an administrator; wrong password; foreign `Origin`; suspended account at sign-in (`code: ACCOUNT_SUSPENDED`) |
| 404 | Not found - also what another user's resource looks like |
| 423 | App is locked (`APP_LOCKED`) or sign-in locked after repeated failures |
| 426 / 308 | Plain HTTP in production (writes / GET) |
| 429 | Rate limited; `Retry-After` header gives seconds |
| 503 | Restore in progress, or an administrator action could not be audited |

Rate-limit headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

## Authentication changes

`POST /api/auth/register` now also requires `"dataProcessingConsent": true`
(in addition to `termsAccepted` and `privacyPolicyAccepted`); otherwise 400.
Consent is stored with the notice version, purposes, time and source IP.

`POST /api/auth/login` - a **suspended** account that supplies the right password gets
`403 { "code": "ACCOUNT_SUSPENDED" }`; a wrong password still gets the generic 401.
The response shape is unchanged.

`GET /api/auth/me` -> `{ "data": { id, name, email, role, consent_given } }`.
(The web client uses `role` only to show the Administration link and to keep the
session alive while the person is active.)

## Administration (administrators only)

### `GET /api/admin/summary`
```json
{ "users": { "total": 12, "active": 10, "suspended": 1, "closed": 1,
             "unverified": 0, "admins": 1, "new_last_30_days": 4 },
  "backups": { "enabled": true, "retention_days": 7, "interval_hours": 24,
               "last_success_at": "...", "last_failure_at": null,
               "last_failure_message": null, "count": 7 },
  "audit": { "write_failures_since_start": 0 } }
```

### `GET /api/admin/users`
Query: `page` (1), `limit` (25, max 100), `status` (`active|suspended|closed`),
`role` (`user|admin`), `verified` (`true|false`), `email` (**exact** address - names
and emails are encrypted so partial search is impossible), `id`, `sort`
(`newest|oldest|last_sign_in`).
```json
{ "data": [ { "id": "...", "name": "...", "email": "...", "role": "user",
              "status": "active", "email_verified": true, "created_at": "...",
              "last_sign_in_at": "...", "suspended_at": null,
              "suspension_reason": null, "erased_at": null, "consent_given": true } ],
  "page": 1, "limit": 25, "total": 12, "total_pages": 1 }
```
There is **no** admin endpoint for transactions, balances, notes, attachments or reports.

### `GET /api/admin/users/:id`
One user, same fields.

### `POST /api/admin/users/:id/suspend`  body `{ "reason": "up to 300 chars" }`
Ends all the user's sessions at once and blocks sign-in. 400 without a reason; 400 for
yourself; 403 for another administrator; 409 if not active; 404 unknown.

### `POST /api/admin/users/:id/restore`
Only a suspended account (409 otherwise).

### `GET /api/admin/audit-logs`
Query: `page`, `limit` (default 50), `category` (`auth|authz|export|bulk_delete|admin|backup|privacy|security|data`),
`outcome` (`success|failure|denied`), `action` (exact, e.g. `auth.login_failed`),
`userId`, `from`, `to` (ISO dates).
```json
{ "data": [ { "id": "...", "timestamp": "...", "action": "auth.login_failed",
              "category": "auth", "outcome": "failure", "actor_id": "...",
              "actor_role": null, "target_user_id": null, "entity_type": null,
              "entity_id": null, "ip_address": "203.0.113.4",
              "metadata": { "reason": "wrong_password" } } ],
  "page": 1, "limit": 50, "total": 1, "total_pages": 1 }
```

### Backups
See `BACKUP_AND_RESTORE.md`.

| Route | Body | Result |
|---|---|---|
| `GET /api/admin/backups` | - | `{ status, data: [ { id, created_at, size_bytes, consistency, trigger, documents, collections } ] }` |
| `POST /api/admin/backups` | - | 201, the new backup |
| `POST /api/admin/backups/:id/verify` | - | `{ data: { ok, documents, collections, consistency } }` or 422 |
| `POST /api/admin/backups/:id/restore` | `{ "confirm": "RESTORE", "password": "..." }` | `{ data: { restored_backup_id, safety_backup_id, collections, documents, consistency } }` |

## Personal data rights (any signed-in user, own data only)

| Route | Purpose |
|---|---|
| `GET /api/privacy/me` | access: profile, consent record, count of records held per collection, retention rules |
| `GET /api/privacy/export` | portability: the complete JSON export (same as `/api/data/export.json`), as a download |
| `PATCH /api/privacy/profile` | correction: `{ "name"?, "mobileNumber"? }` (other fields are ignored) |
| `POST /api/privacy/consent` | `{ "dataProcessingConsent": true }` for accounts created before consent existed |
| `DELETE /api/privacy/account` | erasure and withdrawal of consent: `{ "password": "...", "confirm": "DELETE" }` |

Erasure deletes the user's records in **every** collection that has a `user_id`
(discovered at run time), deletes their receipt files, ends all sessions, and
reduces the user record to an anonymous tombstone. 403 for administrators.

## Attachments (changes)

`view_url` links expire after 5 minutes (never more than 15). A link stops working
when its owner is suspended or erased. Uploads with active content or a broken
structure are refused with **422** (wrong type/extension: 415; too large: 413).
