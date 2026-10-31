# Performance results

US-27 (#14), SRS section 6.1: PER-1 to PER-11.

**Measured:** 31 October 2026 · **Code:** `main` plus US-23 and US-24

This file records what was measured, how it was measured, and where a target
could not be shown. Re-run the server benchmark on any machine with
`npm run bench` (see "How to reproduce").

## Summary

| Req | Target | Result | Status |
|---|---|---|---|
| PER-1 | Save within 1 s (p95, 4G) | 22 ms server + about 0.3 s network on 4G | Met |
| PER-2 | Screen interactive within 2 s on 4G, 5 s on 3G | Slowest screen: 1.2 s on 4G, 2.3 s on 3G | Met |
| PER-3 | Dashboard within 3 s of sign-in | 1.2 s on 4G, 2.1 s on 3G | Met |
| PER-4 | 12-month report, 5,000 transactions, within 5 s | 0.27 s (p95) | Met |
| PER-5 | Page of 25 within 1 s; filter/search within 2 s | 87 ms; 79 ms (p95) | Met |
| PER-6 | Balances consistent within 5 s | 57 ms (balances are computed on every read) | Met |
| PER-7 | 200 concurrent active users, ≤ 20 % degradation | Met at 100 users; not shown at 200 on the test machine | **Not shown** |
| PER-8 | Scheduler done within 10 min of 00:05 IST | The scheduler (US-16, US-17) is not built yet | Not measurable yet |
| PER-9 | 1,000-row import: preview ≤ 15 s, commit ≤ 15 s | 0.27 s; 1.2 s | Met |
| PER-10 | No query over 500 ms; user/date/category queries indexed | Every checked query uses an index, 5-11 ms | Met |
| PER-11 | Mobile package ≤ 30 MB, offline cache ≤ 50 MB | No mobile app; web bundle 74 KB gzipped. No offline cache yet (US-11) | Not applicable yet |

## Test environment

- Cloud container, **2 vCPUs** and 8 GB RAM, Node 22.
- Database: a MongoDB-compatible server (FerretDB 2.5 on PostgreSQL 16 with
  DocumentDB). No real MongoDB server could be installed in the environment
  we used. Each query here costs more than on MongoDB, so these are
  conservative numbers.
- The API, the database and the load generator all share the same 2 vCPUs.
  This matters for PER-7 (see below).

## Server times (`npm run bench`)

Data set: one user with 5,000 transactions over twelve months (8 categories,
1,000 tagged), plus 2,000 registered users, 200 of them active with 50
transactions each. Times are measured at the HTTP client on the same machine,
so they include the full API but no network.

| Req | Measurement | Samples | p95 | Target |
|---|---|---:|---:|---:|
| PER-1 | Save a transaction | 50 | 22 ms | 1,000 ms |
| PER-5 | Transaction list, page of 25 | 30 | 87 ms | 1,000 ms |
| PER-5 | Filter + search (date, category, amount, note text) | 30 | 79 ms | 2,000 ms |
| PER-5 | Filter by tag | 30 | 81 ms | 2,000 ms |
| PER-3 | Dashboard summary | 20 | 64 ms | 3,000 ms |
| PER-4 | 12-month category and tag totals over 5,000 transactions | 10 | 269 ms | 5,000 ms |
| PER-6 | New transaction -> balance changed (single run) | 1 | 57 ms | 5,000 ms |
| PER-9 | Import 1,000 rows: validate and preview | 1 | 272 ms | 15,000 ms |
| PER-9 | Import 1,000 rows: commit | 1 | 1,206 ms | 15,000 ms |

### PER-10: indexes

Checked with `explain()` against the 5,000-transaction user:

| Query | Plan | Time |
|---|---|---:|
| Transactions by user and date range, newest 25 | index scan | 11 ms |
| Transactions by user, category and date range | index scan | 6 ms |
| Tag links by user and tag (the list's tag filter) | index scan on the new `user_id_1_tag_id_1` | 5 ms |

US-27 added the `{ user_id, tag_id }` index on `transactiontags`. Before it,
the tag filter read every tag link the user had. The other indexes the SRS
asks for (user + date, user + category + date, user + account + date) were
already on `transactions` and `transfers`.

### PER-7: concurrent users

Each simulated user acts every 3-7 seconds (think time), alternating between
the transaction list, the dashboard and saving a transaction, for 30 seconds.
"Without degrading the above response times by more than 20 %" is read as:
under load, each operation's p95 stays within 120 % of its own target (save
and list 1.2 s, dashboard 3.6 s).

| Active users | Requests/s | List p95 | Dashboard p95 | Save p95 | Errors | Result |
|---:|---:|---:|---:|---:|---:|---|
| 100 | 20 | 329 ms | 348 ms | 248 ms | 0 | Met |
| 200 | 35 | 2,050 ms | 2,054 ms | 2,131 ms | 0 | Not met on this machine |

At 200 users the 2 vCPUs are fully used. They run the API, the database
emulator, PostgreSQL and the 200 simulated users all at once, so requests
queue. No request failed. This is a limit of the test machine, not a measured
limit of the application, but it means **PER-7 at 200 users has not been
demonstrated**. To show it, run `npm run bench` with the API and a real
MongoDB on a machine where the load generator does not share their CPUs.

## Screen load times (PER-2, PER-3)

Measured on the production build (`npm run build`), served with gzip as any
host does, in Chromium at phone size (390 × 844). Cache disabled, network
throttled:

- **4G:** 150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up (Lighthouse's "slow 4G")
- **3G:** 300 ms round trip, 750 kbit/s down, 250 kbit/s up

"Interactive" means the page's own content is on screen. For the sign-in
screen that is the email box; for the others it is data loaded from the API
(account names, dashboard figures, the transaction count). Median of 3 cold
loads.

| Screen | 4G | 3G | Target |
|---|---:|---:|---|
| Home / sign-in | 0.74 s | 1.46 s | 2 s / 5 s |
| Dashboard (PER-3) | 1.22 s | 2.14 s | 3 s |
| Transactions | 1.04 s | 1.99 s | 2 s / 5 s |
| Accounts | 1.21 s | 2.33 s | 2 s / 5 s |
| Import and export | 1.04 s | 1.92 s | 2 s / 5 s |
| Home -> Transactions, inside the app | 0.32 s | 0.31 s | 2 s / 5 s |

### What US-27 changed on the client

Each feature page is now its own file (`React.lazy` in `client/src/Root.jsx`).
The first screen downloads 73 KB gzipped instead of 90 KB. The other pages are
fetched in the background once the browser is idle, so moving between screens
waits only for the API (last row above).

Compared with the single-file build on the same network:

| | Before | After |
|---|---:|---:|
| Home / sign-in, 4G | 0.83 s | 0.74 s |
| Home / sign-in, 3G | 1.65 s | 1.46 s |
| Transactions opened directly by URL, 4G | 0.82 s | 1.04 s |
| Transactions opened directly by URL, 3G | 1.64 s | 1.99 s |

A page opened straight from a bookmark is about 0.2-0.35 s slower, because its
file is fetched after the main one. It is still well inside the target. The
split matters more as Sprint 2 adds pages: a charting library for US-21 can be
larger than the whole app today, and this keeps it off the sign-in screen.

## Watching performance while developing

Every API response now carries a `Server-Timing: app;dur=<ms>` header, shown
in the browser's Network panel. Any request slower than `SLOW_REQUEST_MS`
(default 1,000 ms, the PER-1 and PER-5 budget) is logged in the API console as
`[slow] GET /api/... 200 1234 ms`. Only the method and path are logged, never
the query string or body.

## How to reproduce

Server, against a throwaway database (it is dropped, so its name must contain
`bench` or `test`):

```bash
cd server
BENCH_MONGO_URI=mongodb://127.0.0.1:27017/pfem_bench npm run bench
```

PowerShell:

```powershell
cd server
$env:BENCH_MONGO_URI = "mongodb://127.0.0.1:27017/pfem_bench"; npm run bench
```

Options: `BENCH_ACTIVE` (default 200) and `BENCH_SECONDS` (default 30). The
script prints the table above and exits with code 1 if any target is missed.

Screen times: run `npm run build` in `client/`, serve `client/dist` with gzip,
and use the browser's network throttling with the profiles above.
