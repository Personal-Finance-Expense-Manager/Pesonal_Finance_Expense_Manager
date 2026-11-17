# Requirements traceability matrix

Every requirement in the SRS, the backlog item that delivers it, and the
test that proves it.

Generated from the three sources themselves - the SRS, the GitHub backlog
and the test suites - so it cannot drift from what is actually in the
repository. Regenerate with `npm run report:trace` in `server/`.

## Summary

| | Count |
| --- | --- |
| Requirements in the SRS | **143** |
| Delivered by a backlog item | **131** |
| Named by an automated test | **115** |
| Named by a Test Plan case | **113** |
| **Covered by at least one test** | **143 of 143** |

| Group | In SRS | In backlog | Automated | Test Plan |
| --- | --- | --- | --- | --- |
| Functional requirements (REQ) | 97 | 97 | 77 | 97 |
| Business rules (BR) | 14 | 2 | 14 | 0 |
| Performance (PER) | 11 | 11 | 8 | 8 |
| Safety (SAF) | 8 | 8 | 3 | 7 |
| Security (SEC) | 13 | 13 | 13 | 1 |

A requirement is proved either by an automated test that names it, or by a
Test Plan case, or both. Many have both - the automated test runs on every
pull request, and the Test Plan case is the manual walk-through.

---

## Functional requirements

