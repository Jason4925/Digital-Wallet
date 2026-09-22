# 💳 Digital Wallet Simulator

A full-stack **simulated digital wallet** built for learning, demonstrations, and academic projects using **HTML, CSS, Vanilla JavaScript, Node.js, PostgreSQL, Supabase, and Supabase Realtime**.

> ⚠️ **Disclaimer:** This is a simulation project. It does not process real money and is not connected to banks, UPI, cards, payment gateways, or real email services.

---

## 📌 About the Project

The **Digital Wallet Simulator** recreates the core experience of a digital wallet in a controlled demo environment.

Users can create an account, log in using a **dummy email-style wallet ID**, manage simulated wallet funds, transfer money between demo users, use QR payments, track transactions, analyse spending, create budgets, save contacts, configure recurring payments, receive notifications, and protect transactions using a wallet PIN.

The project uses **Supabase PostgreSQL as the single source of truth** and **Supabase Realtime** for live wallet updates.

---

## ✨ Features

### 👤 Account & Authentication
- User registration
- Name + dummy email + password authentication
- No real email required
- No email verification
- No SMTP or email delivery
- Secure server-side password hashing
- Login and logout
- Persistent authentication sessions
- Account deletion

### 💰 Wallet Management
- Automatic wallet creation
- Unique wallet ID
- Simulated wallet balance
- Deposit money
- Withdraw money
- Wallet-to-wallet transfers
- Balance validation
- Atomic transaction processing

### 🔐 Wallet Security
- 4-digit wallet PIN
- PIN-protected money operations
- PIN verification on the server
- Failed PIN attempt tracking
- PIN lock handling
- PIN recovery using account password

### 💸 Send & Receive Money
- Send money using wallet ID
- Verify recipient before transfer
- Receive money
- Payment requests
- QR-based payment information
- Wallet ID sharing

### 📷 QR Code
- Generate wallet QR code
- Generate payment-request QR code
- Scan QR codes using camera
- Read payment information from QR
- Recipient validation before payment

### 📊 Transaction Management
- Transaction history
- Sent/received identification
- Search transactions
- Filter by category
- Filter by date
- Sort transactions
- Income/expense classification
- CSV export
- Printable transaction receipt

### 📈 Analytics
- Current balance
- Monthly income
- Monthly expenses
- Net monthly movement
- Largest expense
- Top spending category
- Income vs expense visualization
- Expense category analysis
- Top payees

### 🎯 Budgets
- Create budgets
- Category-based budgets
- Monthly budget tracking
- Budget progress
- Spending vs budget comparison

### 👥 Contacts
- Save wallet contacts
- Add nicknames
- Favorite contacts
- Quick recipient selection

### 🔁 Recurring Payments
- Create recurring payments
- Weekly schedules
- Monthly schedules
- Calendar-aware monthly dates
- Manual "Run Now" simulation
- Transaction generation for executed recurring payments

> Recurring payments are simulated and do not automatically move real money.

### 🔔 Notifications
- Wallet activity notifications
- Transfer notifications
- Transaction notifications
- Realtime notification updates

### ⚡ Realtime Updates
- Supabase PostgreSQL
- Supabase Postgres Changes
- Server-side Realtime subscription
- Server-Sent Events (SSE)
- Automatic dashboard refresh
- Live balance updates
- Live transaction updates
- Live notifications

### 🎨 UI
- Dashboard
- Responsive design
- Dark mode
- Navigation
- Wallet summary cards
- Confirmation modals
- Error/success notifications
- Mobile-friendly layout

---

# 🏗️ System Architecture

The project uses a **server-authoritative architecture**.

```text
┌───────────────────────────┐
│         Browser           │
│ HTML / CSS / JavaScript   │
└─────────────┬─────────────┘
              │
              │ HTTPS / API
              ▼
┌───────────────────────────┐
│       Node.js Server      │
│         server.js         │
│                           │
│ • Authentication          │
│ • Validation              │
│ • Wallet operations       │
│ • Session management      │
│ • Realtime subscription   │
└─────────────┬─────────────┘
              │
       ┌──────┴───────┐
       │              │
       ▼              ▼
┌──────────────┐ ┌───────────────┐
│   Supabase   │ │   Supabase    │
│ PostgreSQL   │ │   Realtime    │
└──────────────┘ └───────┬───────┘
                          │
                          ▼
                   Node.js SSE
                          │
                          ▼
                       Browser
```

### Why this architecture?

Sensitive operations stay on the backend.

The browser does **not** receive the Supabase secret key.

The server is responsible for:

- User authentication
- Password hashing
- Session validation
- Wallet calculations
- Balance validation
- Transaction creation
- PIN verification
- Database operations
- Realtime event handling

---

# ⚡ Realtime Flow

Example: User A sends money to User B.

