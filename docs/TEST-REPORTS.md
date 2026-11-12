# Testing reports

The four reports the evaluation asks for, all produced by one command from real runs.

**Generated 2026-11-12 15:42 UTC** by `npm run report:tests`, from a real run.
Nothing in this file is written by hand.

| Report | File | Headline |
| --- | --- | --- |
| Unit | [`TEST-REPORT-UNIT.md`](TEST-REPORT-UNIT.md) | 470 tests, 0 failing |
| System validation | [`TEST-REPORT-SYSTEM-VALIDATION.md`](TEST-REPORT-SYSTEM-VALIDATION.md) | 12 cases, 0 failing |
| Code coverage | [`COVERAGE-CODE.md`](COVERAGE-CODE.md) | 92.02% of lines |
| Branch coverage | [`COVERAGE-BRANCH.md`](COVERAGE-BRANCH.md) | 84.56% of branches |

## Regenerating all four

```
cd server
TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run report:tests
```

MongoDB must be running. The whole run takes a few minutes, most of it coverage.