| Requirement | Story | Owner | Automated test | Test Plan |
| --- | --- | --- | --- | --- |
| **REQ-1** | [US-03](../../issues/15) | Girish | `sprint3-system.integration.test.js` | UT_01, UT_02 |
| **REQ-2** | [US-03](../../issues/15) | Girish | `sprint3-system.integration.test.js` | UT_03 |
| **REQ-3** | [US-03](../../issues/15) | Girish | - | UT_04 |
| **REQ-4** | [US-03](../../issues/15) | Girish | - | UT_05, UT_06 |
| **REQ-5** | [US-03](../../issues/15) | Girish | - | UT_76 |
| **REQ-6** | [US-04](../../issues/16) | Girish | `app-lock.test.js`, `sprint3-system.integration.test.js` | UT_61 |
| **REQ-7** | [US-04](../../issues/16) | Girish | - | ST_01, UT_07 |
| **REQ-8** | [US-04](../../issues/16) | Girish | `app-lock.integration.test.js` | IT_01 |
| **REQ-9** | [US-04](../../issues/16) | Girish | - | IT_17, UT_62 |
| **REQ-10** | [US-04](../../issues/16) | Girish | `sprint3-system.integration.test.js` | UT_63 |
| **REQ-11** | [US-05](../../issues/17) | Abdul | `app-lock-client.test.js`, `app-lock.integration.test.js`&hellip; | UT_64 |
| **REQ-12** | [US-03](../../issues/15) | Girish | - | UT_65 |
| **REQ-13** | [US-06](../../issues/20) | Nikhil | `account-validation.test.js`, `sprint3-system.integration.test.js` | ST_02, UT_08, UT_09 |
| **REQ-14** | [US-06](../../issues/20) | Nikhil | `sprint3-system.integration.test.js` | ST_02, UT_10 |
| **REQ-15** | [US-06](../../issues/20) | Nikhil | `account-validation.test.js` | UT_66 |
| **REQ-16** | [US-06](../../issues/20) | Nikhil | `account-validation.test.js` | UT_67 |
| **REQ-17** | [US-06](../../issues/20) | Nikhil | - | UT_68 |
| **REQ-18** | [US-06](../../issues/20) | Nikhil | - | IT_02, ST_02, UT_12 |
| **REQ-19** | [US-07](../../issues/21) | Nikhil | `balance.test.js`, `sprint3-system.integration.test.js` | IT_03, ST_02 |
| **REQ-20** | [US-07](../../issues/21) | Nikhil | `balance.test.js`, `sprint3-system.integration.test.js` | ST_02, UT_13 |
| **REQ-21** | [US-07](../../issues/21) | Nikhil | `account-validation.test.js`, `balance.test.js`&hellip; | ST_45 |
| **REQ-22** | [US-08](../../issues/24) | Abdul | `sprint3-system.integration.test.js` | ST_03, UT_14 |
| **REQ-23** | [US-08](../../issues/24) | Abdul | - | UT_15 |
| **REQ-24** | [US-08](../../issues/24) | Abdul | `sprint3-system.integration.test.js`, `transfer-recording.integration.test.js` | IT_05, ST_03 |
| **REQ-25** | [US-08](../../issues/24) | Abdul | `sprint3-system.integration.test.js`, `transaction-edit.integration.test.js`&hellip; | ST_03, UT_16, UT_69 |
| **REQ-26** | [US-08](../../issues/24) | Abdul | `transaction-edit.integration.test.js`, `transaction-validation.test.js` | ST_03, UT_17, UT_70 |
| **REQ-27** | [US-08](../../issues/24) | Abdul | `transaction-validation.test.js` | UT_71 |
| **REQ-28** | [US-09](../../issues/25) | Abdul | `sprint3-system.integration.test.js`, `transaction-edit.integration.test.js`&hellip; | IT_04, ST_03, UT_19 |
| **REQ-29** | [US-09](../../issues/25) | Abdul | `sprint3-system.integration.test.js`, `transaction-delete-restore.integration.test.js` | ST_03, ST_13, UT_20 |
| **REQ-30** | [US-10](../../issues/26) | Girish | `sprint3-system.integration.test.js` | ST_14 |
| **REQ-31** | [US-10](../../issues/26) | Girish | `sprint3-system.integration.test.js` | ST_46 |
| **REQ-32** | [US-11](../../issues/27) | Prajwal | `split-validation.test.js`, `sprint3-system.integration.test.js` | UT_72 |
| **REQ-33** | [US-11](../../issues/27) | Prajwal | `split-validation.test.js`, `sprint3-system.integration.test.js` | ST_48 |
| **REQ-34** | [US-11](../../issues/27) | Prajwal | `offline-queue.test.js` | ST_47 |
| **REQ-35** | [US-12](../../issues/30) | Prajwal | `category-validation.test.js`, `sprint3-system.integration.test.js` | UT_73 |
| **REQ-36** | [US-12](../../issues/30) | Prajwal | `category-validation.test.js`, `sprint3-system.integration.test.js` | ST_04, UT_21, UT_22 |
| **REQ-37** | [US-12](../../issues/30) | Prajwal | `category-validation.test.js` | UT_74 |
| **REQ-38** | [US-12](../../issues/30) | Prajwal | `category-validation.test.js`, `sprint3-system.integration.test.js` | IT_21 |
| **REQ-39** | [US-12](../../issues/30) | Prajwal | `category-validation.test.js`, `sprint3-system.integration.test.js` | IT_22 |
| **REQ-40** | [US-12](../../issues/30) | Prajwal | - | ST_04, UT_25 |
| **REQ-41** | [US-13](../../issues/31) | Prajwal | `sprint3-system.integration.test.js` | ST_49 |
| **REQ-42** | [US-13](../../issues/31) | Prajwal | `sprint3-system.integration.test.js`, `totals.test.js` | IT_06, ST_04, ST_50 |
| **REQ-43** | [US-14](../../issues/35) | Nikhil | `budget.test.js`, `sprint3-system.integration.test.js` | ST_05, UT_27, UT_28 |
| **REQ-44** | [US-14](../../issues/35) | Nikhil | `budget.test.js` | ST_05, UT_29 |
| **REQ-45** | [US-14](../../issues/35) | Nikhil | `budget.test.js`, `sprint3-system.integration.test.js` | ST_15 |
| **REQ-46** | [US-14](../../issues/35) | Nikhil | `budget.test.js` | IT_07, IT_08, IT_36&hellip; |
| **REQ-47** | [US-15](../../issues/36) | Girish | `sprint3-system.integration.test.js` | ST_16 |
| **REQ-48** | [US-15](../../issues/36) | Girish | `sprint3-system.integration.test.js` | ST_05, UT_32 |
| **REQ-49** | [US-15](../../issues/36) | Girish | - | UT_75 |
| **REQ-50** | [US-14](../../issues/35) | Nikhil | `sprint3-system.integration.test.js` | ST_17 |
| **REQ-51** | [US-14](../../issues/35) | Nikhil | `sprint3-system.integration.test.js` | ST_56 |
| **REQ-52** | [US-16](../../issues/43) | Abdul | `recurrence.test.js`, `recurring-validation.test.js`&hellip; | ST_06, UT_33, UT_34 |
| **REQ-53** | [US-16](../../issues/43) | Abdul | `recurring-form.test.js`, `recurring-validation.test.js`&hellip; | UT_18 |
| **REQ-54** | [US-16](../../issues/43) | Abdul | `recurrence.test.js`, `recurring.integration.test.js` | IT_09, IT_37, ST_06 |
| **REQ-55** | [US-16](../../issues/43) | Abdul | `recurrence.test.js`, `recurring.integration.test.js`&hellip; | IT_23 |
| **REQ-56** | [US-16](../../issues/43) | Abdul | `recurring-form.test.js`, `recurring-validation.test.js`&hellip; | IT_24 |
| **REQ-57** | [US-17](../../issues/44) | Abdul | `bill-form.test.js`, `bill-reminder.test.js`&hellip; | IT_10, IT_28, ST_06&hellip; |
| **REQ-58** | [US-17](../../issues/44) | Abdul | `bill-form.test.js`, `bill-reminders.integration.test.js` | ST_18 |
| **REQ-59** | [US-17](../../issues/44) | Abdul | `bill-form.test.js`, `bill-reminder.test.js`&hellip; | ST_19 |
| **REQ-60** | [US-16](../../issues/43) | Abdul | `recurring.integration.test.js`, `sprint3-system.integration.test.js` | IT_25 |
| **REQ-61** | [US-18](../../issues/47) | Girish | `sprint3-system.integration.test.js` | ST_07, UT_39 |
| **REQ-62** | [US-18](../../issues/47) | Girish | - | UT_41 |
| **REQ-63** | [US-19](../../issues/48) | Girish | `sprint3-system.integration.test.js` | IT_26 |
| **REQ-64** | [US-19](../../issues/48) | Girish | - | ST_07, UT_43 |
| **REQ-65** | [US-18](../../issues/47) | Girish | - | ST_20 |
| **REQ-66** | [US-18](../../issues/47) | Girish | `sprint3-system.integration.test.js` | IT_11, ST_07 |
| **REQ-67** | [US-19](../../issues/48) | Girish | - | IT_27 |
| **REQ-68** | [US-18](../../issues/47) | Girish | `sprint3-system.integration.test.js` | ST_21 |
| **REQ-69** | [US-20](../../issues/34) | Nikhil | `dashboard.test.js`, `sprint3-system.integration.test.js` | ST_08, UT_45 |
| **REQ-70** | [US-21](../../issues/50) | Prajwal | `charts.test.js`, `sprint3-system.integration.test.js` | ST_08, UT_46, UT_80 |
| **REQ-71** | [US-21](../../issues/50) | Prajwal | `charts.test.js`, `sprint3-system.integration.test.js` | UT_78 |
| **REQ-72** | [US-21](../../issues/50) | Prajwal | `sprint3-system.integration.test.js` | ST_51 |
| **REQ-73** | [US-22](../../issues/51) | Prajwal | `report.test.js`, `sprint3-system.integration.test.js` | IT_20 |
| **REQ-74** | [US-22](../../issues/51) | Prajwal | `report.test.js`, `sprint3-system.integration.test.js` | UT_79 |
| **REQ-75** | [US-22](../../issues/51) | Prajwal | `report.test.js`, `sprint3-system.integration.test.js` | IT_29 |
| **REQ-76** | [US-22](../../issues/51) | Prajwal | `report.test.js`, `sprint3-system.integration.test.js` | ST_52 |
| **REQ-77** | [US-22](../../issues/51) | Prajwal | `report.test.js`, `sprint3-system.integration.test.js` | ST_09, UT_54, UT_81 |
| **REQ-78** | [US-22](../../issues/51) | Prajwal | `bench-report.js`, `sprint3-system.integration.test.js` | ST_53 |
| **REQ-79** | [US-23](../../issues/57) | Nikhil | `attachment-validation.test.js`, `attachments.integration.test.js`&hellip; | ST_10, UT_51, UT_82 |
| **REQ-80** | [US-23](../../issues/57) | Nikhil | `attachment-validation.test.js`, `attachments.integration.test.js`&hellip; | ST_10, UT_52, UT_53 |
| **REQ-81** | [US-23](../../issues/57) | Nikhil | `attachment-validation.test.js`, `attachments.integration.test.js`&hellip; | ST_54 |
| **REQ-82** | [US-24](../../issues/58) | Nikhil | `import-export.integration.test.js`, `import-export.test.js`&hellip; | IT_30 |
| **REQ-83** | [US-24](../../issues/58) | Nikhil | `import-export.integration.test.js`, `import-export.test.js`&hellip; | ST_10, UT_55 |
| **REQ-84** | [US-24](../../issues/58) | Nikhil | `import-export.integration.test.js`, `sprint3-system.integration.test.js` | UT_56 |
| **REQ-85** | [US-24](../../issues/58) | Nikhil | `import-export.integration.test.js` | IT_31 |
| **REQ-86** | [US-24](../../issues/58) | Nikhil | `import-export.integration.test.js` | IT_14, IT_38, ST_10 |
| **REQ-87** | [US-24](../../issues/58) | Nikhil | `import-export.integration.test.js`, `sprint3-system.integration.test.js` | ST_55 |
| **REQ-88** | [US-25](../../issues/61) | Prajwal | - | IT_15 |
| **REQ-89** | [US-25](../../issues/61) | Prajwal | - | UT_59, UT_60 |
| **REQ-90** | [US-25](../../issues/61) | Prajwal | - | IT_32 |
| **REQ-91** | [US-25](../../issues/61) | Prajwal | - | IT_33 |
| **REQ-92** | [US-25](../../issues/61) | Prajwal | `sprint3-system.integration.test.js` | IT_34 |
| **REQ-93** | [US-25](../../issues/61) | Prajwal | `auth-integration.integration.test.js`, `sprint3-system.integration.test.js` | IT_16 |
| **REQ-94** | [US-26](../../issues/62) | Abdul | `admin-audit.integration.test.js`, `sprint3-system.integration.test.js` | IT_35 |
| **REQ-95** | [US-25](../../issues/61) | Prajwal | - | ST_11 |
| **REQ-96** | [US-26](../../issues/62) | Abdul | `admin-audit.integration.test.js`, `security-unit.test.js`&hellip; | ST_26 |
| **REQ-97** | [US-26](../../issues/62) | Abdul | `backup.integration.test.js`, `security-unit.test.js`&hellip; | ST_28 |

