# Personal Finance & Expense Manager

A web-based application designed to help users manage their personal finances by tracking income, expenses, budgets, and financial activities in an organized and efficient manner.

---

## Project Overview

Managing personal finances manually can be difficult and time-consuming. Users often struggle to keep track of their daily expenses, understand their spending patterns, and maintain a clear view of their financial situation.

The **Personal Finance & Expense Manager** aims to provide a centralized platform where users can record and categorize their financial transactions, monitor their spending, set budgets, and gain useful insights into their financial habits.

The system will provide an easy-to-use interface for managing financial records and presenting relevant information through summaries and visualizations.

---

## Objectives

- Track and manage personal income and expenses.
- Categorize expenses for better financial organization.
- Monitor spending patterns and financial activities.
- Set and manage budgets.
- Provide summaries of income, expenses, and savings.
- Help users identify unnecessary or excessive spending.
- Provide a simple and user-friendly interface.
- Maintain financial records securely and efficiently.

---

## Key Features

### User Management
- User registration and login.
- Secure authentication.
- User-specific financial data.

### Income Management
- Add income transactions.
- Edit and delete income records.
- Categorize different sources of income.
- View total income over a selected period.

### Expense Management
- Add, edit, and delete expenses.
- Categorize expenses such as Food, Travel, Education, Shopping, Bills, etc.
- Track expenses based on date and category.
- View total expenditure over a selected period.

### Financial Dashboard
- Overview of income and expenses.
- Current balance.
- Expense breakdown by category.
- Monthly financial summaries.
- Graphical representation of spending patterns.

### Budget Management
- Create budgets for different categories.
- Monitor budget utilization.
- Track remaining budget.
- Identify when spending approaches or exceeds a budget.

### Financial Insights
- Analyze spending patterns.
- Compare income and expenses.
- Identify major expense categories.
- Provide useful summaries to help users make better financial decisions.

---

## Technologies

The project is planned to use the following technologies:

### Frontend
- HTML
- CSS
- JavaScript
- React.js

### Backend
- Node.js
- Express.js

### Database
- MongoDB

### Alternative Backend
- Python
- Flask / Django

### Development Tools
- Git
- GitHub
- Visual Studio Code

---

## Proposed System Architecture

```text
                    ┌─────────────────────┐
                    │       User          │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   React Frontend    │
                    │   User Interface    │
                    └──────────┬──────────┘
                               │
                         REST API Requests
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Backend Server     │
                    │ Node.js / Express   │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      MongoDB        │
                    │      Database       │
                    └─────────────────────┘
```

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 or newer | `node --version` |
| npm | 10 or newer | ships with Node |
| MongoDB | 6 or newer | a local install, or a free MongoDB Atlas cluster |
| Git | any recent | `git --version` |

### 1. Clone the repository

```bash
git clone https://github.com/Personal-Finance-Expense-Manager/Pesonal_Finance_Expense_Manager.git
cd Pesonal_Finance_Expense_Manager
```

### 2. Configure and start the API server

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Edit `server/.env` and set `MONGO_URI` to your database. Never commit this file -
it is ignored by git, and SEC-12 of the SRS requires secrets to come from the
environment.

The API listens on <http://localhost:5000>. Check it is alive:

```bash
curl http://localhost:5000/api/health
```

```json
{ "status": "ok", "service": "pfem-api", "database": "connected" }
```

If `database` reads `disconnected`, the API is up but MongoDB is not reachable -
check that `mongod` is running and that `MONGO_URI` is correct.

### 3. Start the web client

In a second terminal:

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

The client runs on <http://localhost:5173> and shows the current API status on
its home page.

### Available scripts

| Location | Command | Purpose |
|---|---|---|
| `server/` | `npm run dev` | start the API with auto-reload |
| `server/` | `npm start` | start the API once |
| `server/` | `npm run bench` | performance benchmark against a throwaway database (see `PERFORMANCE.md`) |
| `client/` | `npm run dev` | start the Vite dev server |
| `client/` | `npm run build` | production build into `client/dist` |
| `client/` | `npm run lint` | lint the client |

---

## Import and export

Open **Import & export** from the home screen (`#/data`). SRS 5.9, REQ-82 to REQ-87.

**Transaction CSV (export and import).** UTF-8 with a byte-order mark so Excel
opens it correctly, comma-separated, RFC 4180 quoting, one row per entry, in
this column order:

| # | Column | Contents |
|---|---|---|
| 1 | `date` | ISO 8601 calendar date, `YYYY-MM-DD` |
| 2 | `type` | `income`, `expense` or `transfer` |
| 3 | `amount` | plain decimal with two places, e.g. `1234.50` (no symbol, no separators) |
| 4 | `currency` | ISO 4217 code of the account, e.g. `INR` |
| 5 | `account` | account name (the source account of a transfer) |
| 6 | `to_account` | destination account name, transfers only |
| 7 | `category` | category name, blank if uncategorised |
| 8 | `payment_mode` | `cash`, `card`, `upi`, `bank_transfer`, `wallet` or `other` |
| 9 | `note` | free text |
| 10 | `tags` | tag names separated by `;` |

A text cell that starts with `=`, `+`, `-` or `@` is written with a leading
apostrophe so a spreadsheet does not run it as a formula; the import removes it.

