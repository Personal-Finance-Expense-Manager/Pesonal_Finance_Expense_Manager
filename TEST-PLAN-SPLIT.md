# Test Plan execution - who does what

The Test Plan has **148 cases** and only **10** carry a result. This splits the
remaining work four ways so it can be finished in parallel in one sitting.

Fill the **Actual Result** and **Test Result** columns in
`Test-Plan-Personal-Finance-Expense-Manager.docx` for the cases listed under
your name, and record what actually happened.

If a case fails, write down what you saw. A recorded failure with an honest
explanation is worth far more in the viva than a page of invented passes, and
`DEVIATIONS.md` exists for exactly that purpose.

## The split

| Person | Modules | Cases | Already evidenced |
| --- | --- | --- | --- |
| **Prajwal G (CS590)** | Category & Tag Management, Dashboard, Reports & Analytics, Profile, Settings, Security & Administration | 37 | 1 |
| **Abdul Muheeth K (CS550)** | Transaction Management, Recurring Transactions & Bill Reminders | 33 | 14 |
| **Girish G N (CS571)** | User Registration & Authentication, Savings Goals, Budget Management & Alerts | 38 | 8 |
| **Nikhil P (CS583)** | Account & Wallet Management, Data Import, Export & Attachments, Nonfunctional, Safety & Security | 40 | 17 |

Everyone has the modules they built, so you are testing your own work and will
be able to explain it in the viva - the demo FAQ says assessors ask exactly that.

## Two kinds of case, and they take very different amounts of time

**Already evidenced - 40 cases.** An automated test names this case ID and
passes. Put `Pass` in Test Result, and in Actual Result write what was observed
together with the evidence, for example:

> As expected. Verified by the automated suite (`balance.test.js`); 765 of 767
> tests pass - see `docs/TEST-REPORT-UNIT.md`.

These are quick - the work is done, it only needs recording.

**Needs execution - 108 cases.** Follow the steps in the document against the
running app and write down what you saw. Most take a minute or two.

## Before you start

Three terminals, from the project folder:

```
cd server; npm run dev
```

```
cd client; npm run dev
```

```
cd server; npm run seed:dev -- --fresh
```

Then open http://localhost:5173/ and sign in as `demo@pfem.local` with the
password `Demo@12345`.

For a few figures to work with:

```
cd server; npm run dev:spend -- --income 45000; npm run dev:spend -- Food 1200
```

To cite the automated suite:

```
cd server; npm test
```

---

# Prajwal G (CS590)

**37 cases** - 1 already evidenced, 36 to execute.

You built: US-12 categories, US-13 tags and totals, US-21 charts, US-22 reports, US-25 profile and security.

## Category & Tag Management  (11 cases)

Where to look: `#/categories` and `#/totals`

Sprint 3 ST3-06 already validates this area end to end (categories seeded and protected, totals by category and by tag), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-06, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_21` | Verify custom category creation with icon and colour (REQ-36) | - |
| `UT_22` | Verify custom category name length limit (REQ-36) | - |
| `UT_73` | Verify default expense and income categories are created for new users … | - |
| `UT_74` | Verify blank, whitespace and duplicate category names are rejected (REQ… | - |
| `IT_21` | Verify one-level subcategory rule (REQ-38) | - |
| `IT_22` | Verify system-defined categories cannot be renamed/deleted (REQ-39) | - |
| `UT_25` | Verify custom category deletion reassigns transactions to Uncategorized… | - |
| `ST_49` | Verify tag suggestions appear while typing and tag filter works (REQ-41) | - |
| `ST_50` | Verify category-wise and tag-wise totals are correct and refresh after … | - |
| `IT_06` | Verify category-wise and tag-wise totals through report aggregation (RE… | - |
| `ST_04` | Verify end-to-end custom category creation, deletion and aggregation (R… | - |

## Dashboard, Reports & Analytics  (14 cases)

Where to look: `#/dashboard`, `#/charts` and `#/reports`