---

## Business rules

| Requirement | Story | Owner | Automated test | Test Plan |
| --- | --- | --- | --- | --- |
| **BR-1** | - | - | `sprint3-system.integration.test.js` | - |
| **BR-2** | - | - | `balance.test.js`, `sprint3-system.integration.test.js` | - |
| **BR-3** | - | - | `balance.test.js` | - |
| **BR-4** | [US-02](../../issues/13) | Abdul | `report.test.js`, `split-validation.test.js`&hellip; | - |
| **BR-5** | - | - | `budget.test.js` | - |
| **BR-6** | - | - | `budget.test.js` | - |
| **BR-7** | - | - | `sprint3-system.integration.test.js` | - |
| **BR-8** | - | - | `recurring.integration.test.js` | - |
| **BR-9** | - | - | `goal-withdrawals.integration.test.js`, `sprint3-system.integration.test.js` | - |
| **BR-10** | [US-02](../../issues/13) | Abdul | `sprint3-system.integration.test.js` | - |
| **BR-11** | - | - | `sprint3-system.integration.test.js`, `transaction-validation.test.js` | - |
| **BR-12** | - | - | `attachments.integration.test.js` | - |
| **BR-13** | - | - | `balance.test.js` | - |
| **BR-14** | - | - | `budget.test.js` | - |

