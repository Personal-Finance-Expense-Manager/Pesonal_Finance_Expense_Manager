# Sprint 3 - System test cases

Twelve end-to-end cases that test the finished product as a whole.

Sprints 1 and 2 tested each story as it was built. These cases test the product
the way it is actually used: each one walks a complete journey across several
features and checks that they **agree with each other**, which is exactly where
per-story tests cannot reach. ST3-10, for example, fails if the dashboard, the
totals, the charts, the report and the exported file ever disagree about the
same money.

Everything below was executed against the running API and a real MongoDB. No
result in this document was written by hand.

```
TEST_MONGO_URI=mongodb://127.0.0.1:27017/pfem_test npm run test:system
```

**Result: 12 of 12 passed, 0 failed, 7.9 seconds.** Run twice; identical both
times. Source: `server/test/sprint3-system.integration.test.js`.

---

## Summary

| Case | What it proves | Requirements | Result |
| --- | --- | --- | --- |
| ST3-01 | A person can join, sign in, use the product and leave | US-01, US-03, US-04, US-25 · REQ-1..REQ-10, REQ-93, SEC-4 | **Pass** |
| ST3-02 | Balances follow transactions; debt is netted off net worth | US-06, US-07 · REQ-13..REQ-21, BR-4 | **Pass** |
| ST3-03 | Record, correct, delete and restore, with balances exact at every step | US-08, US-09 · REQ-22..REQ-30, BR-2 | **Pass** |
| ST3-04 | A transaction can be found again seven different ways | US-10 · REQ-31, REQ-74 | **Pass** |
| ST3-05 | A split bill reaches each category; a reimbursable item leaves budgets only | US-11 · REQ-32, REQ-33, REQ-50 | **Pass** |
| ST3-06 | Categories are seeded and protected; totals work by category and tag | US-12, US-13 · REQ-35..REQ-42 | **Pass** |
| ST3-07 | A budget tracks, warns and can be changed | US-14, US-15 · REQ-43..REQ-51 | **Pass** |
| ST3-08 | Recurring rules and bill reminders act on their own | US-16, US-17 · REQ-52..REQ-60 | **Pass** |
| ST3-09 | A savings goal takes money in and gives it back | US-18, US-19 · REQ-61..REQ-68 | **Pass** |
| ST3-10 | Every insight screen and every export agree on the same money | US-20, US-21, US-22 · REQ-69..REQ-78 | **Pass** |
| ST3-11 | Receipts, CSV/JSON export and re-import all round-trip | US-23, US-24 · REQ-79..REQ-92 | **Pass** |
| ST3-12 | Isolation, administration, audit and speed | US-05, US-26..US-29 · REQ-93..REQ-97, BR-10, SEC, SAF, PER | **Pass** |

---

## ST3-01 - A person can register, verify, sign in, use the product and sign out

**Covers:** US-01, US-03, US-04, US-25 · REQ-1 to REQ-10, REQ-93, SEC-4, SEC-5

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Call the health endpoint | API answers, database connected | `status: ok`, `database: connected` | Pass |
| 2. Register and verify an account | Account active and verified, role `user` | Verified, role `user` | Pass |
| 3. Open all 13 protected areas with the session | Every one returns 200 | All 13 returned 200 | Pass |
| 4. Open the same 13 with no credentials | Every one returns 401 | All 13 returned 401 | Pass |
| 5. Present a forged token | Refused | 401 | Pass |
| 6. Sign out, then reuse the same token | The session is dead | 401 | Pass |

The 13 areas are accounts, transactions, categories, tags, budgets, goals,
recurring rules, bill reminders, notifications, dashboard, totals, charts and
period reports. **Step 6 is the one that matters:** a token that still worked
after sign-out would mean sessions were never really ended.

---

## ST3-02 - Accounts hold balances that follow their transactions

**Covers:** US-06, US-07 · REQ-13 to REQ-21, BR-4

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Create a bank account and a credit card | Both created | Both created | Pass |
| 2. Re-use the bank's name in a different case | Refused | 409 | Pass |
| 3. Spend 1,500.50 and earn 5,000 from 20,000 | 23,499.50 | 23,499.50 | Pass |
| 4. Spend 2,000 on the card | Shown as money owed | Outstanding 2,000.00 | Pass |
| 5. Read net worth | Assets minus what is owed | Matched exactly | Pass |

Step 3 is to the paisa, which is what BR-4 requires of money.

---

## ST3-03 - Record, correct, delete and restore

**Covers:** US-08, US-09 · REQ-22 to REQ-30, BR-2

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Record `-10`, `0`, `abc`, `10.005` | All four refused | All 400 | Pass |
| 2. Record 1,000 expense and transfer 2,500 | A → 6,500, B → 2,500 | 6,500.00 / 2,500.00 | Pass |
| 3. Ask for period expenses | The transfer is not an expense | 1,000.00 only | Pass |
| 4. Correct 1,000 → 400 | Balance 7,100 | 7,100.00 | Pass |
| 5. Delete it | Balance 7,500, row in recycle bin | 7,500.00, found in bin | Pass |
| 6. Restore it | Balance 7,100 again | 7,100.00 | Pass |

