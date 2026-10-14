# Product Backlog and Sprint Plan

**Project:** Personal Finance & Expense Manager (PFEM)  
**Team 9:** Abdul Muheeth K (PES1UG24CS550), Girish G N (PES1UG24CS571), Nikhil P (PES1UG24CS583), Prajwal G (PES1UG24CS590)  
**Baseline documents:** SRS v1.1, SADS, Test Plan v1.0  
**Created:** 12 October 2026 &nbsp;|&nbsp; **Consolidated:** 12 October 2026

**Board:** https://github.com/orgs/Personal-Finance-Expense-Manager/projects/1

---

## 1. How the backlog was built

Every item traces back to the baseline documents:

- The **97 functional requirements** (REQ-1 to REQ-97) of SRS Section 5 are each covered by exactly one user story. No requirement is covered twice and none is left out.
- The **non-functional requirements** of SRS Section 6 - 11 performance (PER), 8 safety (SAF) and 13 security (SEC) items - are carried by three dedicated stories.
- The **business rules** (BR-1 to BR-14) are referenced on the epic that enforces them.
- Acceptance criteria are quoted **verbatim from the SRS**, so a reviewer can check a story against the specification without interpretation.
- Each story names the **Test Plan** module whose UT / IT / ST cases verify it.

The backlog was first drafted as 58 fine-grained stories and then consolidated to **29**, merging closely related stories into deliverable slices of a sensible size. Requirement coverage is unchanged; the superseded issues were closed with a note pointing at the story that absorbed them.

## 2. Size and team capacity

**11 epics + 29 user stories = 40 backlog items, 183 story points.** Points use the Fibonacci scale (1, 2, 3, 5, 8) and measure relative effort, not hours.

| Team member | GitHub | Stories | Sprint 1 | Sprint 2 | Total |
|---|---|---:|---:|---:|---:|
| Abdul Muheeth K | `abdulmuheethk-1026` | 8 | 18 | 29 | **47** |
| Girish G N | `GIRISH-G-N` | 7 | 24 | 21 | **45** |
| Nikhil P | `nikhilreddynani1-beep` | 7 | 26 | 18 | **44** |
| Prajwal G | `prajwalgdevadiga` | 7 | 18 | 29 | **47** |
| | | **29** | **86** | **97** | **183** |

Sprint 1 is the lighter sprint (86 points against 97). It absorbs project set-up - repository skeleton, data model and CI pipeline - which produces no user-visible value but must exist before any feature can land. Sprint 2 runs at a higher feature velocity because the platform is already in place.

## 3. Sprint goals

### Sprint 1 - 19 to 23 October 2026 &nbsp;|&nbsp; 13 stories, 86 points

> **Goal:** a user can register, sign in, set up their accounts, record and find transactions against categories and tags, set a budget, and see it all on a dashboard.

A complete vertical slice: a working product demonstrable end to end in the required one-minute video.

### Sprint 2 - 26 to 30 October 2026 &nbsp;|&nbsp; 16 stories, 97 points

> **Goal:** the system automates what repeats, plans what is coming and explains what happened - recurring entries, bill reminders, savings goals, full analytics, import/export, administration and the non-functional hardening.

Sprint 2 closes with the two-minute video, completed documentation and a development freeze.

## 4. Backlog by epic

### [EPIC] 5.1 User Registration and Authentication &nbsp;&nbsp;`#1`

*REQ-1 to REQ-12 - 3 stories, 19 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #15 | US-03 | Register and verify a new account | REQ-1 ... REQ-12 (6) | 8 | S1 | Girish G N |
| #16 | US-04 | Sign in, sign out and keep the account secure | REQ-6 ... REQ-10 (5) | 8 | S1 | Girish G N |
| #17 | US-05 | Lock the app with a PIN or biometric | REQ-11 | 3 | S2 | Abdul Muheeth K |

### [EPIC] 5.2 Account and Wallet Management &nbsp;&nbsp;`#2`

*REQ-13 to REQ-21 - 2 stories, 13 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #20 | US-06 | Create, edit, archive and delete accounts | REQ-13 ... REQ-18 (6) | 8 | S1 | Nikhil P |
| #21 | US-07 | See balances, net worth and credit card position | REQ-19, REQ-20, REQ-21 | 5 | S1 | Nikhil P |

### [EPIC] 5.3 Transaction Management &nbsp;&nbsp;`#3`