Sprint 3 ST3-10 already validates this area end to end (dashboard, totals, charts, report and both exports agreeing), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-10, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_45` | Verify dashboard totals for current budget period (REQ-69) | Automated: `dashboard.test.js` |
| `UT_46` | Verify category-wise report percentages and amounts (REQ-70) | - |
| `UT_78` | Verify six-month and twelve-month income-versus-expense trends (REQ-71) | - |
| `ST_51` | Verify top five spending categories and five largest transactions (REQ-… | - |
| `IT_20` | Verify custom date range recomputes every figure and chart (REQ-73) | - |
| `UT_79` | Verify defined empty state for report with no data (REQ-74) | - |
| `IT_29` | Verify period comparison shows absolute and percentage differences (REQ… | - |
| `ST_52` | Verify average daily spend and projected period-end total (REQ-76) | - |
| `UT_54` | Verify report PDF and CSV exports match on-screen figures (REQ-77) | - |
| `ST_53` | Verify report generation completes within five seconds for 12 months/50… | - |
| `UT_80` | Verify category-wise expense breakdown renders correctly (REQ-70) | - |
| `UT_81` | Verify PDF and CSV report export are available and figures match (REQ-7… | - |
| `ST_08` | Verify dashboard and category report figures match underlying transacti… | - |
| `ST_09` | Verify report PDF and CSV exports contain the same figures as the displ… | - |

## Profile, Settings, Security & Administration  (12 cases)

Where to look: the signed-in screen and the app-lock area

Sprint 3 ST3-12 already validates this area end to end (isolation, administration, audit trail and headers), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-12, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_59` | Verify password change succeeds only with correct current password (REQ… | - |
| `UT_60` | Verify incorrect current password is rejected with exact message (REQ-8… | - |
| `IT_15` | Verify profile changes require email re-verification for a new email (R… | - |
| `IT_32` | Verify budget-breach and security alerts cannot be disabled (REQ-90) | - |
| `IT_33` | Verify application lock, theme and default account settings persist acr… | - |
| `IT_34` | Verify changing budget-period start day recomputes figures without chan… | - |
| `IT_16` | Verify RBAC returns HTTP 403 for unauthorized role actions (REQ-93) | - |
| `IT_35` | Verify administrator can manage account status but cannot view financia… | - |
| `ST_11` | Verify account deletion requires password confirmation and data erasure… | - |
| `ST_26` | Verify required audit events are recorded and retained for 12 months (R… | - |
| `ST_12` | Verify inactive web session expires after 30 minutes (SEC-8) | - |
| `ST_28` | Verify automated encrypted database backups occur every 24 hours and re… | - |

---

# Abdul Muheeth K (CS550)

**33 cases** - 14 already evidenced, 19 to execute.

You built: US-08 and US-09 transactions, US-16 recurring rules, US-17 bill reminders.

## Transaction Management  (18 cases)

Where to look: `#/transactions`

Sprint 3 ST3-03 and ST3-05 already validates this area end to end (record, correct, delete, restore, split bills and budget exclusion), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-03 and ST3-05, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_14` | Verify expense accepts all mandatory and optional fields (REQ-22) | - |
| `UT_15` | Verify income increases selected account balance (REQ-23) | - |
| `IT_05` | Verify own-account transfer creates linked debit/credit and does not ch… | - |
| `UT_16` | Verify invalid transaction amounts are rejected with exact message (REQ… | - |
| `UT_69` | Verify valid amount with at most two decimals is accepted (REQ-25) | - |
| `UT_17` | Verify transaction date before account opening is rejected (REQ-26) | - |
| `UT_70` | Verify transaction date more than one day in future is rejected (REQ-26) | - |
| `UT_71` | Verify note and tag limits with live note counter (REQ-27) | - |
| `UT_19` | Verify editing a transaction recomputes dependent figures immediately (… | Automated: `transaction-edit.integration.test.js` |
| `UT_20` | Verify soft delete and restore window for a transaction (REQ-29) | Automated: `transaction-delete-restore.integration.test.js` |
| `ST_13` | Verify transaction is permanently purged after 30 days and cannot be re… | Automated: `transaction-delete-restore.integration.test.js` |
| `ST_14` | Verify transaction list ordering, pagination and displayed fields (REQ-… | Already filled in |
| `ST_46` | Verify all transaction filters and note-text search return filtered tot… | Already filled in |
| `UT_72` | Verify expense split across up to five categories sums exactly (REQ-32) | - |
| `ST_48` | Verify excluded transaction remains in balance/reports but not budget u… | - |
| `ST_47` | Verify offline transaction synchronises within 60 seconds after connect… | - |
| `IT_04` | Verify transaction edit updates account, budget and report figures thro… | Automated: `transaction-edit.integration.test.js` |
| `ST_03` | Verify end-to-end expense creation, validation, transfer, edit and soft… | Automated: `transaction-edit.integration.test.js` |

## Recurring Transactions & Bill Reminders  (15 cases)

Where to look: `#/transactions` and the reminders area

Sprint 3 ST3-08 already validates this area end to end (a recurring rule generating, pausing and resuming, and a bill paid), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-08, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_33` | Verify recurring rule creation for supported frequency (REQ-52) | Automated: `recurring-validation.test.js`, `recurring.integration.test.js` |
| `UT_34` | Verify recurring rule supports end date, occurrence count or neither (R… | Automated: `recurring-validation.test.js`, `recurring.integration.test.js` |
| `UT_18` | Verify end date before start date is rejected with exact message (REQ-5… | Automated: `recurring-validation.test.js`, `recurring.integration.test.js` |
| `IT_09` | Verify scheduler generates due transaction at 00:05 IST and marks it sy… | Automated: `recurring.integration.test.js` |
| `IT_23` | Verify nonexistent monthly day uses last day of month (REQ-55) | Automated: `recurring.integration.test.js` |
| `IT_24` | Verify pause, resume, edit and delete affect only intended future occur… | Automated: `recurring.integration.test.js` |
| `IT_25` | Verify missed scheduler run recovers original dates without duplicates … | Automated: `recurring.integration.test.js` |
| `UT_77` | Verify bill reminder creation and default notification lead time (REQ-5… | - |
| `IT_28` | Verify bill reminder sends push and email on notification date (REQ-57) | - |
| `ST_18` | Verify marking bill paid creates linked expense and PAID state (REQ-58) | - |
| `ST_19` | Verify unpaid reminder becomes OVERDUE after due date (REQ-59) | Automated: `bill-reminder.test.js`, `bill-reminders.integration.test.js` |
| `IT_37` | Verify scheduler automatically generates a due recurring transaction (R… | - |
| `UT_37` | Verify bill reminder creation with required fields and default notifica… | Automated: `bill-reminder.test.js`, `bill-reminders.integration.test.js` |
| `IT_10` | Verify reminder notification is delivered by push and email (REQ-57) | - |
| `ST_06` | Verify recurring transaction generation and bill reminder lifecycle end… | - |

---

# Girish G N (CS571)

**38 cases** - 8 already evidenced, 30 to execute.

You built: US-03 register, US-04 sign-in, US-15 budget editing, US-18 and US-19 goals.

## User Registration & Authentication  (16 cases)

Where to look: the sign-up and sign-in screens at the home page

Sprint 3 ST3-01 already validates this area end to end (register, verify, sign in, every protected area, and sign-out ending the session), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-01, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_01` | Verify registration succeeds with valid required fields (REQ-1) | Already filled in |
| `UT_02` | Verify optional mobile number is accepted during registration (REQ-1) | Already filled in |
| `UT_03` | Verify invalid email format is rejected (REQ-2) | Already filled in |
| `UT_04` | Verify password complexity rules and unmet-rule feedback (REQ-3) | Already filled in |
| `UT_05` | Verify six-digit OTP format and ten-minute validity (REQ-4) | Already filled in |
| `UT_06` | Verify OTP attempt and resend limits (REQ-4) | Already filled in |
| `IT_01` | Verify five failed sign-ins lock the account for 15 minutes and notify … | - |
| `ST_01` | Verify successful login issues a 24-hour JWT (REQ-7) | - |
| `UT_76` | Verify duplicate active-account email is rejected without revealing oth… | Already filled in |
| `UT_61` | Verify password is stored only as salted bcrypt hash and never exposed … | - |
| `UT_62` | Verify password reset link is single-use and expires after 15 minutes (… | - |
| `IT_17` | Verify changing password invalidates all existing sessions (REQ-9) | - |
| `UT_63` | Verify sign-out invalidates server-side session token (REQ-10) | - |
| `UT_64` | Verify optional app lock uses PIN/biometric and re-locks after two minu… | Automated: `app-lock-client.test.js`, `app-lock.integration.test.js` |
| `UT_65` | Verify Terms and Privacy consent is mandatory at registration (REQ-12) | Already filled in |
| `UT_07` | Verify authentication unit logic accepts valid credentials for an activ… | - |

## Savings Goals  (9 cases)

Where to look: the goals area

Sprint 3 ST3-09 already validates this area end to end (contributions, withdrawals and net worth staying put), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-09, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_39` | Verify savings goal creation with name, target, date and optional linke… | Automated: `bill-reminders.integration.test.js` |
| `UT_41` | Verify invalid target amount/date are rejected (REQ-62) | - |
| `IT_26` | Verify contribution transfers funds, reduces source balance and is excl… | Automated: `bill-reminders.integration.test.js` |
| `UT_43` | Verify contribution exceeding available balance is rejected with exact … | - |
| `ST_20` | Verify goal progress details are displayed accurately (REQ-65) | - |
| `IT_11` | Verify goal becomes ACHIEVED at target and sends notification (REQ-66) | - |
| `IT_27` | Verify withdrawal is limited to saved amount and recalculates progress … | - |
| `ST_21` | Verify goal edit and deletion with confirmation returns saved amount (R… | - |
| `ST_07` | Verify savings goal creation, insufficient contribution handling and ac… | - |

## Budget Management & Alerts  (13 cases)

Where to look: `#/budgets`

Sprint 3 ST3-07 already validates this area end to end (a budget tracking, going over, and being raised), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-07, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_27` | Verify positive budget creation for category and overall spending (REQ-… | Automated: `budget.test.js` |
| `UT_28` | Verify zero and negative budgets are rejected (REQ-43) | Automated: `budget.test.js` |
| `UT_29` | Verify overlapping budget for same category and period is rejected (REQ… | - |
| `ST_15` | Verify active budget displays all required utilisation fields (REQ-45) | Automated: `budget.test.js` |
| `IT_07` | Verify 80% warning is raised once (REQ-46) | Automated: `budget.test.js` |
| `IT_08` | Verify 100% over-budget alert is raised once (REQ-46) | Automated: `budget.test.js` |
| `ST_16` | Verify budget edit recalculates utilisation and deletion preserves tran… | - |
| `UT_32` | Verify rollover carries unused amount and displays it separately (REQ-4… | - |
| `UT_75` | Verify repeat setting creates equivalent budget for next period (REQ-49) | - |
| `ST_17` | Verify excluded transactions and own-account transfers are excluded fro… | - |
| `ST_56` | Verify utilisation refreshes within five seconds after add, edit, delet… | - |
| `IT_36` | Verify 100% budget alert is raised when spending reaches or exceeds bud… | - |
| `ST_05` | Verify end-to-end budget creation, overlap validation, alerts and rollo… | - |

---

# Nikhil P (CS583)

**40 cases** - 17 already evidenced, 23 to execute.

You built: US-06 and US-07 accounts, US-23 receipts, US-24 import and export, US-27 performance.

## Account & Wallet Management  (12 cases)

Where to look: `#/accounts`

Sprint 3 ST3-02 already validates this area end to end (balances following transactions and net worth netting off debt), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-02, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_08` | Verify account creation with mandatory name and type (REQ-13) | - |
| `UT_09` | Verify all supported account types and currency are accepted (REQ-13) | - |
| `UT_10` | Verify duplicate account name is rejected (REQ-14) | - |
| `UT_66` | Verify opening-balance validation for zero, credit-card outstanding and… | - |
| `UT_67` | Verify current balance cannot be edited directly (REQ-16) | - |
| `UT_68` | Verify account archive hides it from transaction entry but retains it i… | - |
| `UT_12` | Verify deletion is allowed only for an account with no transactions (RE… | - |
| `IT_02` | Verify deletion with existing transactions is blocked and archive alter… | - |
| `IT_03` | Verify balance recomputes within two seconds after transaction change (… | Automated: `balance.test.js` |
| `UT_13` | Verify consolidated net worth calculation (REQ-20) | Automated: `balance.test.js` |
| `ST_45` | Verify credit-card details and 80% utilization warning (REQ-21) | Automated: `balance.test.js` |
| `ST_02` | Verify account creation, uniqueness, deletion rule, balance computation… | - |

## Data Import, Export & Attachments  (13 cases)

Where to look: `#/data`, and receipts on `#/transactions`

Sprint 3 ST3-11 already validates this area end to end (receipts, signed URLs, CSV and JSON export, and import), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-11, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `UT_51` | Verify up to three supported receipt attachments are accepted (REQ-79) | Automated: `attachment-validation.test.js`, `attachments.integration.test.js` |
| `UT_52` | Verify unsupported attachment type is rejected (REQ-80) | Automated: `attachment-validation.test.js`, `attachments.integration.test.js` |
| `UT_53` | Verify attachment over 5MB is rejected (REQ-80) | Automated: `attachment-validation.test.js`, `attachments.integration.test.js` |
| `ST_54` | Verify attachment view/download/delete uses short-lived signed URL for … | Automated: `attachment-validation.test.js`, `attachments.integration.test.js` |
| `IT_30` | Verify transaction CSV export uses documented order, ISO dates and deci… | Automated: `import-export.integration.test.js` |
| `UT_55` | Verify CSV import preview and column mapping occur before writing data … | Automated: `import-export.integration.test.js` |
| `UT_56` | Verify invalid CSV rows report row number/reason and only valid rows im… | Automated: `import-export.integration.test.js` |
| `IT_31` | Verify probable duplicates are flagged and skipped unless user chooses … | Automated: `import-export.integration.test.js` |
| `IT_14` | Verify balances, budgets and reports update after import (REQ-86) | Automated: `import-export.integration.test.js` |
| `ST_55` | Verify full JSON data export contains all supported user data (REQ-87) | Automated: `import-export.integration.test.js` |
| `UT_82` | Verify three supported receipt attachments can be attached to one trans… | Automated: `attachments.integration.test.js` |
| `IT_38` | Verify post-import balances, budgets and reports recompute consistently… | Automated: `import-export.integration.test.js` |
| `ST_10` | Verify attachments, CSV preview/import and post-import recomputation en… | - |

## Nonfunctional, Safety & Security  (15 cases)

Where to look: across the whole product

Sprint 3 ST3-12 already validates this area end to end (cross-user isolation, admin control, audit, headers and response time), and passes. Where a case here asks the same question, cite it:

> As expected. Covered end to end by Sprint 3 ST3-12, which passes - see `SPRINT-3-TEST-CASES.md` and
> `docs/TEST-REPORT-SYSTEM-VALIDATION.md`.

Read the case before citing it. Where it asks something ST3 does not
cover, run the steps and record what you saw.

| Case | What it checks | Evidence already available |
| --- | --- | --- |
| `ST_29` | Verify transaction save meets 1-second 95th percentile target over 4G (… | - |
| `ST_30` | Verify screens become interactive within 2s on 4G and 5s on 3G (PER-2) | - |
| `ST_31` | Verify dashboard renders within 3 seconds of sign-in (PER-3) | - |
| `ST_32` | Verify transaction list and filtering/search performance (PER-5) | - |
| `ST_33` | Verify 200 concurrent active users do not exceed 20% response-time degr… | - |
| `ST_34` | Verify scheduler completes due rules/reminders within 10 minutes of 00:… | - |
| `ST_35` | Verify 1000-row CSV import preview/commit performance (PER-9) | - |
| `ST_36` | Verify no financial advice or product recommendations are presented (SA… | - |
| `ST_37` | Verify projections and required monthly saving figures are labelled as … | - |
| `ST_38` | Verify failed transfer, goal contribution and CSV import leave no parti… | Automated: `import-export.integration.test.js` |
| `ST_39` | Verify stale balances are never displayed as current (SAF-6) | - |
| `ST_40` | Verify irreversible actions are preceded by clear warning (SAF-7) | - |
| `ST_41` | Verify no user can access another user's financial data (SAF-8) | Automated: `attachments.integration.test.js` |
| `ST_42` | Verify daily backup recovery objectives (SAF-4) | - |
| `ST_43` | Verify mobile package and offline cache size limits (PER-11) | - |

---

## When you are done

Send the filled document back to Prajwal, who will merge the four copies into
one and raise the pull request. Do not all edit the same file at the same time,
because Word will not merge it for you.

Two cases are expected to fail on a Windows machine, and that is fine - it is
already written up in `DEVIATIONS.md`. The backup consistency check needs
MongoDB running as a replica set, and the backup file permission check uses
POSIX permission bits that Windows does not implement. Record them as they
happened and point at the deviation.
