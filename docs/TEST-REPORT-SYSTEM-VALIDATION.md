# System validation report

The Sprint 3 system suite: twelve end-to-end cases that drive the real API against a real database and check that separately built features agree with one another. Full steps, with expected and actual results, are in `SPRINT-3-TEST-CASES.md`.

**Generated 2026-11-12 15:42 UTC** by `npm run report:tests`, from a real run.
Nothing in this file is written by hand.

| Suite | Cases | Passed | Failed | Duration | Result |
| --- | --- | --- | --- | --- | --- |
| Sprint 3 system cases | 12 | 12 | 0 | 7.1s | **Pass** |

## The twelve cases

| Case | What it validates | Result |
| --- | --- | --- |
| ST3-01 | a person can register, verify, sign in, use the product and sign out | Pass |
| ST3-02 | accounts hold balances that follow their transactions, and net worth nets debt off assets | Pass |
| ST3-03 | a transaction can be recorded, corrected, deleted and restored, and balances follow every step | Pass |
| ST3-04 | transactions can be found by date, account, category, type, tag, amount and note | Pass |
| ST3-05 | a split bill is attributed to each category, and an excluded item leaves budgets but not reports | Pass |
| ST3-06 | categories are seeded and protected, and spending can be totalled by category and by tag | Pass |
| ST3-07 | a budget tracks what is spent against it, warns as it fills, and can be changed | Pass |
| ST3-08 | a recurring rule generates its transactions and can be paused, and a bill reminder can be paid | Pass |
| ST3-09 | a savings goal tracks progress, accepts contributions and gives money back on withdrawal | Pass |
| ST3-10 | every insight screen agrees on the same money, and an export carries the same figures | Pass |
| ST3-11 | a receipt can be attached and fetched, and a user can export and re-import their data | Pass |
| ST3-12 | one person cannot reach another person's money, only an administrator can administer, and the product answers quickly | Pass |

## How to reproduce

```
cd server
TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run test:system
```

## Failing cases

None.