---

## Performance

| Requirement | Story | Owner | Automated test | Test Plan |
| --- | --- | --- | --- | --- |
| **PER-1** | [US-27](../../issues/14) | Nikhil | `benchmark.js`, `request-timing.test.js`&hellip; | ST_29 |
| **PER-2** | [US-27](../../issues/14) | Nikhil | - | ST_30 |
| **PER-3** | [US-27](../../issues/14) | Nikhil | `benchmark.js`, `sprint3-system.integration.test.js` | ST_31 |
| **PER-4** | [US-27](../../issues/14) | Nikhil | `bench-report.js`, `benchmark.js` | - |
| **PER-5** | [US-27](../../issues/14) | Nikhil | `benchmark.js`, `request-timing.test.js` | ST_32 |
| **PER-6** | [US-27](../../issues/14) | Nikhil | `benchmark.js`, `sprint3-system.integration.test.js` | - |
| **PER-7** | [US-27](../../issues/14) | Nikhil | `benchmark.js` | ST_33 |
| **PER-8** | [US-27](../../issues/14) | Nikhil | - | ST_34 |
| **PER-9** | [US-27](../../issues/14) | Nikhil | `benchmark.js` | ST_35 |
| **PER-10** | [US-27](../../issues/14) [US-02](../../issues/13) | Abdul, Nikhil | `bench-report.js`, `benchmark.js` | - |
| **PER-11** | [US-27](../../issues/14) | Nikhil | - | ST_43 |

