# Product Backlog and Sprint Plan

**Project:** Personal Finance & Expense Manager (PFEM)  
**Team 9:** Abdul Muheeth K (PES1UG24CS550), Girish G N (PES1UG24CS571), Nikhil P (PES1UG24CS583), Prajwal G (PES1UG24CS590)  
**Baseline documents:** SRS v1.1, SADS, Test Plan v1.0  
**Created:** 12 October 2026

---

## 1. How the backlog was built

Every item in this backlog traces back to the baseline documents:

- The **97 functional requirements** (REQ-1 to REQ-97) of SRS Section 5 are each covered by exactly one user story. No requirement is covered twice and none is left out.
- The **non-functional requirements** of SRS Section 6 - 11 performance (PER), 8 safety (SAF) and 13 security (SEC) items - are carried by three dedicated stories.
- The **business rules** (BR-1 to BR-14) are referenced on the epic that enforces them.
- Acceptance criteria are quoted **verbatim from the SRS** so that a reviewer can check a story against the specification without interpretation.
- Each story names the **Test Plan** module whose UT / IT / ST cases verify it.

## 2. Estimation and team capacity

Story points use the Fibonacci scale (1, 2, 3, 5, 8) and measure relative effort, not hours. The whole backlog is **219 points across 58 stories and 11 epics**.

| Team member | GitHub | Stories | Sprint 1 | Sprint 2 | Total |
|---|---|---:|---:|---:|---:|
| Abdul Muheeth K | `abdulmuheethk-1026` | 14 | 22 | 33 | **55** |
| Girish G N | `GIRISH-G-N` | 16 | 26 | 33 | **59** |
| Nikhil P | `nikhilreddynani1-beep` | 12 | 27 | 24 | **51** |
| Prajwal G | `prajwalgdevadiga` | 16 | 22 | 32 | **54** |
| | | **58** | **97** | **122** | **219** |

Sprint 1 is deliberately the lighter sprint (97 points against 122). It absorbs project set-up - repository skeleton, data model and CI pipeline - which produces no user-visible value but must exist before any feature can land. Sprint 2 runs at a higher feature velocity because the platform is already in place.

## 3. Sprint goals

### Sprint 1 - 19 to 23 October 2026

> **Goal:** a user can register, sign in, set up their accounts, record and find transactions against categories and tags, set a budget, and see it all on a dashboard.

This is a complete vertical slice: a working product that can be demonstrated end to end in the required one-minute video.

### Sprint 2 - 26 to 30 October 2026

> **Goal:** the system automates what repeats, plans what is coming, and explains what happened - recurring entries, bill reminders, savings goals, full analytics, import/export, administration and the non-functional hardening.

Sprint 2 closes with the two-minute video, completed documentation and a development freeze.

## 4. Backlog by epic

### [EPIC] 5.1 User Registration and Authentication &nbsp;&nbsp;`#1`

*REQ-1 to REQ-12 - 6 stories, 20 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #15 | US-04 | Register a new account | 5 | S1 | Girish G N |
| #16 | US-05 | Verify my email address | 3 | S1 | Girish G N |
| #17 | US-06 | Sign in and sign out | 3 | S1 | Girish G N |
| #18 | US-07 | Store passwords securely and lock out brute force | 3 | S1 | Abdul Muheeth K |
| #19 | US-08 | Reset a forgotten password | 3 | S1 | Girish G N |
| #39 | US-28 | Lock the app with a PIN or biometric | 3 | S2 | Girish G N |

### [EPIC] 5.2 Account and Wallet Management &nbsp;&nbsp;`#2`

*REQ-13 to REQ-21 - 4 stories, 13 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #20 | US-09 | Create an account or wallet | 3 | S1 | Nikhil P |
| #21 | US-10 | Edit, archive and delete an account | 3 | S1 | Nikhil P |
| #22 | US-11 | See account balances and net worth | 5 | S1 | Nikhil P |
| #23 | US-12 | See credit card outstanding and available credit | 2 | S1 | Prajwal G |

### [EPIC] 5.3 Transaction Management &nbsp;&nbsp;`#3`

*REQ-22 to REQ-34 - 9 stories, 32 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #24 | US-13 | Record an expense or an income | 5 | S1 | Abdul Muheeth K |
| #25 | US-14 | Record a transfer between my accounts | 3 | S1 | Abdul Muheeth K |
| #26 | US-15 | Edit a transaction | 3 | S1 | Abdul Muheeth K |
| #27 | US-16 | Delete and restore a transaction | 3 | S1 | Abdul Muheeth K |
| #28 | US-17 | Browse my transactions | 3 | S1 | Prajwal G |
| #29 | US-18 | Filter and search transactions | 3 | S1 | Prajwal G |
| #40 | US-29 | Split an expense across categories | 3 | S2 | Abdul Muheeth K |
| #41 | US-30 | Exclude a transaction from budgets | 1 | S2 | Abdul Muheeth K |
| #42 | US-31 | Record transactions offline and synchronise | 8 | S2 | Prajwal G |

### [EPIC] 5.4 Category and Tag Management &nbsp;&nbsp;`#4`

*REQ-35 to REQ-42 - 4 stories, 13 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #30 | US-19 | Get a default set of categories | 2 | S1 | Girish G N |
| #31 | US-20 | Manage custom categories and subcategories | 5 | S1 | Girish G N |
| #32 | US-21 | Tag a transaction | 3 | S1 | Prajwal G |
| #33 | US-22 | See category-wise and tag-wise totals | 3 | S1 | Prajwal G |

### [EPIC] 5.5 Budget Management and Alerts &nbsp;&nbsp;`#5`

