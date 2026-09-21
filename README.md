# Digital Wallet Simulator

A modern **educational digital wallet simulator** built with HTML, CSS, JavaScript, Node.js, Vite, and a single persistent JSON database file: **`data.json`**.

The application demonstrates common digital-wallet concepts such as account creation, wallet balances, deposits, withdrawals, wallet-to-wallet transfers, QR payments, transaction history, analytics, budgets, saved contacts, recurring-payment simulation, notifications, wallet PIN protection, receipts, and account lifecycle controls — without connecting to real banking or payment networks.

> **SIMULATION ONLY:** This project does not connect to a bank, UPI, payment gateway, card network, or any real-money system. All balances and transactions are simulated and are stored locally in `data.json`.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Key Characteristics](#key-characteristics)
3. [Features](#features)
4. [Application Flow](#application-flow)
5. [Architecture](#architecture)
6. [Project Structure](#project-structure)
7. [Technology Stack](#technology-stack)
8. [Data Storage Design](#data-storage-design)
9. [Data Model](#data-model)
10. [Authentication and Sessions](#authentication-and-sessions)
11. [Wallet PIN Security](#wallet-pin-security)
12. [Transaction Processing](#transaction-processing)
13. [QR Payment System](#qr-payment-system)
14. [Transaction History and Export](#transaction-history-and-export)
15. [Analytics and Reports](#analytics-and-reports)
16. [Budgets](#budgets)
17. [Contacts](#contacts)
18. [Recurring Payments](#recurring-payments)
19. [Notifications](#notifications)
20. [Profile and Account Management](#profile-and-account-management)
21. [Internal API](#internal-api)
22. [Installation and Setup](#installation-and-setup)
23. [First-Time Usage](#first-time-usage)
24. [Resetting Data](#resetting-data)
25. [Build and Deployment Notes](#build-and-deployment-notes)
26. [Validation and Error Handling](#validation-and-error-handling)
27. [Security Notes](#security-notes)
28. [Current Limitations](#current-limitations)
29. [Development Notes](#development-notes)
30. [Future Improvements](#future-improvements)
31. [License / Educational Use](#license--educational-use)

---

## Project Overview

The Digital Wallet Simulator is designed to demonstrate how a wallet-style application can be implemented while keeping the entire system local and easy to inspect.

The project intentionally uses **one persistent storage system only**:

```text
Browser UI
   │
   │ HTTP / JSON requests
   ▼
Node.js server (`server.js`)
   │
   │ read / validate / mutate
   ▼
`data.json`
```

The browser does **not** maintain a second wallet database in `localStorage` or `sessionStorage`.

The current browser session is represented by a server-created session token stored in an **HTTP-only cookie**. The actual session record stays in server memory.

---

## Key Characteristics

- **Single persistent storage:** `data.json`
- **No Supabase, SQLite, MongoDB, or external database**
- **No real money movement**
- **Separate account password and wallet PIN**
- **PIN required for every money-moving transaction**
- **Server-side authorization and validation**
- **User-scoped data access**
- **Versioned JSON data format (`version: 2`)**
- **Responsive web UI**
- **Chart-based financial analytics**
- **QR generation and camera scanning**
- **CSV transaction export**
- **Printable / PDF-friendly receipts**

---

# Features

## 1. User Account and Authentication

Users can create and access a simulated wallet account using:

- Full name
- Dummy email-style login ID
- Password
- Confirm password during registration

The email-style value is only used as a wallet login identifier. The application does **not** send an email or require a real mailbox.

### Password rules

The server accepts passwords from **8 to 128 characters**.

### Account creation

When a user registers, the server creates:

1. A user record
2. A profile record
3. A wallet record
4. A wallet-security record
5. A welcome notification

A unique wallet ID is generated in this format:

```text
DW-XXXXXXXXXX
```

where the final 10 characters are uppercase hexadecimal characters.

---

## 2. Wallet Dashboard

The dashboard provides a summary of the current simulated wallet:

- Current balance
- Total income
- Total expenses
- Transaction count
- Recent transactions
- Current-month spending visualization
- Wallet ID
- Quick actions for deposit, withdrawal, send, receive, and scan

Recent transactions can be opened directly to view their payment receipt.

---

## 3. Simulated Deposits

Users can add simulated funds to their own wallet.

The deposit form supports:

- Amount
- Category
- Optional note

The amount must be between:

```text
₹0.01 and ₹1,000,000,000
```

A successful deposit:

1. Validates the request
2. Requires the wallet PIN
3. Increases the wallet balance
4. Creates a transaction record
5. Creates a notification
6. Generates a transaction reference
7. Saves the updated data to `data.json`

---

## 4. Simulated Withdrawals

Users can remove simulated funds from their own wallet.

The withdrawal process validates:

- Amount format
- Maximum amount
- Available wallet balance
- Optional note
- Wallet PIN

A withdrawal cannot reduce the balance below zero.

---

## 5. Wallet-to-Wallet Transfers

Users can transfer simulated funds to another registered wallet.

### Transfer flow

```text
Enter recipient wallet ID
        ↓
Validate wallet ID
        ↓
Look up recipient
        ↓
Verify recipient is not the current user
        ↓
Validate amount / balance
        ↓
Show payment review
        ↓
Enter wallet PIN
        ↓
Server authorizes transaction
        ↓
Deduct sender balance
        ↓
Credit receiver balance
        ↓
Create transaction
        ↓
Create notifications
```

The recipient is verified before the confirmation screen is shown.

A user cannot transfer money to their own wallet.

---

## 6. PIN Required for Every Money Transaction

A **4-digit wallet PIN** is required for **every money-moving transaction**.

This is intentionally different from threshold-based PIN authorization.

| Operation | PIN required? |
|---|---:|
| Deposit | Yes |
| Withdrawal | Yes |
| Transfer | Yes |
| Recurring payment run | Yes |

There is no `₹10,000` threshold. The PIN is required even for a transaction of `₹1`.

### Transaction PIN flow

```text
Prepare transaction
      ↓
Transaction summary shown
      ↓
Enter 4-digit PIN
      ↓
Server verifies PIN
      ↓
Transaction is executed
```

The browser sends the PIN with the transaction authorization request; the server performs the actual verification and money mutation.

---

## 7. Wallet PIN Management

Users can configure a 4-digit wallet PIN from **Profile & Settings**.

Available actions:

- Set PIN for the first time
- Change the existing PIN
- View PIN status
- Recover a locked PIN

The application uses a separate wallet PIN rather than using the account password for transaction authorization.

---

## 8. PIN Lockout and Recovery

The wallet PIN is locked after **3 failed verification attempts**.

```text
Wrong PIN #1 → Attempts remaining
Wrong PIN #2 → Attempts remaining
Wrong PIN #3 → PIN locked
```

When locked, the user is directed to PIN recovery.

### Recovery process

```text
Account password
      ↓
Verify password
      ↓
Enter new 4-digit PIN
      ↓
Confirm new PIN
      ↓
Unlock wallet PIN
```

The failed-attempt counter is reset after successful PIN verification or successful PIN reset.

---

## 9. Wallet Unlock Prompt

The application also includes a wallet-unlock prompt when entering the authenticated wallet area.

Important distinction:

> Unlocking the wallet does **not** remove transaction authorization.

A transfer, deposit, withdrawal, or recurring payment still asks for the PIN again.

---

## 10. Receive / My QR

The **Receive** section displays the user's:

- Wallet ID
- Name
- Personal payment QR code

The QR can be:

- Downloaded as PNG
- Shared through the browser share API when available
- Copied as a fallback payload when browser sharing is unavailable

The QR payload uses a versioned JSON structure.

Example format:

```json
{
  "app": "digital-wallet",
  "version": 2,
  "wallet_id": "DW-XXXXXXXXXX",
  "name": "User Name",
  "amount": null,
  "note": null
}
```

---

## 11. Payment Request QR

A user can create a payment-request QR containing:

- Recipient wallet ID
- Recipient name
- Requested amount (optional)
- Request note (optional)

Example:

```json
{
  "app": "digital-wallet",
  "version": 2,
  "wallet_id": "DW-XXXXXXXXXX",
  "name": "User Name",
  "amount": 500,
  "note": "Dinner"
}
```

This is a **request payload**, not an automatic payment.

The receiving user still needs to review and authorize the actual transfer with the wallet PIN.

---

## 12. QR Scanner and Verification

The Scan QR section supports:

- Device camera scanning using `html5-qrcode`
- Manual QR payload entry
- Payload validation
- Wallet ID validation
- Recipient lookup on the server
- Review before payment

The QR parser checks:

- `app === "digital-wallet"`
- `version === 2`
- Valid wallet ID
- Valid requested amount when present
- Note length
- Recipient existence
- Recipient is not the current user's wallet

The QR flow ultimately routes into the normal transfer confirmation and PIN authorization process.

---

## 13. Transaction History

The Transactions section displays wallet activity in a table.

Supported filters and controls:

- Text search
- Income / expense filter
- Category filter
- Start date
- End date
- Newest first
- Oldest first
- Amount high-to-low
- Amount low-to-high

Search can match transaction information such as:

- Transaction ID
- Reference ID
- Note
- Wallet IDs
- Counterparty name
- Category
- Transaction type

---

## 14. Transaction Reference Numbers

Every generated transaction receives two identifiers:

### Internal transaction ID

A UUID is stored as the internal transaction identifier.

### Human-readable reference

Transactions also receive a reference in this format:

```text
TXN-YYYYMMDD-XXXXXX
```

The reference is easier to read and can be displayed on receipts and in transaction history.

---

## 15. Transaction Status

Transactions are stored with a status field.

The current wallet operations create successful transactions with:

```text
completed
```

The UI is designed to display the status as part of transaction history and receipts.

---

## 16. CSV Export

Users can export the currently filtered transaction list as CSV.

The exported data includes:

- Date
- Reference
- Transaction ID
- Type
- Counterparty
- Counterparty wallet
- Category
- Amount
- Direction
- Status
- Note

The file name follows this pattern:

```text
wallet-transactions-YYYY-MM-DD.csv
```

---

## 17. Payment Receipts

After a successful transaction, the application can open a printable receipt containing:

- Simulator heading
- Transaction status
- Amount
- Reference
- Transaction ID
- Type
- Counterparty
- Wallet ID
- Category
- Note
- Date
- Simulation disclaimer

The receipt can be printed or saved as PDF using the browser print dialog.

---

## 18. Analytics and Reports

Analytics are calculated from the transaction records stored in `data.json`.

### Summary metrics

- Current balance
- Net this month
- Largest expense this month
- Top expense category

### Charts

The project uses **Chart.js** for:

1. Income vs. expenses over the last six months
2. Expense category breakdown
3. Top recipients by total amount sent
4. A compact current-month category chart on the dashboard

Analytics are derived from recorded simulated transactions rather than from hard-coded values.

---

## 19. Budgets

Users can create monthly category budgets.

Each budget stores:

- Month
- Category
- Monthly limit
- User ID

Budget progress is calculated against actual current-month expense transactions.

The interface displays the relationship between:

```text
Spent
Limit
Remaining
Usage percentage
```

Budget warning states are shown as spending approaches or exceeds the configured limit.

Budgets are upserted by user, month, and category so the same category can be updated rather than duplicated for the same month.

---

## 20. Contacts

Users can save verified wallet recipients for faster transfers.

A contact contains:

- Wallet ID
- Contact user ID
- Nickname
- Favorite flag
- Created timestamp

### Contact features

- Add verified wallet
- Prevent duplicate contacts
- Quick send
- Favorite / unfavorite
- Remove contact

The server verifies that the wallet exists before creating a contact.

A user cannot add their own wallet as a contact.

---

## 21. Recurring Payments

Recurring payments are implemented as a **manual simulation**, not as a background payment scheduler.

Users can define:

- Title
- Amount
- Frequency
- Category
- Next run date
- Active/inactive state

Supported frequencies:

```text
weekly
monthly
```

### Running a recurring payment

When the user chooses **Run now**:

1. The recurring item is validated
2. The wallet balance is checked
3. The wallet PIN is required
4. The amount is deducted
5. A transaction is created
6. A notification is created
7. The next run date is advanced

The recurring payment does not execute automatically in the background.

---

## 22. Notifications

Notifications are stored per user in `data.json`.

Examples include:

- Welcome message
- Money deposited
- Money withdrawn
- Transfer completed
- Money received
- Recurring payment completed
- Simulation reset

Users can:

- View notifications
- Mark an individual notification as read
- Mark all notifications as read

Unread notification count is shown in the navigation.

---

## 23. Profile and Account Management

The Profile & Settings section includes:

### Profile

- Full name
- Phone
- Wallet ID (read-only)

### Wallet security

- PIN status
- Set PIN
- Change PIN
- Recover locked PIN

### Preferences

- Dark-mode toggle
- INR currency display
- Notification state
- Sign out

### Account actions

- Reset My Simulation
- Delete Account

---

## 24. Reset My Simulation

**Reset My Simulation** removes the user's simulated activity while keeping the account/profile.

It resets or removes the user's:

- Wallet balance
- Wallet PIN
- Transactions
- Contacts
- Budgets
- Recurring payments
- Notifications

The action requires:

1. Account password
2. Typing `RESET` as confirmation

After reset, the user must create a new wallet PIN before making transactions.

---

## 25. Delete Account

**Delete Account** permanently removes the current user's records from `data.json`.

The action requires the account password.

Related records removed include:

- User account
- Profile
- Wallet
- Wallet security record
- Related transactions
- Contacts
- Budgets
- Recurring payments
- Notifications

The delete operation is handled on the server rather than by the browser.

---

# Application Flow

The normal user journey is:

```text
Home page
   ↓
Create Account / Login
   ↓
Authenticated session
   ↓
Wallet dashboard
   ↓
Set 4-digit wallet PIN
   ↓
Deposit simulated money
   ↓
Use wallet features
   ├── Send money
   ├── Receive / My QR
   ├── Scan QR
   ├── Transactions
   ├── Analytics
   ├── Budgets
   ├── Contacts
   ├── Recurring payments
   ├── Notifications
   └── Profile & Settings
```

For a money-moving operation:

```text
User action
   ↓
Frontend validation
   ↓
Transaction review (where applicable)
   ↓
Wallet PIN
   ↓
Server-side PIN verification
   ↓
Server-side business validation
   ↓
Mutate wallet + transaction + notifications
   ↓
Write updated `data.json`
   ↓
Refresh wallet UI
   ↓
Show receipt
```

---

# Architecture

## High-level architecture

```text
┌──────────────────────────────┐
│        Browser / UI          │
│ HTML + CSS + JS + Chart.js   │
│ QRCode + html5-qrcode        │
└──────────────┬───────────────┘
               │ JSON / HTTP
               ▼
┌──────────────────────────────┐
│       Node.js server         │
│          server.js           │
│                              │
│ Auth + Sessions               │
│ Query / Mutation API          │
│ Wallet RPC operations         │
│ Validation + authorization    │
│ PIN security                  │
└──────────────┬───────────────┘
               │
               │ read / mutate
               ▼
┌──────────────────────────────┐
│          data.json           │
│      Version 2 JSON store    │
└──────────────────────────────┘
```

## Why `data.json` is the only persistent store

The project intentionally avoids having separate copies of wallet data in:

- Browser `localStorage`
- Browser `sessionStorage`
- SQLite
- MongoDB
- Supabase
- Other external databases

The canonical persistent records live in:

```text
data.json
```

The server reads from that file and writes validated changes back to it.

---

# Project Structure

```text
Digital Wallet Simulator/
│
├── index.html                # Landing page / project introduction
├── login.html                # Login UI
├── register.html             # Registration UI
├── user.html                 # Main authenticated wallet interface
│
├── css/
│   ├── style.css             # Shared styles and components
│   ├── home.css              # Landing-page styles
│   ├── auth.css              # Login/registration styles
│   └── user.css              # Wallet application styles
│
├── js/
│   ├── auth.js               # Login and registration behavior
│   ├── data-api.js           # Frontend wrapper for the internal API
│   └── user.js               # Main wallet application logic
│
├── data.json                 # Single persistent wallet database
├── reset_data.py             # Developer tool to wipe all data
├── server.js                 # Node.js HTTP server + wallet backend
├── package.json               # Project scripts and dependencies
├── package-lock.json          # Locked dependency versions
├── .gitignore                 # Ignored files/folders
├── dist/                     # Generated Vite build output
└── README.md                 # Project documentation
```

### Generated / dependency directories

The repository may contain:

```text
node_modules/
dist/
```

These are generated artifacts and should normally be recreated rather than manually maintained in source control.

---

# Technology Stack

| Technology | Purpose |
|---|---|
| HTML5 | Application pages and semantic UI structure |
| CSS3 | Layout, responsive design, forms, cards, modals and themes |
| JavaScript ES Modules | Client-side application logic |
| Node.js | Local backend server and data layer |
| Vite | Development server and frontend build tooling |
| Chart.js 4.5 | Financial charts and analytics |
| `qrcode` 1.5.4 | QR code generation |
| `html5-qrcode` 2.3.8 | Camera-based QR scanning |
| Python | Optional full-data reset utility |
| JSON | Persistent data format |

The project is configured as an ES-module Node.js application through:

```json
"type": "module"
```

---

# Data Storage Design

## Single source of truth

The application's persistent data is stored in:

```text
data.json
```

At startup, `server.js`:

1. Ensures the file exists
2. Reads the current JSON
3. Migrates it to version 2 if necessary
4. Writes the canonical version back when the structure changes

The server keeps a **write queue** so wallet mutations within the running Node.js process are serialized:

```text
Write request A ─┐
                 ├── serialized mutation queue ──> data.json
Write request B ─┘
```

This prevents two simultaneous application-level mutations from reading the same old state and then blindly overwriting each other inside the server process.

> The file is still a local JSON file and is not a multi-process database. This is an intentional limitation of the simulator architecture.

---

# Data Model

The current file uses:

```json
"version": 2
```

and the following top-level collections:

```text
users
profiles
wallets
wallet_security
transactions
contacts
budgets
recurring_payments
notifications
```

## 1. `users`

Stores account authentication information.

Typical fields:

```text
id
email
password_hash
user_metadata
created_at
```

`password_hash` is stored only on the server and is not returned to the browser.

---

## 2. `profiles`

Stores user-facing identity and wallet information.

Typical fields:

```text
id
full_name
email
username
phone
wallet_id
created_at
```

The wallet ID is the user's public simulator identifier.

---

## 3. `wallets`

Stores wallet balance data.

Typical fields:

```text
user_id
balance
updated_at
```

---

## 4. `wallet_security`

Stores transaction-PIN security state.

Typical fields:

```text
user_id
pin_hash
failed_attempts
locked
updated_at
```

`pin_hash` is never returned by the data API.

---

## 5. `transactions`

Stores wallet activity.

Typical fields:

```text
id
reference_id
status
created_at
amount
type
category
note
sender_id
receiver_id
sender_wallet_id
receiver_wallet_id
counterparty_wallet_id
counterparty_name
```

Supported transaction types currently include:

```text
deposit
withdrawal
transfer
recurring_payment
```

---

## 6. `contacts`

Stores saved recipients.

Typical fields:

```text
id
owner_id
contact_user_id
wallet_id
nickname
favorite
created_at
```

---

## 7. `budgets`

Stores monthly category budgets.

Typical fields:

```text
id
user_id
month_start
category
amount
created_at
```

---

## 8. `recurring_payments`

Stores manually executable recurring-payment definitions.

Typical fields:

```text
id
user_id
title
amount
frequency
category
next_run_at
active
created_at
```

---

## 9. `notifications`

Stores user notifications.

Typical fields:

```text
id
user_id
title
message
type
is_read
created_at
```

---

# Authentication and Sessions

The application implements local authentication in `server.js`.

## Registration

`POST /api/auth/signup`

The server:

- Validates the email-style identifier
- Validates the name
- Validates password length
- Checks for duplicate login IDs
- Hashes the password
- Creates user/profile/wallet/security records
- Creates a welcome notification
- Creates a session
- Sends the session as an HTTP-only cookie

## Login

`POST /api/auth/signin`

The server:

- Finds the user by normalized login ID
- Verifies the password hash
- Creates a session
- Sends the session cookie

## Session lifetime

The session timeout is currently:

```text
24 hours
```

Sessions are stored in server memory.

Therefore, restarting the Node.js server clears active sessions and users need to sign in again.

## Logout

`POST /api/auth/signout`

The server removes the session from memory and clears the cookie.

---

# Wallet PIN Security

The server uses a separate wallet PIN from the account password.

## PIN format

Exactly four digits:

```text
0000
1234
9876
```

## Hashing

Secrets are currently stored using Node.js `scrypt` with a random salt.

The server also recognizes legacy SHA-256 hashes so older records can be upgraded automatically after a successful verification.

## PIN verification behavior

On successful verification:

- Failed attempts reset to zero
- The wallet is considered authorized for that request
- A legacy hash, if found, is upgraded to the current `scrypt` format

On failed verification:

- `failed_attempts` increases
- The PIN locks at three failed attempts
- Remaining attempts are returned to the UI when applicable

---

# Transaction Processing

All wallet-changing operations are exposed through the internal `/api/rpc` endpoint.

## Deposit

RPC name:

```text
deposit_wallet
```

The server validates the amount, verifies the PIN, updates the wallet, creates a transaction, and creates a notification.

## Withdrawal

RPC name:

```text
withdraw_wallet
```

The server additionally checks that the wallet has enough simulated balance.

## Transfer

RPC name:

```text
transfer_wallet
```

The transfer checks:

- Recipient wallet ID format
- Recipient existence
- Recipient is not the sender
- Amount validity
- Sufficient sender balance
- Recipient wallet existence
- Valid transaction PIN

It then updates both wallets and creates the transaction and notifications as part of one queued mutation.

## Recurring payment

RPC name:

```text
run_recurring_payment
```

The operation is user-scoped and PIN-authorized.

---

# QR Payment System

## QR generation library

The project uses:

```text
qrcode
```

for QR creation.

## QR scanning library

The camera scanner uses:

```text
html5-qrcode
```

## Versioning

QR payloads use:

```text
version: 2
```

This allows future versions to change the payload structure without silently accepting incompatible formats.

## Important payment rule

Scanning a QR does **not** immediately transfer funds.

The actual flow remains:

```text
Scan
 ↓
Parse
 ↓
Verify recipient
 ↓
Review transfer
 ↓
Enter PIN
 ↓
Transfer
```

---

# Transaction History and Export

The frontend loads only the current user's visible transaction records through the authenticated query API.

The server scopes transaction visibility to records where the current user is either:

```text
sender_id == current user
```

or:

```text
receiver_id == current user
```

Transaction search and filtering happen in the browser after the authorized data has been loaded.

CSV export is generated entirely on the client from the currently filtered transaction list.

---

# Analytics and Reports

Analytics are calculated directly from transaction records.

## Monthly calculations

The dashboard and analytics page calculate:

```text
Income
Expenses
Net = Income - Expenses
```

The project also identifies:

- Largest expense in the current month
- Highest-spending category
- Top recipients by total amount sent

The six-month income/expense chart is generated dynamically from stored transaction dates.

---

# Budgets

Budget records are user-owned.

For the current month, the application calculates spending for the selected category and compares it with the configured limit.

This allows the user to see whether a category is:

```text
within budget
approaching its limit
at / beyond the limit
```

Budget updates use an upsert-style operation keyed by:

```text
user + month + category
```

---

# Contacts

The contact flow intentionally verifies the destination wallet before saving it.

This means the user cannot create a contact from an arbitrary text value that does not correspond to a registered wallet.

Contacts are user-scoped, so one user cannot directly modify another user's private contact list.

---

# Recurring Payments

Recurring payments are a simulation of scheduled wallet activity.

They are **not** processed by a background daemon or external scheduler.

The user explicitly clicks:

```text
Run now
```

and the server executes the simulated recurring payment.

The next execution date is then advanced according to the selected frequency.

---

# Notifications

Notifications are generated server-side when important wallet events occur.

Because notifications are stored in `data.json`, they remain available after page refreshes and browser restarts as long as the same local data file is used.

---

# Profile and Account Management

Profile updates are limited to user-facing profile fields.

The server does not allow a browser request to directly rewrite protected authentication or wallet-security fields through the generic data mutation API.

Account lifecycle operations such as reset and deletion are implemented as dedicated RPC operations so that password verification can occur on the server before destructive changes.

---

# Internal API

`js/data-api.js` is the browser-side wrapper for the application's internal JSON API.

The application uses four endpoint groups.

## 1. Authentication

### `GET /api/auth/session`

Returns the current signed-in session, or `null` if no valid session exists.

### `POST /api/auth/signup`

Creates a user account and starts a session.

### `POST /api/auth/signin`

Authenticates the account and starts a session.

### `POST /api/auth/signout`

Ends the current server-side session.

---

## 2. Data Query

### `POST /api/data/query`

Provides authenticated, user-scoped reads for these tables:

```text
profiles
wallets
transactions
contacts
budgets
recurring_payments
notifications
wallet_security
```

Supported query controls include:

- `filters`
- `any`
- `sorts`
- `limit`
- `single`

Results are sanitized before being returned.

Protected fields such as `password_hash` and `pin_hash` are not exposed.

---

## 3. Data Mutation

### `POST /api/data/mutate`

Supports restricted user-scoped operations.

### Insertable data

The generic insert API supports:

```text
contacts
budgets
recurring_payments
```

### Updatable data

The generic update API supports:

```text
profiles
contacts
budgets
recurring_payments
notifications
```

### Direct deletes

The generic delete API supports:

```text
contacts
budgets
recurring_payments
```

Wallet balances, transactions, authentication records, and wallet security are intentionally not editable through generic browser mutations.

Those operations use dedicated server-side RPC logic.

### Budget upsert

Budgets also support:

```text
upsert
```

so the same month/category budget can be updated without creating duplicates.

---

# RPC Operations

`POST /api/rpc` supports the following operations.

| RPC | Purpose |
|---|---|
| `get_wallet_status` | Read wallet PIN status and lock state |
| `set_wallet_pin` | Set an initial 4-digit wallet PIN |
| `change_wallet_pin` | Change the existing PIN |
| `reset_wallet_pin_with_password` | Recover a locked PIN using the account password |
| `verify_wallet_pin` | Verify the wallet PIN and update lockout state |
| `deposit_wallet` | Deposit simulated funds with PIN authorization |
| `withdraw_wallet` | Withdraw simulated funds with PIN authorization |
| `transfer_wallet` | Transfer funds to another registered wallet with PIN authorization |
| `lookup_wallet` | Verify a wallet ID and resolve recipient identity |
| `run_recurring_payment` | Execute a recurring payment simulation with PIN authorization |
| `delete_account` | Permanently delete the current user's related records |
| `reset_user_data` | Reset current user's wallet simulation while keeping the account |

All RPC requests require an authenticated session.

---

# Installation and Setup

## Requirements

Use a Node.js version supported by the installed Vite release.

For the current project configuration, Vite declares:

```text
Node.js ^20.19.0 or >=22.12.0
```

Python is optional and is only required if you want to use `reset_data.py`.

---

## 1. Extract the project

Open a terminal in the project folder.

Example:

```bash
cd digital-wallet-simulator
```

---

## 2. Install dependencies

```bash
npm install
```

The important runtime dependencies are:

```text
chart.js
html5-qrcode
qrcode
```

The development dependency is:

```text
vite
```

---

## 3. Start the application

Run:

```bash
npm run dev
```

The Node.js server starts on:

```text
http://localhost:5173
```

The server itself also mounts Vite middleware, so the normal development command handles both the frontend and the wallet API.

---

## 4. Open the application

Visit:

```text
http://localhost:5173
```

Do **not** open the HTML files directly using `file://` because the application depends on the Node.js API endpoints.

---

# First-Time Usage

A typical first run is:

### Step 1 — Create an account

Open:

```text
http://localhost:5173/register.html
```

Use an invented email-style login ID, for example:

```text
alex@wallet.local
```

No real email is required.

### Step 2 — Login

Use:

```text
login.html
```

### Step 3 — Set the wallet PIN

Go to:

```text
Profile & Settings → Wallet Security
```

Set a 4-digit PIN.

### Step 4 — Add simulated money

Use:

```text
Dashboard → Deposit
```

The application will ask for the PIN before executing the deposit.

### Step 5 — Explore the wallet

You can now use:

- Withdraw
- Send Money
- Receive QR
- Scan QR
- Transactions
- Analytics
- Budgets
- Contacts
- Recurring Payments
- Notifications
- Profile & Settings

---

# Resetting Data

There are two reset levels.

## Reset the entire simulator database

Use:

```bash
python reset_data.py
```

This replaces `data.json` with an empty version-2 structure:

```json
{
  "version": 2,
  "users": [],
  "profiles": [],
  "wallets": [],
  "wallet_security": [],
  "transactions": [],
  "contacts": [],
  "budgets": [],
  "recurring_payments": [],
  "notifications": []
}
```

This removes all accounts and all simulator activity.

## Reset only the current user's simulation

From the application:

```text
Profile & Settings
        ↓
Reset My Simulation
```

You must provide:

- Account password
- The exact confirmation text `RESET`

The account remains, but its wallet activity is cleared.

---

# Build and Deployment Notes

## Development mode

The recommended command is:

```bash
npm run dev
```

This starts `server.js`, which in turn uses Vite in middleware mode.

## Production-style frontend build

To generate Vite output:

```bash
npm run build
```

The generated files are placed in:

```text
dist/
```

## Preview command

The project also defines:

```bash
npm run preview
```

However, the application's wallet API lives in `server.js`, so a frontend-only Vite preview should not be treated as a complete wallet backend environment.

For the full simulator, run `server.js` through:

```bash
npm run dev
```

or an equivalent Node.js server process.

---

# Validation and Error Handling

The server performs validation rather than trusting the browser.

Examples include:

- Valid email-style login ID
- Password length
- Name length
- Phone length
- Wallet ID format
- 4-digit PIN format
- Positive monetary amount
- Maximum transaction amount
- Sufficient balance
- Valid categories
- Valid recurring frequencies
- Valid QR version
- Valid QR wallet ID
- Note length
- Duplicate contacts
- Self-transfer prevention
- Recipient existence
- Account password for destructive operations

The frontend also validates user input before sending requests so that common mistakes can be shown immediately.

---

# Security Notes

This project includes several security-oriented practices suitable for an educational local simulator.

## Server-side session authorization

Wallet API requests require a valid current session.

## HTTP-only session cookie

The session cookie is configured with:

```text
HttpOnly
SameSite=Lax
Path=/
```

## Sensitive-field filtering

The data query API removes:

```text
password_hash
pin_hash
```

from browser-visible responses.

## Server-side transaction authorization

Money-changing operations cannot be performed by generic table updates. They require dedicated wallet RPC operations and wallet PIN verification.

## User-scoped records

The server scopes data reads and mutations to the authenticated user.

For example:

- A profile query returns the current user's profile
- A wallet query returns the current user's wallet
- A transaction query includes transactions where the user is sender or receiver
- Contacts are limited to the contact owner
- Budgets are limited to the budget owner

## Password hashing

Current account passwords and wallet PINs use salted `scrypt` hashes.

## Migration support

Legacy SHA-256 secret hashes are recognized and upgraded to `scrypt` after successful verification.

> **Important:** This remains a learning project. It should not be used to store real financial credentials, real bank account information, real payment credentials, or production financial records.

---

# Current Limitations

The project intentionally keeps the system local and simple. That creates several limitations.

## 1. JSON-file database

`data.json` is not a full relational database.

It does not provide the same durability, concurrency model, indexing, transactions, backup tooling, or multi-instance behavior as PostgreSQL/MySQL/etc.

## 2. Single-process write coordination

The server uses an in-process write queue. This coordinates mutations handled by the same running Node.js process.

Running multiple independent server processes against the same `data.json` would not provide the same safety guarantees.

## 3. Sessions are stored in memory

Restarting the Node.js server clears all active sessions.

Users must sign in again.

## 4. Recurring payments are manual

Recurring payments do not run automatically on a real schedule. They are executed when the user presses **Run now**.

## 5. No real payment connectivity

There is no:

- UPI connection
- Bank API
- Card network
- Payment gateway
- Real settlement
- Real notification provider

## 6. No email delivery

The registration identifier only needs to look like an email address. No verification email is sent.

## 7. Local application scope

The project is intended primarily for demonstrations, learning, coursework, prototyping, and wallet-flow simulation.

---

# Development Notes

## Frontend data access

The file:

```text
js/data-api.js
```

provides a small client wrapper around the server API.

This keeps HTTP details separate from the main wallet UI logic.

## Authentication logic

The file:

```text
js/auth.js
```

handles:

- login form submission
- registration form submission
- redirecting already authenticated users
- friendly authentication errors

## Main wallet logic

The file:

```text
js/user.js
```

handles:

- dashboard rendering
- navigation
- data loading
- transfers
- cash operations
- transaction PIN dialog
- QR generation
- QR scanning
- transaction filtering
- CSV export
- analytics
- budgets
- contacts
- recurring payments
- notifications
- profile settings
- PIN management
- account reset
- account deletion
- receipts

## Backend logic

The file:

```text
server.js
```

is responsible for:

- HTTP server setup
- Vite middleware
- session management
- account authentication
- data reads
- data mutations
- data migration
- wallet operations
- PIN hashing / verification
- authorization
- transaction creation
- notification creation
- account lifecycle operations
- persistence to `data.json`

---

# Recommended Git Practices

The source repository should normally avoid committing generated or machine-specific directories such as:

```text
node_modules/
dist/
```

The current `.gitignore` already excludes these directories.

Because `data.json` contains the simulated accounts and transaction records, decide whether the sample data should be committed before publishing the repository. Do not place real personal, financial, password, or payment information in the file.

For a clean clone, dependencies can be recreated with:

```bash
npm install
```

---

# Future Improvements

The current architecture intentionally stays with `data.json`. Improvements that can still be made without changing the storage technology include:

- More granular transaction types and statuses
- Stronger audit logging
- Better transaction reconciliation tools
- More advanced budget reports
- More export formats
- Pagination for very large transaction histories
- Automatic recurring-payment simulation inside a single server process
- Optional backup / restore of `data.json`
- Data integrity checks and corruption recovery
- More detailed activity logs
- More comprehensive automated tests
- Accessibility improvements
- More mobile-specific layout refinements

A future production-oriented version could replace `data.json` with a proper database, but that is **not part of the current design goal** of this simulator.

---

# License / Educational Use

This project is intended as an educational and demonstration application.

Use it to understand concepts such as:

- Authentication
- Sessions
- Wallet balances
- Transaction authorization
- PIN lockout
- QR payments
- Data modeling
- API design
- Input validation
- Reporting and analytics
- Local JSON persistence

> **Final reminder:** No real money is transferred by this application.