---

## Safety

| Requirement | Story | Owner | Automated test | Test Plan |
| --- | --- | --- | --- | --- |
| **SAF-1** | [US-29](../../issues/68) | Girish | - | ST_36 |
| **SAF-2** | [US-29](../../issues/68) | Girish | - | ST_37 |
| **SAF-3** | [US-29](../../issues/68) | Girish | `sprint3-system.integration.test.js`, `transaction-delete-restore.integration.test.js` | - |
| **SAF-4** | [US-29](../../issues/68) | Girish | - | ST_42 |
| **SAF-5** | [US-29](../../issues/68) | Girish | `import-export.integration.test.js` | ST_38 |
| **SAF-6** | [US-29](../../issues/68) | Girish | - | ST_39 |
| **SAF-7** | [US-29](../../issues/68) | Girish | - | ST_40 |
| **SAF-8** | [US-29](../../issues/68) | Girish | `attachments.integration.test.js` | ST_41 |

---

## Security

| Requirement | Story | Owner | Automated test | Test Plan |
| --- | --- | --- | --- | --- |
| **SEC-1** | [US-28](../../issues/67) | Abdul | `session-auth.test.js`, `sprint3-system.integration.test.js`&hellip; | - |
| **SEC-2** | [US-28](../../issues/67) | Abdul | `privacy.integration.test.js`, `security-unit.test.js` | - |
| **SEC-3** | [US-28](../../issues/67) | Abdul | `auth-integration.integration.test.js`, `privacy.integration.test.js`&hellip; | - |
| **SEC-4** | [US-28](../../issues/67) | Abdul | `auth-integration.integration.test.js`, `dev-auth.integration.test.js`&hellip; | - |
| **SEC-5** | [US-28](../../issues/67) | Abdul | `security.integration.test.js`, `sprint3-system.integration.test.js` | - |
| **SEC-6** | [US-28](../../issues/67) | Abdul | `secret-scan.test.js`, `security-unit.test.js`&hellip; | - |
| **SEC-7** | [US-28](../../issues/67) | Abdul | `rate-limit.integration.test.js`, `security-unit.test.js` | - |
| **SEC-8** | [US-28](../../issues/67) | Abdul | `app-lock.integration.test.js`, `app-lock.test.js`&hellip; | ST_12 |
| **SEC-9** | [US-28](../../issues/67) | Abdul | `secret-scan.test.js`, `security-unit.test.js`&hellip; | - |
| **SEC-10** | [US-28](../../issues/67) | Abdul | `security-unit.test.js`, `security.integration.test.js` | - |
| **SEC-11** | [US-28](../../issues/67) | Abdul | `secret-scan.test.js`, `security-unit.test.js`&hellip; | - |
| **SEC-12** | [US-28](../../issues/67) [US-01](../../issues/12) | Abdul, Prajwal | `dev-auth.integration.test.js`, `secret-scan.test.js`&hellip; | - |
| **SEC-13** | [US-28](../../issues/67) | Abdul | `privacy.integration.test.js` | - |

---

## Gaps

None. Every requirement in the SRS is named by an automated test, a Test
Plan case, or both.

## How the three sources line up

**SRS to backlog.** Every story issue copies its acceptance criteria
verbatim from the SRS, with the requirement ids kept, so opening any issue
shows which requirements it delivers.

**SRS to tests.** Automated test names carry the requirement id, which is
why this matrix can be generated rather than maintained by hand - and why
it cannot quietly go stale.

**Test Plan.** The 148 manual cases in the Test Plan carry requirement ids
in their descriptions; those are listed in the last column.
