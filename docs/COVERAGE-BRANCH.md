# Branch coverage report

Measured across **every** suite - unit, integration and the Sprint 3 system cases - because a figure from unit tests alone would say nothing about the routes.

The run behind these figures was **767 tests, 765 passed, 2 failed**.

The two REQ-97 backup cases below are environmental rather than defects, and are recorded in `DEVIATIONS.md`: one needs MongoDB running as a replica set, the other checks POSIX file permissions that Windows does not implement. Both are expected to pass on a Linux runner.

**Failing in this run**

- REQ-97 a backup covers every collection and index, not a chosen few
- REQ-97 the backup file is encrypted: no readable data, names or markers in it


**Generated 2026-11-12 15:42 UTC** by `npm run report:tests`, from a real run.
Nothing in this file is written by hand.

## Overall

| Measure | Covered |
| --- | --- |
| **Branch coverage** | **84.56%** |
| Line coverage | 92.02% (see `COVERAGE-CODE.md`) |
| Function coverage | 92.58% |

Branch coverage asks a harder question than line coverage: not "did this line run?" but "was every decision taken both ways?". A validator whose every rejection path is exercised scores well here; one that was only ever given valid input does not.

## Twenty least-covered files by branch

| File | Branch % | Line % |
| --- | --- | --- |
| `money.js` | 40.00 | 82.98 |
| `Transfer.js` | 42.86 | 91.35 |
| `Transaction.js` | 44.44 | 98.17 |
| `budgetUpdate.js` | 44.44 | 83.61 |
| `goals.js` | 47.83 | 76.07 |
| `budgets.js` | 48.48 | 74.63 |
| `auth.js` | 51.24 | 72.27 |
| `goalService.js` | 52.38 | 68.98 |
| `reports.js` | 54.00 | 89.43 |
| `reportPdfService.js` | 56.00 | 82.49 |
| `categories.js` | 58.97 | 59.23 |
| `db.js` | 66.67 | 52.78 |
| `Budget.js` | 66.67 | 96.26 |
| `accounts.js` | 68.57 | 64.85 |
| `rateLimit.js` | 72.50 | 94.85 |
| `budgetService.js` | 75.00 | 100.00 |
| `tags.js` | 77.78 | 94.20 |
| `dashboardService.js` | 78.26 | 100.00 |
| `transactions.js` | 78.57 | 92.10 |
| `exportService.js` | 79.03 | 100.00 |

## Fully branch-covered files

30 of 101 source files take every branch.

## How to reproduce

```
cd server
TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run test:coverage
```
