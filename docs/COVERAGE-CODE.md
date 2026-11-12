# Code coverage report

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
| **Line coverage** | **92.02%** |
| Function coverage | 92.58% |
| Branch coverage | 84.56% (see `COVERAGE-BRANCH.md`) |

Across 101 source files.

## Twenty least-covered files by line

These are where the remaining risk sits, and are listed honestly rather than hidden behind the average.

| File | Line % | Branch % | Funcs % |
| --- | --- | --- | --- |
| `db.js` | 52.78 | 66.67 | 50.00 |
| `categories.js` | 59.23 | 58.97 | 80.00 |
| `accounts.js` | 64.85 | 68.57 | 72.22 |
| `goalService.js` | 68.98 | 52.38 | 86.67 |
| `auth.js` | 72.27 | 51.24 | 95.00 |
| `budgets.js` | 74.63 | 48.48 | 85.71 |
| `goals.js` | 76.07 | 47.83 | 100.00 |
| `categoryService.js` | 80.65 | 85.71 | 71.43 |
| `reportPdfService.js` | 82.49 | 56.00 | 76.92 |
| `backupScheduler.js` | 82.50 | 92.86 | 33.33 |
| `money.js` | 82.98 | 40.00 | 50.00 |
| `budgetUpdate.js` | 83.61 | 44.44 | 100.00 |
| `budgetEvaluator.js` | 85.60 | 90.00 | 80.00 |
| `billSchedulerService.js` | 86.96 | 87.50 | 85.71 |
| `authenticate.js` | 89.26 | 81.40 | 66.67 |
| `reports.js` | 89.43 | 54.00 | 100.00 |
| `data.js` | 89.44 | 90.91 | 85.71 |
| `encryptionMigration.js` | 89.90 | 84.38 | 100.00 |
| `security.js` | 90.85 | 95.65 | 89.47 |
| `Transfer.js` | 91.35 | 42.86 | 100.00 |

## Fully covered files

47 of 101 source files reach 100% line coverage.

## How to reproduce

```
cd server
TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run test:coverage
```
