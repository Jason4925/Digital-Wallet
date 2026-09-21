# Digital Wallet Simulator

An educational digital wallet simulator built with HTML, CSS, JavaScript and Node.js.

## Storage decision

This project intentionally uses **one persistent storage file only: `data.json`**.

```text
Browser UI
   ↓
Custom JSON data API
   ↓
Node.js server
   ↓
data.json
```

The wallet database is **not duplicated in browser `localStorage`**. Authentication sessions are held in server memory and a session cookie is used only to keep the current browser session signed in.

## Important

This is a simulation. It does not connect to a bank, payment gateway, UPI network or real money.

## Features

- User registration and login with a dummy email-style wallet login ID
- Wallet profile and generated wallet ID
- Simulated deposits and withdrawals
- Wallet-to-wallet transfers
- **4-digit PIN required for every money-moving transaction**
- PIN lock after 3 failed attempts
- PIN recovery using the account password
- Server-side transaction authorization and validation
- Atomic transfer/deposit/withdrawal updates to `data.json`
- Versioned QR generation and QR payload validation
- Verified QR recipient review before payment
- Search, type/category filters, date-range filters and sorting
- Transaction CSV export
- Human-readable transaction reference numbers
- Printable payment receipts
- Monthly analytics and spending overview cards
- Category budgets with remaining balance and warning levels
- Saved contacts with favorites
- Recurring payment simulation with PIN authorization
- Notifications
- Dark mode preference for the current page session
- Reset-my-simulation action
- Permanent account deletion
- Consistent empty states and loading states

## Project structure

```text
Digital Wallet Simulator/
│
├── index.html
├── login.html
├── register.html
├── user.html
│
├── css/
│   ├── style.css
│   ├── home.css
│   ├── auth.css
│   └── user.css
│
├── js/
│   ├── auth.js
│   ├── data-api.js
│   └── user.js
│
├── data.json
├── reset_data.py
├── server.js
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

Generated build output and `node_modules` should not be part of source control. Install dependencies with `npm install`.

## Run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Data reset

To wipe all simulator data:

```bash
python reset_data.py
```

You can also use **Profile & Settings → Reset My Simulation** to reset only the currently signed-in user's wallet activity while keeping that account/profile.

## PIN behavior

The PIN is intentionally required for every operation that changes simulated wallet funds:

```text
Deposit      → PIN
Withdrawal   → PIN
Transfer     → PIN
Recurring    → PIN
```

The dashboard unlock prompt is separate from transaction authorization. Unlocking the wallet does not skip the PIN prompt for a transaction.

After 3 wrong PIN attempts, the wallet PIN is locked. Use **Profile & Settings → PIN recovery** and authenticate with the account password to set a new PIN.

## Transaction safety

Wallet-changing operations are executed by the Node.js server inside a serialized data-write queue. A transfer updates the sender wallet, receiver wallet, transaction record and notifications in one data mutation before `data.json` is replaced atomically.

The client cannot directly replace the whole database, and sensitive `password_hash` / `pin_hash` values are never returned by the data API.