**Import rules.** Any CSV can be imported: its columns are matched to the
fields above by heading, and the user can change the match. Nothing is written
until the user confirms the preview. Accounts and categories are matched by
name and must already exist. Dates may be `YYYY-MM-DD` or `DD/MM/YYYY`; amounts
may carry `₹`, `INR` or thousands separators. Without a type column every row is
an expense. A row matching an existing entry on date, amount, account and note
is a probable duplicate and is skipped unless ticked. A file can hold up to
5,000 rows (about 900 KB).

**All my data (JSON).** One file with the profile (no password or security
fields), accounts, categories, tags, transactions, transfers, attachment
names, budgets, goals, recurring rules, reminders and notifications. Amounts are
decimal strings and dates ISO 8601.

---

## App lock

Open **App lock** from the signed-in home screen (`#/security`). SRS 5.1,
REQ-11, SEC-8, HI-2.

- **Optional.** Off until you choose a four-digit PIN. You can change the PIN or
  turn the lock off (both ask for the PIN) from the same page.
- **Re-locks after two minutes in the background.** While the app is on screen it
  tells the server every 30 seconds; hidden or closed, it stops, and the *server*
  locks the session two minutes later. While locked, every API route except the
  lock's own and sign-out answers `423`, so the lock cannot be bypassed by
  editing the page.
- **Fingerprint or face.** Where the browser and device offer it (HTTPS or
  `localhost`, and a fingerprint, face or screen-lock set up), the device can
  unlock instead of the PIN. This is WebAuthn: the server stores only a public
  key. The PIN always works as the fallback.
- **Wrong PINs.** Five in a row sign you out everywhere; sign in with your
  password to continue. **Forgot PIN?** on the lock screen sets a new one with
  your account password.

Server settings (see `server/.env.example`): `APP_LOCK_SECRET` (falls back to
`JWT_SECRET`), and `WEBAUTHN_ORIGIN` / `WEBAUTHN_RP_ID`, which default to
`CLIENT_ORIGIN` and its host name. Endpoints: `/api/app-lock/` `status`,
`heartbeat`, `lock`, `unlock`, `pin`, `pin/change`, `pin/reset`, `disable`,
`biometric/register/options`, `biometric/register/verify`, `biometric/options`,
`DELETE biometric`. Design notes and deviations: `DEVIATIONS.md` section 8.

---

## Recurring transactions and bill reminders

**Recurring transactions (US-16).** `#/recurring` creates rules (daily, weekly,
monthly, quarterly, yearly; optional end date *or* occurrence count). Each due
date a transaction is created for the rule, from 00:05 IST, marked
system-generated and linked to its rule. It is an ordinary transaction: it can
be edited and it moves the account balance like any other. A rule can be
edited (future occurrences only), paused, resumed (the paused period is not
back-filled) and deleted (transactions already created are kept). A scheduled
31st falls on the last day of shorter months and returns to the 31st after
them (31 Jan, 28/29 Feb, 31 Mar, 30 Apr).

**Bill reminders (US-17).** `#/bills` holds reminders with a due date and a
lead time (default 3 days). **Mark as paid** records a real expense, links it
to the reminder and sets the reminder to Paid; pressing it twice, or from two
tabs, creates one expense. An unpaid bill after its due date becomes Overdue
and is shown first on the dashboard.

**How the scheduler stays correct.** It is a catch-up pass, not a timer per
rule. It runs when the API starts and then every minute, and each pass creates
exactly the occurrences that are due and not yet created, each with its
original due date. Duplicates are prevented by the database, not by the
timer: a ledger collection (`recurringoccurrences`) has a unique index on
(rule, scheduled date), and transactions carry unique indexes on
(rule, scheduled date) and on the reminder they paid. A deleted or purged
generated transaction therefore is not generated again, and several API
instances can run side by side. `SCHEDULER_ENABLED=false` switches it off.

**Notifications.** Each reminder is sent once per channel on its notification
date (due date minus lead time), from 00:05 IST. Every attempt is recorded in
`notificationdeliveries` with an honest status: `sent`, `failed` (retried up to
three times with exponential backoff), `skipped_not_configured` or
`logged_dev`. A status of `sent` means a real provider accepted the message.

| Channel | Status |
|---|---|
| In-app | Works out of the box (shown on `#/bills`). |
| Email | Works when `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` are set. |
| Push | **Needs a provider, which is not configured here.** The channel, the subscription store (`POST /api/notifications/push-subscriptions`) and the delivery log are in place. To switch it on, register an object with `async send(subscription, { title, body, data })` using `setPushProvider()` from `server/src/services/notifications/channels.js` at start-up (for example a Web Push sender configured with VAPID keys). Until then push is recorded as `skipped_not_configured`. |

## Repository Layout

```text
.
├── client/          React web client (Vite)
├── server/          Express REST API
│   └── src/
│       ├── app.js       express app and middleware
│       ├── index.js     entry point
│       ├── config/      database connection
│       └── routes/      API routers
├── .github/         CI workflows, PR template, CODEOWNERS
├── BACKLOG.md       product backlog and sprint plan
└── *.docx / *.pdf   SRS, SADS, Test Plan and Test Cases
```

This mirrors the three-tier architecture in SRS Figure 2.1 and the SADS:
the React client talks only to the Express API, and only the API touches MongoDB.

---

## Project Management

- **Backlog and sprint plan:** [BACKLOG.md](BACKLOG.md)
- **Board:** <https://github.com/orgs/Personal-Finance-Expense-Manager/projects/1>
- **Sprint 1:** 19 - 23 October 2026 - 13 stories, 86 points
- **Sprint 2:** 26 - 30 October 2026 - 16 stories, 97 points

Every pull request must reference its backlog issue and is reviewed by a
repository owner before merging.