*REQ-43 to REQ-51 - 4 stories, 16 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #35 | US-24 | Create a budget | 5 | S1 | Nikhil P |
| #36 | US-25 | Track budget utilisation | 3 | S1 | Nikhil P |
| #37 | US-26 | Be alerted as a budget runs out | 3 | S1 | Nikhil P |
| #38 | US-27 | Edit, repeat and roll over a budget | 5 | S1 | Girish G N |

### [EPIC] 5.6 Recurring Transactions and Bill Reminders &nbsp;&nbsp;`#6`

*REQ-52 to REQ-60 - 4 stories, 18 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #43 | US-32 | Create a recurring rule | 3 | S2 | Abdul Muheeth K |
| #44 | US-33 | Generate recurring transactions automatically | 8 | S2 | Abdul Muheeth K |
| #45 | US-34 | Pause, resume, edit or delete a recurring rule | 2 | S2 | Abdul Muheeth K |
| #46 | US-35 | Be reminded before a bill is due | 5 | S2 | Abdul Muheeth K |

### [EPIC] 5.7 Savings Goals &nbsp;&nbsp;`#7`

*REQ-61 to REQ-68 - 3 stories, 11 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #47 | US-36 | Create a savings goal | 3 | S2 | Girish G N |
| #48 | US-37 | Contribute to and withdraw from a goal | 5 | S2 | Girish G N |
| #49 | US-38 | Track goal progress | 3 | S2 | Girish G N |

### [EPIC] 5.8 Dashboard, Reports and Analytics &nbsp;&nbsp;`#8`

*REQ-69 to REQ-78 - 8 stories, 26 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #34 | US-23 | See my dashboard | 5 | S1 | Nikhil P |
| #50 | US-39 | See a category-wise expense breakdown | 3 | S2 | Prajwal G |
| #51 | US-40 | See income versus expense over time | 3 | S2 | Prajwal G |
| #52 | US-41 | See top categories and largest transactions | 2 | S2 | Prajwal G |
| #53 | US-42 | Report on any date range, with clear empty states | 3 | S2 | Prajwal G |
| #54 | US-43 | Compare two periods | 3 | S2 | Prajwal G |
| #55 | US-44 | See average daily spend and a projection | 2 | S2 | Prajwal G |
| #56 | US-45 | Export a report and meet report performance targets | 5 | S2 | Prajwal G |

### [EPIC] 5.9 Data Import, Export and Attachments &nbsp;&nbsp;`#9`

*REQ-79 to REQ-87 - 4 stories, 19 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #57 | US-46 | Attach a receipt to a transaction | 5 | S2 | Nikhil P |
| #58 | US-47 | Export my transactions to CSV | 3 | S2 | Nikhil P |
| #59 | US-48 | Import transactions from a CSV file | 8 | S2 | Nikhil P |
| #60 | US-49 | Export all of my data | 3 | S2 | Nikhil P |

### [EPIC] 5.10 Profile, Settings, Security and Administration &nbsp;&nbsp;`#10`

*REQ-88 to REQ-97 - 6 stories, 22 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #61 | US-50 | Manage my profile and settings | 5 | S2 | Girish G N |
| #62 | US-51 | Enforce role-based access control | 5 | S2 | Girish G N |
| #63 | US-52 | Administer the platform | 3 | S2 | Girish G N |
| #64 | US-53 | Delete my account | 3 | S2 | Girish G N |
| #65 | US-54 | Write an audit trail | 3 | S2 | Abdul Muheeth K |
| #66 | US-55 | Back up the database automatically | 3 | S2 | Prajwal G |

### [EPIC] 6. Platform, Quality and Infrastructure &nbsp;&nbsp;`#11`

*PER-1 to PER-11, SAF-1 to SAF-8, SEC-1 to SEC-13 - 6 stories, 29 points*

| # | ID | Story | Pts | Sprint | Owner |
|---|---|---|---:|:---:|---|
| #12 | US-01 | Initialise the MERN project skeleton | 5 | S1 | Prajwal G |
| #13 | US-02 | Set up the GitHub Actions CI pipeline | 3 | S1 | Prajwal G |
| #14 | US-03 | Define the Mongoose data model for all entities | 5 | S1 | Abdul Muheeth K |
| #67 | US-56 | Meet the performance targets | 5 | S2 | Nikhil P |
| #68 | US-57 | Harden the application against the OWASP Top 10 | 8 | S2 | Abdul Muheeth K |
| #69 | US-58 | Satisfy the safety requirements | 3 | S2 | Girish G N |

## 5. Working agreement

1. A story is picked up only when it carries a sprint label, an owner and an estimate.
2. The assignee works on a branch named `feature/<US-id>-<short-slug>` and opens a pull request that closes the issue (`Closes #<n>`).
3. A pull request may be merged only after the GitHub Actions pipeline is green and a repository owner has reviewed it. Nobody merges their own pull request.
4. A story is Done when its acceptance criteria are all ticked, the corresponding Test Plan cases have Actual Result and Test Result filled in, and the pull request is merged.
5. Any deviation from the SRS, SADS or Test Plan is written into the pull request description and carried into the final demonstration.

## 6. Deliverable checklist

| Deliverable | Due | Status |
|---|---|---|
| Backlog created in GitHub, estimated and assigned | 12 Oct 2026 | Done |
| Sprint dry run | 12-16 Oct 2026 | Planned |
| Sprint 1 implementation | 19-23 Oct 2026 | Not started |
| Sprint 1 video (1 minute, working product), uploaded to the repo | 23 Oct 2026 | Not started |
| Sprint 2 implementation | 26-30 Oct 2026 | Not started |
| Sprint 2 video (2 minutes, working product), uploaded to the repo | 30 Oct 2026 | Not started |
| Documentation complete, development frozen | 30 Oct 2026 | Not started |