Step 3 enforces **BR-2**: moving money between your own accounts is not income
or expense, so it must never inflate a spending figure.

---

## ST3-04 - Finding a transaction again

**Covers:** US-10 · REQ-31, REQ-74

Three transactions were recorded, then found by **type, category, tag, minimum
amount, note text, account, and a future-only date window** - seven filters, each
returning exactly the expected count. A filter matching nothing returned `200`
with zero rows, never an error.

| Filter | Expected | Actual | Result |
| --- | --- | --- | --- |
| `type=expense` | 2 | 2 | Pass |
| `categoryId=<Food>` | 1 | 1 | Pass |
| `tag=work` | 1 | 1 | Pass |
| `minAmount=1000` | 2 | 2 | Pass |
| `search=canteen` | 1 | 1 | Pass |
| `accountId=<wallet>` | 3 | 3 | Pass |
| `startDate=<tomorrow>` | 0 | 0 | Pass |
| No match at all | 200, empty | 200, empty | Pass |

---

## ST3-05 - A split bill, and an expense kept out of budgets

**Covers:** US-11 · REQ-32, REQ-33, REQ-50

A 3,000 supermarket bill split 1,800 groceries / 1,200 household, plus a 900
reimbursable expense marked excluded from budgets.

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Record the split bill | Accepted | 201 | Pass |
| 2. Split 1,800 + 1,000 against a 3,000 bill | Refused | 400 | Pass |
| 3. Read totals by category | Food 2,700, Shopping 1,200 | 2,700.00 / 1,200.00 | Pass |
| 4. Read the period total | 3,900, never double-counted | 3,900.00 | Pass |
| 5. Read the Food budget | 1,800 only | 1,800.00 | Pass |

**Step 5 is the heart of this case.** Food shows as **2,700 in reports** but
**1,800 against the budget**: the Shopping half is not its concern, and the 900
reimbursable is excluded from budgets while still counting everywhere else.
One number demonstrates REQ-32 and REQ-33 together.

---

## ST3-06 - Categories and tags

**Covers:** US-12, US-13 · REQ-35 to REQ-42

This case **registers through the real API** rather than inserting a user,
because REQ-35 is a promise made by registration - creating the record directly
would skip the very step being tested.

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Register, then list categories | Food, Transport, Rent, Salary present | All present | Pass |
| 2. Check income categories exist | At least one | Present | Pass |
| 3. Create a custom category | Accepted | 201 | Pass |
| 4. Re-use its name in another case | Refused | 409 | Pass |
| 5. Add a subcategory | Accepted | 201 | Pass |
| 6. Add a sub-subcategory | Refused | 400 | Pass |
| 7. Rename a built-in category | Refused | 403 | Pass |
| 8. Delete a built-in category | Refused | 403 | Pass |
| 9. Tag two expenses, read totals | Tag 1,000, category 1,000 | Both 1,000.00 | Pass |

Step 9 checks the same money totals correctly **both ways** - by tag and by
category - which is the point of having both.

---

## ST3-07 - Budgets

**Covers:** US-14, US-15 · REQ-43 to REQ-51

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Create a 5,000 monthly budget | Created, 0 spent | 201, 0.00 | Pass |
| 2. Spend 4,000 | Spent 4,000, ≥80% used, 1,000 left | 4,000.00, 1,000.00 | Pass |
| 3. Spend 2,000 more | Recorded, over 100% | 6,000.00, over | Pass |
| 4. Raise the limit to 8,000 | Stored, utilisation recomputed | 8,000.00, under 100% | Pass |

Step 3 confirms the product **reports** overspending rather than blocking it - a
budget is a plan, not a lock, and refusing the transaction would leave the
records not matching reality.

---

## ST3-08 - Recurring rules and bill reminders

**Covers:** US-16, US-17 · REQ-52 to REQ-60

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Create a monthly rule | Created with a next run date | 201, next date shown | Pass |
| 2. Create one ending before it starts | Refused | 400 | Pass |
| 3. Pause it | Status `paused` | `paused` | Pass |
| 4. Resume it | Status `active` | `active` | Pass |
| 5. Create a bill reminder | Created | 201 | Pass |
| 6. Mark the bill paid | 3,000 leaves the account | Balance fell by 3,000.00 | Pass |
| 7. Create a reminder with empty name, `-1`, `tomorrow` | Refused | 400 | Pass |

---

## ST3-09 - Savings goals

**Covers:** US-18, US-19 · REQ-61 to REQ-68

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. List goals | The goal is listed | Listed | Pass |
| 2. Contribute 5,000 | Goal holds 5,000 | 5,000.00 | Pass |
| 3. Withdraw 2,000 | Goal holds 3,000 | 3,000.00 | Pass |
| 4. Withdraw 999,999 | Refused | 4xx | Pass |
| 5. Compare net worth before and after | Unchanged | Unchanged | Pass |

**Step 5 is the real test.** Moving money between an account and a goal is not
earning or spending, so net worth must not move. If it did, saving would look
like getting richer.

---