```text
User A
  │
  │ Send ₹500
  ▼
Node.js Server
  │
  ▼
Supabase PostgreSQL
  │
  ├── Update User A wallet
  ├── Update User B wallet
  ├── Create transaction
  └── Create notification
  │
  ▼
Supabase Realtime
  │
  ▼
Node.js Realtime Listener
  │
  ▼
Server-Sent Event
  │
  ▼
User B Browser
  │
  ├── Refresh balance
  ├── Refresh transaction history
  └── Refresh notifications
```

This means supported wallet changes can appear without manually refreshing the page.

---

# 🗄️ Database

Supabase is the **only runtime database**.

Main tables include:

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
auth_sessions
```

Conceptual relationship:

```text
users
├── profiles
├── wallets
│   └── wallet_security
├── transactions
├── contacts
├── budgets
├── recurring_payments
├── notifications
└── auth_sessions
```

The database schema is available in:

```text
supabase/schema.sql
```

---

# 📂 Project Structure

```text
digital-wallet-simulator/
│
├── index.html
├── login.html
├── register.html
├── user.html
│
├── server.js
├── reset_data.py
├── package.json
├── package-lock.json
├── vite.config.js
├── .env.example
├── .gitignore
├── README.md
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
└── supabase/
    └── schema.sql
```

### Removed from the final architecture

The project intentionally does **not** use:

```text
data.json
scripts/migrate_data_to_supabase.js
```

There is no local JSON database and no migration step.

---

# 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 | Page structure |
| CSS3 | UI and responsive design |
| Vanilla JavaScript | Frontend logic |
| Node.js | Backend server |
| Vite | Development/build middleware |
| Supabase PostgreSQL | Persistent database |
| Supabase Realtime | Live database changes |
| Server-Sent Events | Browser realtime event stream |
| Python | Database reset utility |
| QRCode | QR generation |
| HTML5-QRCode | QR scanning |
| Chart.js | Analytics charts |

---

# ✅ Requirements

Install the following:

- Node.js
- npm
- Python 3.x
- A Supabase account

A modern Node.js version with ECMAScript module support is recommended.

---

# 🚀 Installation

## 1. Clone the Repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd digital-wallet-simulator
```

---

## 2. Install Dependencies

```bash
npm install
```

---

# ☁️ Supabase Setup

## 3. Create a Supabase Project

Create a new project in Supabase.

Open:

```text
Supabase Dashboard
→ SQL Editor
```

Open:

```text
supabase/schema.sql
```

Copy the complete file into the Supabase SQL Editor and execute it.

This creates the application database structure and Realtime configuration.

---

# 🔑 Environment Variables

## 4. Create `.env`

Copy:

```text
.env.example
```

to:

```text
.env
```

Example:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY

SESSION_TTL_HOURS=24
COOKIE_SECURE=false
PORT=5173
```

### Production settings

```env
NODE_ENV=production
COOKIE_SECURE=true
```

---

## 🔒 Important Security Rule

Never expose the Supabase secret key in frontend code.

Do **not** put it inside:

```text
index.html
login.html
register.html
user.html
js/*.js
```

Do not create a frontend variable such as:

```text
VITE_SUPABASE_SECRET_KEY
```

The Supabase secret key must remain on the Node.js server.

Also make sure `.env` is included in `.gitignore`.

---

# ▶️ Run Locally

Start the application:

```bash
npm run dev
```

or:

```bash
npm start
```

Then open:

```text
http://localhost:5173/
```

---

# 👤 Create a Demo Account

Example:

```text
Name:
Alex

Email:
alex@wallet.local

Password:
Test@12345

Confirm Password:
Test@12345
```

The email is only a dummy identifier.

No real email address or inbox is required.

---

# ⚡ Testing Realtime

Open two browser sessions.

```text
Browser A → User A
Browser B → User B
```

Then:

```text
User A
   ↓
Send ₹500
   ↓
User B
```

User B should receive the relevant updates automatically:

- Wallet balance
- Transaction history
- Notifications

You can inspect the browser's Network tab and check that:

```text
/api/realtime
```

remains connected as an EventStream.

---

# ❤️ Health Check

The backend provides:

```text
GET /api/health
```

Local:

```text
http://localhost:5173/api/health
```

Use this endpoint to verify that the deployed server is running.

---

# 🧹 Reset Database

The project includes:

```text
reset_data.py
```

Run:

```bash
python reset_data.py
```

This utility is intended for clearing the simulator's Supabase data while keeping the database structure.

> ⚠️ Use this only when you intentionally want to delete your demo data.

---

# 🚀 Deployment

The application should be deployed as a **Node.js Web Service**, not as a static-only website.

The backend is required for:

- Authentication
- Database access
- Wallet operations
- Session cookies
- Realtime subscriptions
- Server-Sent Events

---

## Railway

### Build Command

```text
npm install
```

### Start Command

```text
npm start
```

### Environment Variables

Add:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY

NODE_ENV=production
COOKIE_SECURE=true
SESSION_TTL_HOURS=24
```

Use:

```text
/api/health
```

as the health-check endpoint.

Do not manually set `PORT` unless your hosting configuration specifically requires it. The application reads the platform-provided port.

---

## Render

Create a **Web Service**.

### Build Command

```text
npm install
```

### Start Command

```text
npm start
```

### Environment Variables

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY

NODE_ENV=production
COOKIE_SECURE=true
SESSION_TTL_HOURS=24
```

Health-check path:

```text
/api/health
```

---

# 🌐 Deployment Architecture

```text
                         Internet
                            │
                            ▼
                  ┌──────────────────┐
                  │  Railway/Render  │
                  │                  │
                  │   Node.js App    │
                  └────────┬─────────┘
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
      Supabase Database          Supabase Realtime
             │                           │
             └─────────────┬─────────────┘
                           │
                           ▼
                    Realtime Events
                           │
                           ▼
                         Browser
```

---

# 🧪 Production Checklist

Before deploying, verify:

```text
☐ Supabase project created
☐ supabase/schema.sql executed
☐ Required Realtime tables configured
☐ SUPABASE_URL configured
☐ SUPABASE_SECRET_KEY configured
☐ Secret key kept server-side
☐ .env excluded from Git
☐ npm install works
☐ npm start works
☐ /api/health works
☐ Registration works
☐ Login works
☐ Dummy email requires no email service
☐ Deposit works
☐ Withdraw works
☐ Transfer works
☐ Wallet PIN works
☐ QR generation works
☐ QR scanner works
☐ Transaction history works
☐ CSV export works
☐ Analytics works
☐ Budgets work
☐ Contacts work
☐ Recurring payments work
☐ Notifications work
☐ Realtime updates work
☐ Logout works
☐ Account deletion works
```

---

# 🔧 Troubleshooting

## `Failed to fetch`

Check:

```text
1. Node.js server is running
2. Supabase URL is correct
3. Supabase secret key is correct
4. Supabase project is active
5. Browser is opened through:
   http://localhost:5173
```

Do not open HTML files directly using:

```text
file:///
```

---

## Login Fails

Check:

```text
1. supabase/schema.sql was executed
2. Registration completed successfully
3. Dummy email is identical
4. Password is correct
5. Node server is running
```

Example:

```text
alex@wallet.local
```

---

## Realtime Is Not Updating

Check:

```text
1. Supabase Realtime is enabled
2. Required database tables are included in the Realtime publication
3. /api/realtime connection is active
4. Node.js server is running
5. Browser Network tab shows an EventStream connection
```

---

## Cookies Do Not Work After Deployment

Production should use:

```env
NODE_ENV=production
COOKIE_SECURE=true
```

The application should be accessed through HTTPS.

---

# 🔐 Security Considerations

This is a simulated wallet, not a production financial system.

Never use this application to handle real financial transactions.

Important rules:

- Never expose the Supabase secret key.
- Never commit `.env`.
- Never use real payment credentials.
- Never connect the simulator to a real bank account.
- Use HTTPS in production.
- Keep authentication secrets on the backend.
- Use strong production environment configuration.
- Treat this project as a demonstration/educational system.

---

# 📦 Build

The project contains a multi-page Vite configuration.

Build:

```bash
npm run build
```

Configured pages:

```text
index.html
login.html
register.html
user.html
```

For deployment, use the Node.js server:

```bash
npm start
```

---

# 🗃️ Data Model Overview

```text
User
 │
 ├── Profile
 │
 ├── Wallet
 │    └── Wallet Security / PIN
 │
 ├── Transactions
 │
 ├── Contacts
 │
 ├── Budgets
 │
 ├── Recurring Payments
 │
 ├── Notifications
 │
 └── Authentication Sessions
```

All runtime records are stored in Supabase PostgreSQL.

---

# 🧭 Development Workflow

Typical development cycle:

```text
1. Modify frontend/backend code
        ↓
2. Run npm run dev
        ↓
3. Test wallet operations
        ↓
4. Check Supabase database
        ↓
5. Test Realtime with two sessions
        ↓
6. Run npm run build
        ↓
7. Deploy
```

---

# 🎓 Project Purpose

This project can be used for:

- College projects
- Hackathons
- Web development demonstrations
- Database demonstrations
- Realtime application demonstrations
- Full-stack development learning
- Supabase/PostgreSQL practice

---

# 📜 License

Add your preferred license here before publishing the repository.

For example:

```text
MIT License
```

Do not claim a license unless you have actually added the corresponding license file.

---

# ⭐ Future Improvements

Possible future improvements include:

- Stronger production authentication
- Role-based administration
- Improved audit logging
- Rate limiting
- Multi-device session management
- Better transaction reconciliation
- Automated scheduled recurring payments
- Advanced notification delivery
- More granular database authorization
- Automated testing
- CI/CD

---

## 👨‍💻 Project

**Digital Wallet Simulator**

A simulated full-stack wallet application demonstrating:

```text
Frontend
    +
Node.js Backend
    +
PostgreSQL
    +
Supabase
    +
Realtime
    +
Secure Server-Side Operations
```

> Built for educational and demonstration purposes.