*REQ-22 to REQ-34 - 4 stories, 26 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #24 | US-08 | Record expenses, income and transfers | REQ-22 ... REQ-27 (6) | 8 | S1 | Abdul Muheeth K |
| #25 | US-09 | Edit, delete and restore a transaction | REQ-28, REQ-29 | 5 | S1 | Abdul Muheeth K |
| #26 | US-10 | Browse, filter and search transactions | REQ-30, REQ-31 | 5 | S1 | Prajwal G |
| #27 | US-11 | Split, exclude and capture transactions offline | REQ-32, REQ-33, REQ-34 | 8 | S2 | Prajwal G |

### [EPIC] 5.4 Category and Tag Management &nbsp;&nbsp;`#4`

*REQ-35 to REQ-42 - 2 stories, 13 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #30 | US-12 | Manage default and custom categories | REQ-35 ... REQ-40 (6) | 8 | S1 | Girish G N |
| #31 | US-13 | Tag transactions and see category and tag totals | REQ-41, REQ-42 | 5 | S1 | Prajwal G |

### [EPIC] 5.5 Budget Management and Alerts &nbsp;&nbsp;`#5`

*REQ-43 to REQ-51 - 2 stories, 13 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #35 | US-14 | Create budgets and track utilisation with alerts | REQ-43 ... REQ-51 (6) | 8 | S1 | Nikhil P |
| #36 | US-15 | Edit, repeat and roll over a budget | REQ-47, REQ-48, REQ-49 | 5 | S2 | Girish G N |

### [EPIC] 5.6 Recurring Transactions and Bill Reminders &nbsp;&nbsp;`#6`

*REQ-52 to REQ-60 - 2 stories, 13 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #43 | US-16 | Create recurring rules and generate them automatically | REQ-52 ... REQ-60 (6) | 8 | S2 | Abdul Muheeth K |
| #44 | US-17 | Be reminded before a bill is due | REQ-57, REQ-58, REQ-59 | 5 | S2 | Abdul Muheeth K |

### [EPIC] 5.7 Savings Goals &nbsp;&nbsp;`#7`

*REQ-61 to REQ-68 - 2 stories, 13 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #47 | US-18 | Create and track savings goals | REQ-61 ... REQ-68 (5) | 8 | S2 | Girish G N |
| #48 | US-19 | Contribute to and withdraw from a goal | REQ-63, REQ-64, REQ-67 | 5 | S2 | Girish G N |

### [EPIC] 5.8 Dashboard, Reports and Analytics &nbsp;&nbsp;`#8`

*REQ-69 to REQ-78 - 3 stories, 18 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #34 | US-20 | See my dashboard | REQ-69 | 5 | S1 | Nikhil P |
| #50 | US-21 | See spending charts and my biggest outflows | REQ-70, REQ-71, REQ-72 | 5 | S2 | Prajwal G |
| #51 | US-22 | Report on any period, compare, project and export | REQ-73 ... REQ-78 (6) | 8 | S2 | Prajwal G |

### [EPIC] 5.9 Data Import, Export and Attachments &nbsp;&nbsp;`#9`

*REQ-79 to REQ-87 - 2 stories, 13 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #57 | US-23 | Attach a receipt to a transaction | REQ-79, REQ-80, REQ-81 | 5 | S2 | Nikhil P |
| #58 | US-24 | Import and export my data | REQ-82 ... REQ-87 (6) | 8 | S2 | Nikhil P |

### [EPIC] 5.10 Profile, Settings, Security and Administration &nbsp;&nbsp;`#10`

*REQ-88 to REQ-97 - 2 stories, 13 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #61 | US-25 | Manage my profile, settings and account security | REQ-88 ... REQ-95 (7) | 8 | S2 | Prajwal G |
| #62 | US-26 | Administer the platform with an audit trail and backups | REQ-94, REQ-96, REQ-97 | 5 | S2 | Abdul Muheeth K |

### [EPIC] 6. Platform, Quality and Infrastructure &nbsp;&nbsp;`#11`

*PER-1 to PER-11, SAF-1 to SAF-8, SEC-1 to SEC-13 - 5 stories, 29 points*

| # | ID | Story | Requirements | Pts | Sprint | Owner |
|---|---|---|---|---:|:---:|---|
| #12 | US-01 | Initialise the project skeleton and CI pipeline | project set-up | 8 | S1 | Prajwal G |
| #13 | US-02 | Define the data model for all entities | project set-up | 5 | S1 | Abdul Muheeth K |
| #14 | US-27 | Meet the performance targets | PER-1 ... PER-11 (11) | 5 | S2 | Nikhil P |
| #67 | US-28 | Harden the application against the OWASP Top 10 | SEC-1 ... SEC-13 (13) | 8 | S2 | Abdul Muheeth K |
| #68 | US-29 | Satisfy the safety requirements | SAF-1 ... SAF-8 (8) | 3 | S2 | Girish G N |

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