## ST3-10 - Every insight screen agrees

**Covers:** US-20, US-21, US-22 · REQ-69 to REQ-78

Income 60,000; expenses 18,000 rent and 6,000 food.

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Totals, charts and report for the period | All read 24,000 | All 24,000.00 | Pass |
| 2. Income and net on the report | 60,000 and 36,000 | 60,000.00 / 36,000.00 | Pass |
| 3. Add up the chart's share percentages | Exactly 100 | 100 | Pass |
| 4. Add up the chart's slice amounts | Equal to the whole | Equal | Pass |
| 5. Trend length | 6 by default, 12 on request | 6 and 12 | Pass |
| 6. Ask for 7 months | Refused | 400 | Pass |
| 7. Largest spends | Biggest first, 18,000 | 18,000.00 first | Pass |
| 8. Report a period with no data | Empty state, not an error | 200, 0.00, no rows | Pass |
| 9. Compare against an empty period | Direction `up` | `up` | Pass |
| 10. Average daily spend and projection | Projection ≥ spent | Satisfied | Pass |
| 11. Download the CSV | Same categories and amounts | Contains `ST310 Rent`, `18000.00` | Pass |
| 12. Download the PDF | A real PDF with content | `%PDF-`, >800 bytes | Pass |

**Step 1 is the case's reason to exist:** four separate screens, built in three
different sprints, computing the same money independently. Step 3 catches the
rounding trap in REQ-70 - three equal thirds each round to 33.3 and would total
99.9, so shares are apportioned by largest remainder.

---

## ST3-11 - Receipts, export and import

**Covers:** US-23, US-24 · REQ-79 to REQ-92

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Attach a JPG receipt | Accepted | 201 | Pass |
| 2. Fetch it by its signed URL | Same bytes returned | Byte lengths matched | Pass |
| 3. Alter one character of that URL | Refused | 4xx | Pass |
| 4. Upload a `.exe` | Refused | 4xx | Pass |
| 5. Upload the same `.exe` renamed `.jpg` | Still refused | 4xx | Pass |
| 6. Export CSV | Contains the transactions and a header row | Both present | Pass |
| 7. Export JSON | Contains categories too | Present | Pass |
| 8. Preview an import | Nothing written | Count unchanged | Pass |
| 9. Commit the import | Exactly one row added, none rejected | 201, imported 1, 0 invalid | Pass |
| 10. Find the imported row | Amount 99.00 | 99.00 | Pass |

Step 5 is the stronger half of step 4: the **bytes** are checked, not the file
name, so renaming a program does not sneak it past.

Step 8 matters because an import that wrote anything during a preview would
make the preview worthless.

---

## ST3-12 - Isolation, administration, audit and speed

**Covers:** US-05, US-26 to US-29 · REQ-93 to REQ-97, BR-10, SEC-1 to SEC-5, SAF, PER-1, PER-3

Two ordinary users (Alice, Bob) and one administrator.

| Step | Expected | Actual | Result |
| --- | --- | --- | --- |
| 1. Bob lists accounts | Alice's account absent | Absent | Pass |
| 2. Bob lists transactions | Alice's note absent | Absent | Pass |
| 3. Bob edits Alice's transaction | Refused | 403/404 | Pass |
| 4. Bob deletes Alice's transaction | Refused | 403/404 | Pass |
| 5. Alice opens 4 admin areas | All refused | All 403 | Pass |
| 6. Administrator reads the summary | Allowed | 200 | Pass |
| 7. Administrator suspends Bob | Allowed | 200 | Pass |
| 8. Bob uses his existing session | Signed out everywhere | 401 | Pass |
| 9. Administrator restores Bob | Allowed | 200 | Pass |
| 10. Read the audit trail | The suspension and its reason are there | Reason found | Pass |
| 11. Check response headers | `nosniff`, framing restricted | Both present | Pass |
| 12. Load five screens at once | Under 5 seconds | Well under | Pass |

**Step 8 is the strongest assertion here.** Suspending an account is worthless
if the person's existing session keeps working - the check is not that they
cannot sign in again, but that the session they already hold stops at once.

---

## Notes on honesty

Seven of these twelve cases failed on their first run. Every one was a wrong
assumption in the **test**, not a defect in the product, and each was corrected
against the real API rather than by weakening the assertion:

- Net worth reports `total_assets` / `total_liabilities`; card debt is on the
  account's own `card.outstanding`.
- The transaction filter takes `categoryId`, not `category_id`.
- Default categories are seeded by **registration**, so the case now registers
  properly instead of inserting a user record.
- A budget's limit is `budgeted`.
- Goals take `source_account_id` and `destination_account_id`.
- A JPEG must end with the `FFD9` trailer, or content validation rejects it -
  the product was right and the test's fake file was genuinely malformed.
- Notes are **encrypted at rest**, so they cannot be used in a database filter.
  The product refuses such a query outright, which is correct.
- `POST /api/data/import/commit` answers `201`, not `200`.

Two of those - the JPEG trailer and the encrypted-note guard - are the product
defending itself correctly, and are worth pointing at during the demonstration.
