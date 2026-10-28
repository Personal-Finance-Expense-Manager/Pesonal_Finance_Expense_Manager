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
