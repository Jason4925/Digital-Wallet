<div>

# 💳 Digital Wallet Simulator

**A full-stack, realistically engineered digital wallet web application — built for learning, teaching, and demonstration.**
**No real money, banking rail, UPI system, or payment gateway is ever involved.**

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7.1-646CFF?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%20%2B%20Realtime-3ECF8E?logo=supabase&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-4.5-FF6384?logo=chart.js&logoColor=white)
![Status](https://img.shields.io/badge/Status-Simulation%20Only-blue)

</div>

> ⚠️ **Simulation Disclaimer** — This project does **not** connect to any bank, UPI network, card scheme, or payment processor. Every balance and transaction is simulated data stored in a Supabase database that **you** own and control. It must not be used to hold or move real money without a complete redesign for financial-grade security and regulatory compliance.

---

## 📖 Table of Contents

1. [Overview](#-overview)
2. [Why This Project Exists](#-why-this-project-exists)
3. [Feature Highlights](#-feature-highlights)
4. [Tech Stack](#-tech-stack)
5. [System Architecture](#-system-architecture)
6. [Project Structure](#-project-structure)
7. [Prerequisites](#-prerequisites)
8. [Getting Started](#-getting-started)
   - [1. Clone the Repository](#1-clone-the-repository)
   - [2. Install Dependencies](#2-install-dependencies)
   - [3. Create a Supabase Project](#3-create-a-supabase-project)
   - [4. Run the Database Schema](#4-run-the-database-schema)
   - [5. Configure Environment Variables](#5-configure-environment-variables)
   - [6. Run the App Locally](#6-run-the-app-locally)
   - [7. Verify Everything Works](#7-verify-everything-works)
9. [Environment Variables Reference](#-environment-variables-reference)
10. [NPM Scripts](#-npm-scripts)
11. [Application Walkthrough](#-application-walkthrough)
12. [Validation Rules & Limits](#-validation-rules--limits)
13. [Security Model](#-security-model)
14. [Realtime Sync Explained](#-realtime-sync-explained)
15. [Testing the Realtime Flow Locally](#-testing-the-realtime-flow-locally)
16. [Building for Production](#-building-for-production)
17. [Resetting Data](#-resetting-data)
18. [Troubleshooting / FAQ](#-troubleshooting--faq)
19. [Roadmap](#-roadmap)
20. [Documentation Index](#-documentation-index)
21. [Contributing](#-contributing)
22. [Final Reminder](#️-final-reminder)

---

## 🧭 Overview

**Digital Wallet Simulator** is a browser-based application that reproduces the full experience of a modern digital wallet — account creation, wallet PIN security, deposits, withdrawals, peer-to-peer transfers, QR code payments, budgeting, analytics, recurring payments, and live notifications — while remaining **100% simulated**.

It is built on a real, production-style stack:

- A **Node.js** backend (no framework — the native `http` module) exposing a small, consistent JSON API
- A **Supabase PostgreSQL** database as the single source of truth, with money-movement logic implemented as atomic SQL functions
- **Supabase Realtime** bridged through **Server-Sent Events (SSE)** so multiple open sessions update live
- A **vanilla HTML/CSS/JavaScript** frontend (ES Modules, no framework) bundled by **Vite**

Every design decision mirrors how a real fintech product would be engineered — hashed credentials, atomic transactions, row-level locking, session security, and a strict client/server trust boundary — so the codebase doubles as a genuine reference implementation, not just a toy demo.

---

## 🎯 Why This Project Exists

- Digital wallets are used by billions of people, but almost nobody gets to see how one actually works internally.
- Learners rarely get a **safe, complete, end-to-end** fintech-style codebase to study, extend, or break.
- This project provides exactly that: a **teaching-grade, portfolio-grade, and demo-grade** wallet application that is safe to run, safe to share, and safe to experiment with.

---

## ✨ Feature Highlights

### 🔐 Accounts & Security
- Custom registration with **name + email-style login ID + password** (no real email delivery needed — the "email" is just a unique identifier)
- Passwords hashed with **`scrypt`** (salted, memory-hard KDF) — never stored or logged in plain text
- Legacy SHA-256 hashes are automatically upgraded to `scrypt` on next successful login
- Session-based auth via **secure, HTTP-only cookies** (not `localStorage`, not JS-readable tokens)
- A **separate 4-digit Wallet PIN** authorizes every money-moving transaction, independent of the login password
- PIN **locks after 3 failed attempts**; recoverable only via the account password
- **Reset My Simulation** (wipes wallet activity, keeps the account) and **Delete Account** (fully permanent) both gated behind password confirmation

### 💰 Wallet Operations
- Simulated **deposits** and **withdrawals** with category + note
- **Wallet-to-wallet transfers** with server-side recipient verification before any confirmation is shown
- A guided **3-step transfer flow**: Recipient → Review → PIN Authorization
- All balance arithmetic happens inside PostgreSQL (`numeric(18,2)`) — never in JavaScript — eliminating floating-point rounding bugs
- Transfers lock **both** wallet rows in a stable order to guarantee atomicity and prevent deadlocks between simultaneous opposite transfers

### 📷 QR Payments
- Personal QR code (download / share / copy wallet ID)
- Payment **request** QR generator with optional amount + note
- **Camera-based scanning** (`html5-qrcode`) or manual payload paste
- Every scanned/pasted QR is schema- and version-validated, then the recipient is **verified against the live database** before a payment screen appears

### 🧾 Transactions
- Full, filterable transaction history: free-text search, type filter, category filter, date range, and multi-key sorting
- **CSV export** of the currently filtered view
- **Printable / savable-as-PDF receipts** for any transaction

### 📊 Analytics
- 6-month income vs. expense trend chart
- Current-month category expense breakdown (doughnut chart)
- Top recipients bar chart
- Plain-language summaries beneath every chart for accessibility

### 🎯 Budgeting
- One monthly limit per spending category
- Live progress bar with **On track / Watch / Near limit / Exceeded** status

### 👥 Contacts & 🔁 Recurring Payments
- Save, favorite, rename, or remove verified contacts; one-tap "quick send"
- Create recurring items (weekly/monthly); manually "Run now" (PIN-authorized) with **correct calendar-based scheduling** (not a naive 30-day approximation)

### 🔔 Notifications & 🌗 Preferences
- Event-driven notifications (money received/sent/deposited/withdrawn, recurring payment run, security events)
- Filter by all/unread/read, mark one or all as read, unread badge in navigation
- **Dark mode** toggle (persisted locally; purely cosmetic, not wallet data)

### ⚡ Realtime
- Any change to a user's data — whether triggered by them or a counterparty — is reflected **live**, across every open tab/session, without a manual refresh

---

## 🛠 Tech Stack

| Layer | Technology | Details |
|---|---|---|
| **Frontend** | HTML5, CSS3, Vanilla JavaScript | ES Modules, no framework, `type: "module"` |
| **Charts** | [Chart.js](https://www.chartjs.org/) `^4.5.0` | Bar, doughnut charts for analytics |
| **QR generation** | [`qrcode`](https://www.npmjs.com/package/qrcode) `^1.5.4` | Canvas-rendered QR codes |
| **QR scanning** | [`html5-qrcode`](https://www.npmjs.com/package/html5-qrcode) `^2.3.8` | Camera-based live scanning |
| **Icons** | [Lucide](https://lucide.dev) `0.468.0` | Loaded via CDN `<script>` |
| **Backend runtime** | Node.js | Native `http` module — no Express/Koa/Fastify |
| **Build tool / dev server** | [Vite](https://vitejs.dev/) `^7.1.0` | Multi-Page App (MPA) mode, middleware mode in dev |
| **Database** | [Supabase](https://supabase.com/) (PostgreSQL) | `@supabase/supabase-js` `^2.57.0` |
| **Realtime** | Supabase Realtime | Postgres Changes → Node → Server-Sent Events |
| **Password/PIN hashing** | Node `crypto.scrypt` | Salted, memory-hard, promisified |
| **Session transport** | HTTP-only cookies | `SameSite=Lax`, `Secure` in production |
| **Admin tooling** | Python 3 (stdlib only) | `reset_data.py` — full Supabase wipe |

---

## 🏗 System Architecture

```text
┌─────────────────────────────┐
│        Browser              │  HTML / CSS / Vanilla JS (ES Modules)
│  (index/login/register/user)│
└───────────────┬─────────────┘
                │ same-origin fetch() + HttpOnly session cookie
                │
                ▼
┌──────────────────────────────────────────────────┐
│               Node.js Server (server.js)         │
│  ┌─────────────┐ ┌─────────────┐ ┌────────────┐  │
│  │ Auth routes │ │ Data routes │ │ RPC routes │  │
│  └─────────────┘ └─────────────┘ └────────────┘  │
│  ┌───────────────────────────────────────────┐   │
│  │ Vite middleware (serves/transforms front) │   │
│  └───────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐    │
│  │ SSE endpoint: /api/realtime              │    │
│  └──────────────────────────────────────────┘    │
└───────────────┬────────────────────┬─────────────┘
                │ @supabase/supabase-js (SECRET KEY)
                ▼                    ▼
     ┌──────────────────────┐  ┌──────────────────────┐
     │ Supabase PostgreSQL  │  │  Supabase Realtime   │
     │ (tables + RPC funcs) │  │  (postgres_changes)  │
     └──────────────────────┘  └──────────────────────┘
```

**Golden rule of this architecture:** the browser is *never* given a database credential and *never* talks to Supabase directly. Every read, write, and realtime notification is authenticated, scoped to the current user, and validated by the Node server before it ever reaches PostgreSQL.

---

## 📁 Project Structure

```text
digital-wallet-simulator/
│
├── index.html                  # Public marketing/landing page
├── login.html                   # Login page
├── register.html                 # Registration page
├── user.html                      # Authenticated single-page app shell (all 11 sections)
│
├── server.js                        # Node.js HTTP server: API routes + Vite host + SSE + session logic
├── reset_data.py                      # Standalone script — wipes ALL Supabase data via RPC (schema kept)
│
├── package.json                        # Dependencies & npm scripts
├── package-lock.json
├── vite.config.js                        # Multi-page app (MPA) Rollup input config
├── .env.example                            # Template of required environment variables
├── .gitignore                                # Ignores node_modules, dist, .env, logs, OS files
│
├── css/
│   ├── style.css                              # Design tokens (colors/type/radius), layout primitives, buttons/forms
│   ├── home.css                                # Landing page specific styles
│   ├── auth.css                                  # Login / register page styles
│   └── user.css                                    # Authenticated app: sidebar, dashboard, modals, tables
│
├── js/
│   ├── data-api.js                                  # Thin fetch wrapper — the ONLY module that calls fetch()
│   ├── auth.js                                        # Login/register form logic + redirects
│   └── user.js                                          # Entire authenticated app: state, rendering, events (~1,250 lines)
│
├── supabase/
│   └── schema.sql                                        # Tables, RPC functions, RLS, grants, realtime publication
│
└── README.md                                               # You are here
```
---

## ✅ Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 18+** and **npm** | Required to install dependencies and run the server |
| **A Supabase account & project** | Free tier is sufficient — [supabase.com](https://supabase.com/) |
| **Python 3** | Optional — only needed for the full-wipe `reset_data.py` utility |
| **A modern browser** | Camera access is required only for the QR-scanning feature |

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Jason4925/Digital-Wallet.git
cd Digital-Wallet
```

### 2. Install Dependencies

```bash
npm install
```

This installs `@supabase/supabase-js`, `chart.js`, `qrcode`, `html5-qrcode`, and the `vite` dev dependency, and regenerates `package-lock.json` for your machine/platform.

### 3. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com/) and create a new project.
2. Wait for provisioning to finish, then open the project dashboard.
3. Go to **Project Settings → API** and copy:
   - **Project URL** → this is your `SUPABASE_URL`
   - **Secret key** (or, on older projects, the **Service Role key**) → this is your `SUPABASE_SECRET_KEY`

> 🔒 **Never** use the public/anon key for this project, and never expose the secret key to any frontend code.

### 4. Run the Database Schema

1. Open **SQL Editor** in your Supabase project.
2. Paste the entire contents of [`supabase/schema.sql`](./supabase/schema.sql) and run it.
3. This creates all 10 tables, every RPC function (`create_wallet_account`, `wallet_deposit`, `wallet_withdraw`, `wallet_transfer`, `wallet_run_recurring`, `reset_wallet_simulation`, `delete_wallet_account`, `reset_all_wallet_data`), enables Row Level Security everywhere, and adds the application tables to the `supabase_realtime` publication.
4. Confirm Realtime is wired up correctly:

   ```sql
   select *
   from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
   order by tablename;
   ```

   You should see all 9 application tables listed (everything except `auth_sessions`, which does not need realtime).


### 5. Configure Environment Variables

Copy the template:

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
SESSION_TTL_HOURS=24
COOKIE_SECURE=false
PORT=5173
```

See the [full variable reference](#-environment-variables-reference) below for what each one does.

### 6. Run the App Locally

```bash
npm run dev
```

Then open:

```text
http://localhost:5173/
```

You can also use `npm start` — both commands run the same `server.js` entry point.

### 7. Verify Everything Works

1. Visit `/api/health` — you should see `{ "ok": true, "database": true, "realtime": true, ... }`.
2. Register a new account on `/register.html`.
3. Complete onboarding (name → PIN → optional starting balance).
4. You should land on the dashboard with your wallet ready to use.

---

## 🔧 Environment Variables Reference

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `SUPABASE_URL` | ✅ | — | Your Supabase project's REST/API URL |
| `SUPABASE_SECRET_KEY` | ✅* | — | The Supabase **secret key** (server-side only, bypasses RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅* | — | Legacy fallback name for the same secret key, for older Supabase projects |
| `SESSION_TTL_HOURS` | ❌ | `24` | How many hours a login session stays valid (sliding expiry) |
| `COOKIE_SECURE` | ❌ | `false` (auto `true` if `NODE_ENV=production`) | Forces the `Secure` flag on the session cookie |
| `NODE_ENV` | ❌ | — | Set to `production` in deployment; also forces secure cookies |
| `PORT` | ❌ | `5173` | Port the server listens on; most hosting platforms inject this automatically |

\* Exactly one of `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` must be set. The server **refuses to start** if neither `SUPABASE_URL` nor a secret key is present.

---

## 📜 NPM Scripts

| Script | Command | When to use |
|---|---|---|
| `npm run dev` | `node server.js` | Local development — boots the API and Vite in middleware mode together |
| `npm run build` | `vite build` | Produces a static, production-optimized multi-page bundle in `dist/` |
| `npm run preview` | `vite preview` | Serves the built `dist/` output locally to sanity-check a production build |
| `npm start` | `node server.js` | Production entry point used by hosting platforms |

---

## 🧭 Application Walkthrough

| Step | What happens |
|---|---|
| **1. Register** | Name + email-style login ID + password → account, profile, wallet, and wallet-security rows are created atomically, plus a unique `DW-XXXXXXXXXX` Wallet ID |
| **2. Onboarding** | 3-step wizard: confirm name → create + confirm a 4-digit PIN → optional starting balance |
| **3. Unlock** | Every future login prompts for the PIN once to unlock that session |
| **4. Dashboard** | Balance, income, expenses, transaction count, recent activity, mini spending chart |
| **5. Move money** | Deposit / Withdraw / Send (3-step: Recipient → Review → PIN) / Scan-to-pay |
| **6. Review** | Transactions (search/filter/sort/export/receipts), Analytics (trends/categories/top payees) |
| **7. Plan** | Budgets (per-category monthly limits), Recurring payments (scheduled + manually run) |
| **8. Manage** | Contacts, Notifications, Profile & Settings (PIN change/recovery, theme, danger zone) |

---

## 📏 Validation Rules & Limits

| Field | Rule |
|---|---|
| Password | 8–128 characters |
| Wallet PIN | Exactly 4 numeric digits |
| Amount (deposit/withdraw/transfer/recurring) | `0.01` to `1,000,000,000`, max 2 decimal places |
| Note | ≤ 120 characters |
| Full name | ≤ 80 characters |
| Phone | ≤ 25 characters |
| Contact nickname | ≤ 40 characters |
| Wallet ID format | `DW-` followed by 10 uppercase alphanumeric characters |
| PIN lockout threshold | 3 consecutive failed attempts |
| Session lifetime | `SESSION_TTL_HOURS` (default 24h), sliding on activity |
| Categories | `Food`, `Shopping`, `Travel`, `Bills`, `Income`, `Entertainment`, `Education`, `Healthcare`, `Other` |
| Recurring frequency | `weekly` or `monthly` only |

---

## 🔐 Security Model

- **Password & PIN hashing**: `scrypt` with a random 16-byte salt, `N=16384, r=8, p=1`, 64-byte derived key, stored as `scrypt$<salt>$<hash>`. Legacy plain SHA-256 hashes are recognized and transparently upgraded on next successful auth.
- **Sessions**: 32-byte random tokens; only the **SHA-256 hash** of the token is stored server-side (`auth_sessions.token_hash`). The raw token lives only in an **HttpOnly, `SameSite=Lax`** cookie — never readable by JavaScript. `Secure` is enforced automatically in production.
- **Two-factor-style authorization split**: the **account password** proves identity (login, recovery, destructive actions); a separate **4-digit Wallet PIN** authorizes every money-moving action — mirroring how real payment apps separate "who you are" from "approve this payment."
- **Zero client-side database access**: the browser never receives a Supabase key. All reads/writes go through `server.js`, which enforces per-table, per-column allow-lists and always scopes rows to `request.user.id` — a client can never request another user's data by supplying a different ID.
- **Atomicity**: every balance change happens inside a `SECURITY DEFINER` PostgreSQL function using `SELECT ... FOR UPDATE` row locks, so concurrent requests can never corrupt a balance or double-spend.
- **Minimal realtime payload**: SSE events carry only `{ table, event, timestamp }` — never row contents, never password/PIN hashes.
- **Sensitive fields stripped everywhere**: `password_hash` and `pin_hash` are removed from every API response via `sanitizeRow()` / `publicUser()`, no matter which endpoint returns the row.

---

## ⚡ Realtime Sync Explained

```text
1. A database row changes (e.g., a transfer updates two `wallets` rows and inserts a `transactions` row)
2. Supabase Realtime emits a `postgres_changes` event to the Node server's subscribed channel
3. The server determines which user(s) own the changed row (`affectedUserIds`)
4. The server pushes a tiny SSE event only to that user's open connections: { table, event, at }
5. The browser's EventSource listener debounces (120ms) and calls loadAll() to refresh its own scoped data
6. The UI updates automatically — no page reload, no polling
```

---

## 🧪 Testing the Realtime Flow Locally

1. Open two different browsers (or one normal + one incognito window).
2. Register/log in as **User A** in the first, **User B** in the second.
3. From User A, send a transfer to User B's Wallet ID.
4. Expected results, **without refreshing either page**:
   - User A's balance decreases and a new transaction appears
   - User B's balance increases, a new notification appears, and their transaction list updates
5. You can inspect the live connection in DevTools → **Network** → filter by **EventStream**, on `GET /api/realtime`.

---

## 📦 Building for Production

```bash
npm run build
```

This runs `vite build` using the multi-page input configuration in `vite.config.js`:

```js
input: {
  home: "index.html",
  login: "login.html",
  register: "register.html",
  user: "user.html"
}
```

producing an optimized static bundle in `dist/`. Preview it locally with:

```bash
npm run preview
```

> `node_modules/` and `dist/` are excluded from version control via `.gitignore`.

---


## 🧹 Resetting Data

### Wipe everything (keeps schema, functions, indexes, realtime config)

```bash
python reset_data.py
```

You will be prompted to type exactly:

```text
DELETE ALL WALLET DATA
```

This calls the `reset_all_wallet_data()` Supabase RPC function, which `TRUNCATE`s every application table.

### Wipe only your own account's activity

In the app: **Profile & Settings → Reset My Simulation** (requires your account password + typing `RESET`). This clears your balance, transactions, contacts, budgets, recurring payments, and notifications while **keeping** your account and profile.

### Permanently delete your account

In the app: **Profile & Settings → Delete Account** (requires your account password). This is irreversible.

---

## ❓ Troubleshooting / FAQ

**The server exits immediately on startup.**
Check that `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) are both set — the server refuses to boot without them.

**"Missing Supabase configuration" error.**
Same as above — double-check your `.env` file was actually loaded (correct filename, correct working directory).

**Realtime shows `false` on `/api/health`.**
Make sure you ran the full `supabase/schema.sql`, and confirm the tables appear in the `pg_publication_tables` query shown in [step 4](#4-run-the-database-schema) — Realtime replication must be enabled on your Supabase project.

**I don't receive any emails.**
By design — this app uses a **dummy, email-style login ID**, not real email delivery. Password recovery relies on you remembering your password; PIN recovery relies on your account password.

**My session keeps expiring.**
Check `SESSION_TTL_HOURS` — the default is 24 hours, sliding on activity. Also confirm cookies aren't being blocked by the browser for the site.

**Transfers fail with `RECIPIENT_NOT_FOUND`.**
The recipient Wallet ID must belong to a real, registered account in the same Supabase project — it's verified server-side via `lookup_wallet` before any transfer is attempted.

**Can I use a different database instead of Supabase?**
Not without significant rework — the app's atomic money-movement logic and Realtime pipeline are both built specifically around Supabase's PostgreSQL + Realtime combination.

---

## 🗺 Roadmap

- [ ] Multi-currency wallet support
- [ ] Group/shared wallets and bill-splitting
- [ ] Admin/back-office analytics dashboard
- [ ] Native mobile wrapper (PWA / Capacitor)
- [ ] Simple ML-based spending categorization
- [ ] Configurable simulated savings/interest goals

---

## 🤝 Contributing

1. **Fork** the repository
2. Create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```
3. Make your changes, keeping to the project's core principles:
   - Never let the browser talk to the database directly — route everything through `server.js`
   - Keep all money-movement logic inside atomic, `SECURITY DEFINER` PostgreSQL functions
   - Never store credentials or PINs in plain text
   - Update the relevant documentation file(s) alongside any behavioral change
4. Commit with clear, descriptive messages
5. Push and open a **Pull Request** describing the change and how you tested it

Bug reports and feature requests are welcome via Issues.

---


## ⚠️ Final Reminder

This is a **simulation only**. It does not integrate with any bank, UPI system, card network, or payment gateway, and it must never be used to process, hold, or transmit real money without a ground-up redesign covering regulatory compliance, licensed payment processing, and independent financial-grade security review.

---

## 👨‍💻 Author
### Jeetesh Nehete

---

## ⭐ Support

If you found this project useful, consider giving it a ⭐ on GitHub!