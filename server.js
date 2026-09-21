import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createServer as createViteServer } from "vite";

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(root, "data.json");
const port = Number(process.env.PORT || 5173);
const MAX_AMOUNT = 1_000_000_000;
const MAX_NOTE_LENGTH = 120;
const MAX_NAME_LENGTH = 80;
const MAX_PHONE_LENGTH = 25;
const PIN_ATTEMPTS = 3;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();
let writeQueue = Promise.resolve();

function emptyData() {
  return {
    version: 2,
    users: [],
    profiles: [],
    wallets: [],
    wallet_security: [],
    transactions: [],
    contacts: [],
    budgets: [],
    recurring_payments: [],
    notifications: []
  };
}

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmailStyle(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validWalletId(value) {
  return /^DW-[A-Z0-9]{10}$/.test(String(value || "").trim().toUpperCase());
}

function validPin(value) {
  return /^\d{4}$/.test(String(value || ""));
}

function validAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT && Math.round(amount * 100) === amount * 100;
}

function cleanText(value, maxLength, { allowEmpty = true } = {}) {
  const text = String(value ?? "").trim();
  if (!allowEmpty && !text) return null;
  if (text.length > maxLength) return null;
  return text;
}

function publicUser(user) {
  if (!user) return null;
  const copy = clone(user);
  delete copy.password_hash;
  return copy;
}

function sanitizeRow(table, row) {
  const copy = clone(row);
  if (!copy) return copy;
  if (table === "users") delete copy.password_hash;
  if (table === "wallet_security") delete copy.pin_hash;
  return copy;
}

function makeReference(existing) {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  let reference;
  do {
    reference = `TXN-${day}-${randomBytes(3).toString("hex").toUpperCase()}`;
  } while (existing.some(item => item.reference_id === reference));
  return reference;
}

function migrateToVersion2(raw) {
  const base = emptyData();
  if (!raw || !Array.isArray(raw.users)) return base;

  const nestedUsers = raw.users.some(user => user.profile || user.wallet || user.transactions || user.contacts || user.budgets);
  if (!nestedUsers && Array.isArray(raw.profiles)) {
    const transactions = clone(raw.transactions || []).map(tx => ({ status: "completed", ...tx }));
    const contacts = clone(raw.contacts || []).map(contact => ({ favorite: false, ...contact }));
    const usedReferences = new Set(transactions.map(tx => tx.reference_id).filter(Boolean));
    transactions.forEach(tx => {
      if (!tx.reference_id) {
        let reference;
        do reference = `TXN-${String(tx.created_at || now()).slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
        while (usedReferences.has(reference));
        tx.reference_id = reference;
        usedReferences.add(reference);
      }
    });
    return {
      version: 2,
      users: clone(raw.users),
      profiles: clone(raw.profiles || []),
      wallets: clone(raw.wallets || []),
      wallet_security: clone(raw.wallet_security || []).map(item => ({ failed_attempts: 0, locked: false, ...item, updated_at: item.updated_at || now() })),
      transactions,
      contacts,
      budgets: clone(raw.budgets || []),
      recurring_payments: clone(raw.recurring_payments || []),
      notifications: clone(raw.notifications || [])
    };
  }

  const transactionMap = new Map();
  const contactMap = new Map();
  const budgetMap = new Map();
  const recurringMap = new Map();
  const notificationMap = new Map();

  base.users = raw.users.map(({ profile, wallet, wallet_security, transactions, contacts, budgets, recurring_payments, notifications, ...user }) => ({
    ...user,
    user_metadata: user.user_metadata || {}
  }));

  for (const user of raw.users) {
    if (user.profile) base.profiles.push(user.profile);
    if (user.wallet) base.wallets.push(user.wallet);
    if (user.wallet_security) base.wallet_security.push(user.wallet_security);
    for (const tx of user.transactions || []) transactionMap.set(tx.id, tx);
    for (const contact of user.contacts || []) contactMap.set(contact.id, { favorite: false, ...contact });
    for (const budget of user.budgets || []) budgetMap.set(budget.id, budget);
    for (const recurring of user.recurring_payments || []) recurringMap.set(recurring.id, recurring);
    for (const notification of user.notifications || []) notificationMap.set(notification.id, notification);
  }

  base.transactions = [...transactionMap.values()].map(tx => ({
    status: "completed",
    ...tx,
    reference_id: tx.reference_id || makeReference([...transactionMap.values()])
  }));
  base.contacts = [...contactMap.values()];
  base.budgets = [...budgetMap.values()];
  base.recurring_payments = [...recurringMap.values()];
  base.notifications = [...notificationMap.values()];

  for (const security of base.wallet_security) {
    security.failed_attempts = Number(security.failed_attempts || 0);
    security.locked = Boolean(security.locked);
    security.updated_at ||= now();
  }
  return base;
}

async function ensureDataFile() {
  try {
    await fs.access(dataPath);
  } catch {
    await fs.writeFile(dataPath, JSON.stringify(emptyData(), null, 2));
  }
}

async function readData() {
  await ensureDataFile();
  return migrateToVersion2(JSON.parse(await fs.readFile(dataPath, "utf8")));
}

async function writeData(data) {
  const canonical = { ...emptyData(), ...data, version: 2 };
  await fs.writeFile(dataPath, JSON.stringify(canonical, null, 2), "utf8");
  return canonical;
}

async function mutateData(mutator) {
  let result;
  const task = writeQueue.catch(() => undefined).then(async () => {
    const data = await readData();
    result = await mutator(data);
    await writeData(data);
  });
  writeQueue = task;
  await task;
  return result;
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function ok(data = null) {
  return { data, error: null };
}

function fail(code, message) {
  return { data: null, error: { code, message } };
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { code: "INVALID_JSON", status: 400 });
  }
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return Object.fromEntries(header.split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const idx = part.indexOf("=");
    return idx === -1 ? [part, ""] : [decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1))];
  }));
}

function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function sessionUserId(request) {
  const token = parseCookies(request).wallet_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session.userId;
}

function sessionCookie(token) {
  return `wallet_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`;
}

function clearedSessionCookie() {
  return "wallet_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function currentUser(data, request) {
  const userId = sessionUserId(request);
  return userId ? data.users.find(user => user.id === userId) || null : null;
}

function requireSession(data, request) {
  const user = currentUser(data, request);
  return user || null;
}

function userRows(data, table, userId) {
  const rows = data[table] || [];
  if (table === "profiles") return rows.filter(row => row.id === userId);
  if (["wallets", "wallet_security", "budgets", "recurring_payments"].includes(table)) return rows.filter(row => row.user_id === userId);
  if (table === "contacts") return rows.filter(row => row.owner_id === userId);
  if (table === "notifications") return rows.filter(row => row.user_id === userId);
  if (table === "transactions") return rows.filter(row => row.sender_id === userId || row.receiver_id === userId);
  if (table === "users") return rows.filter(row => row.id === userId);
  return [];
}

function matchesFilter(row, filter) {
  if (!filter || typeof filter !== "object") return true;
  if (filter.op === "eq") return String(row[filter.column]) === String(filter.value);
  if (filter.op === "neq") return String(row[filter.column]) !== String(filter.value);
  if (filter.op === "contains") return String(row[filter.column] || "").toLowerCase().includes(String(filter.value || "").toLowerCase());
  return false;
}

function matchesAll(row, filters = []) {
  return filters.every(filter => matchesFilter(row, filter));
}

function matchesAny(row, any = []) {
  return !any.length || any.some(filterGroup => Array.isArray(filterGroup) && filterGroup.every(filter => matchesFilter(row, filter)));
}

function sortableRows(rows, sorts = []) {
  const output = [...rows];
  output.sort((a, b) => {
    for (const sort of sorts) {
      const av = a[sort.column] ?? "";
      const bv = b[sort.column] ?? "";
      if (av === bv) continue;
      const result = av > bv ? 1 : -1;
      return sort.ascending === false ? -result : result;
    }
    return 0;
  });
  return output;
}

function ensureWalletSecurity(data, userId) {
  let security = data.wallet_security.find(item => item.user_id === userId);
  if (!security) {
    security = { user_id: userId, pin_hash: null, failed_attempts: 0, locked: false, updated_at: now() };
    data.wallet_security.push(security);
  }
  return security;
}

function hashLegacy(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function hashSecret(value) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(String(value), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt}$${Buffer.from(derived).toString("hex")}`;
}

async function verifySecret(value, stored) {
  if (!stored) return { valid: false, legacy: false };
  if (/^[a-f0-9]{64}$/i.test(stored)) return { valid: hashLegacy(value) === stored, legacy: true };
  const [kind, salt, expected] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !expected) return { valid: false, legacy: false };
  const derived = await scrypt(String(value), salt, 64, { N: 16384, r: 8, p: 1 });
  return { valid: Buffer.from(derived).toString("hex") === expected, legacy: false };
}

async function verifyPin(data, user, pin) {
  const security = ensureWalletSecurity(data, user.id);
  if (security.locked) return { ok: false, code: "PIN_LOCKED", message: "Wallet PIN is locked after 3 failed attempts. Reset it with your account password in Profile & Settings." };
  if (!validPin(pin)) return { ok: false, code: "INVALID_PIN", message: "Enter the 4-digit wallet PIN." };
  const check = await verifySecret(pin, security.pin_hash);
  if (check.valid) {
    security.failed_attempts = 0;
    security.updated_at = now();
    if (check.legacy) security.pin_hash = await hashSecret(pin);
    return { ok: true };
  }
  security.failed_attempts = Number(security.failed_attempts || 0) + 1;
  if (security.failed_attempts >= PIN_ATTEMPTS) security.locked = true;
  security.updated_at = now();
  return {
    ok: false,
    code: security.locked ? "PIN_LOCKED" : "INVALID_PIN",
    message: security.locked ? "Wallet PIN is now locked after 3 failed attempts. Reset it with your account password." : "Incorrect PIN.",
    remaining_attempts: Math.max(0, PIN_ATTEMPTS - security.failed_attempts)
  };
}

function makeTransaction(data, values) {
  const transaction = {
    id: randomUUID(),
    reference_id: makeReference(data.transactions),
    status: "completed",
    created_at: now(),
    ...values
  };
  data.transactions.push(transaction);
  return transaction;
}

function addNotification(data, userId, title, message, type = "info") {
  data.notifications.push({ id: randomUUID(), user_id: userId, title, message, type, is_read: false, created_at: now() });
}

async function authSignup(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const fullName = cleanText(body.full_name, MAX_NAME_LENGTH, { allowEmpty: false });
  const password = String(body.password || "");
  if (!validEmailStyle(email)) return sendJson(response, 400, fail("INVALID_EMAIL", "Use a valid email-style wallet login ID."));
  if (!fullName) return sendJson(response, 400, fail("INVALID_NAME", "Enter your name using 80 characters or fewer."));
  if (password.length < 8 || password.length > 128) return sendJson(response, 400, fail("INVALID_PASSWORD", "Password must be 8–128 characters."));

  let result = null;
  await mutateData(async data => {
    if (data.users.some(user => normalizeEmail(user.email) === email)) {
      result = fail("DUPLICATE_EMAIL", "This wallet login ID is already registered.");
      return data;
    }
    const userId = randomUUID();
    const walletId = (() => {
      let value;
      do value = `DW-${randomBytes(5).toString("hex").toUpperCase()}`;
      while (data.profiles.some(profile => profile.wallet_id === value));
      return value;
    })();
    const user = {
      id: userId,
      email,
      password_hash: await hashSecret(password),
      user_metadata: { full_name: fullName, email_demo: true },
      created_at: now()
    };
    data.users.push(user);
    data.profiles.push({ id: userId, full_name: fullName, email, username: null, phone: null, wallet_id: walletId, created_at: now() });
    data.wallets.push({ user_id: userId, balance: 0, updated_at: now() });
    data.wallet_security.push({ user_id: userId, pin_hash: null, failed_attempts: 0, locked: false, updated_at: now() });
    addNotification(data, userId, "Welcome to your wallet", "Your simulated wallet is ready.");
    result = ok({ user: publicUser(user), session: { user: publicUser(user) } });
    return data;
  });

  if (result?.error) return sendJson(response, 400, result);
  const userId = result?.data?.user?.id;
  const actualToken = createSession(userId);
  return sendJson(response, 200, result, { "Set-Cookie": sessionCookie(actualToken) });
}

async function authSignin(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!validEmailStyle(email) || !password) return sendJson(response, 400, fail("INVALID_CREDENTIALS", "Enter your wallet login ID and password."));

  let result;
  await mutateData(async data => {
    const user = data.users.find(candidate => normalizeEmail(candidate.email) === email);
    const check = user ? await verifySecret(password, user.password_hash) : { valid: false };
    if (!user || !check.valid) {
      result = fail("INVALID_CREDENTIALS", "Invalid wallet login ID or password.");
      return data;
    }
    if (check.legacy) user.password_hash = await hashSecret(password);
    result = ok({ user: publicUser(user), session: { user: publicUser(user) } });
    return data;
  });
  if (result?.error) return sendJson(response, 401, result);
  const token = createSession(result.data.user.id);
  return sendJson(response, 200, result, { "Set-Cookie": sessionCookie(token) });
}

async function authSession(request, response) {
  const data = await readData();
  const user = currentUser(data, request);
  if (!user) return sendJson(response, 200, ok({ session: null }));
  return sendJson(response, 200, ok({ session: { user: publicUser(user) } }));
}

async function authSignout(request, response) {
  const token = parseCookies(request).wallet_session;
  if (token) sessions.delete(token);
  return sendJson(response, 200, ok({}), { "Set-Cookie": clearedSessionCookie() });
}

function publicProfile(profile) {
  return profile ? clone(profile) : null;
}

async function handleQuery(request, response) {
  const data = await readData();
  const user = requireSession(data, request);
  if (!user) return sendJson(response, 401, fail("AUTH_REQUIRED", "Please log in to use your wallet."));
  const body = await readBody(request);
  const table = String(body.table || "");
  const allowed = ["profiles", "wallets", "transactions", "contacts", "budgets", "recurring_payments", "notifications", "wallet_security"];
  if (!allowed.includes(table)) return sendJson(response, 400, fail("INVALID_TABLE", "That wallet data table is not available."));
  let rows = userRows(data, table, user.id).filter(row => matchesAll(row, body.filters || []) && matchesAny(row, body.any || []));
  rows = sortableRows(rows, body.sorts || []);
  if (Number.isInteger(body.limit) && body.limit > 0) rows = rows.slice(0, body.limit);
  rows = rows.map(row => sanitizeRow(table, row));
  return sendJson(response, 200, ok(body.single ? rows[0] || null : rows));
}

function allowedInsert(table, row, userId) {
  const value = clone(row || {});
  if (table === "contacts") return { ...value, id: randomUUID(), owner_id: userId, created_at: now(), favorite: Boolean(value.favorite) };
  if (table === "budgets") return { ...value, id: randomUUID(), user_id: userId, created_at: now() };
  if (table === "recurring_payments") return { ...value, id: randomUUID(), user_id: userId, created_at: now(), active: true };
  return null;
}

function canUpdateTable(table) {
  return ["profiles", "contacts", "budgets", "recurring_payments", "notifications"].includes(table);
}

function permittedUpdate(table, values) {
  if (table === "profiles") return { full_name: cleanText(values.full_name, MAX_NAME_LENGTH) ?? "", phone: cleanText(values.phone, MAX_PHONE_LENGTH) ?? "" };
  if (table === "contacts") return { nickname: cleanText(values.nickname, 40) ?? "", favorite: Boolean(values.favorite) };
  if (table === "budgets") return { amount: Number(values.amount), category: cleanText(values.category, 30, { allowEmpty: false }) };
  if (table === "recurring_payments") return { title: cleanText(values.title, 80, { allowEmpty: false }), amount: Number(values.amount), frequency: values.frequency, category: cleanText(values.category, 30, { allowEmpty: false }), active: values.active !== false, next_run_at: values.next_run_at };
  if (table === "notifications") return { is_read: Boolean(values.is_read) };
  return {};
}

function authorizedRows(data, table, userId, filters = []) {
  return userRows(data, table, userId).filter(row => matchesAll(row, filters));
}

async function handleMutation(request, response) {
  const body = await readBody(request);
  let result;
  try {
    await mutateData(async data => {
      const user = requireSession(data, request);
      if (!user) {
        result = fail("AUTH_REQUIRED", "Please log in to use your wallet.");
        return data;
      }
      const table = String(body.table || "");
      const action = String(body.action || "");
      if (action === "insert") {
        const rows = Array.isArray(body.rows) ? body.rows : [body.rows];
        const created = [];
        for (const row of rows) {
          const entry = allowedInsert(table, row, user.id);
          if (!entry) {
            result = fail("MUTATION_NOT_ALLOWED", "This wallet table cannot be changed directly.");
            return data;
          }
          if (table === "budgets") {
            if (!validAmount(entry.amount) || !CATEGORIES.has(entry.category)) { result = fail("INVALID_BUDGET", "Enter a valid budget amount and category."); return data; }
          }
          if (table === "recurring_payments") {
            if (!validAmount(entry.amount) || !["weekly", "monthly"].includes(entry.frequency)) { result = fail("INVALID_RECURRING", "Enter valid recurring payment details."); return data; }
          }
          if (table === "contacts") {
            if (!validWalletId(entry.wallet_id)) { result = fail("INVALID_WALLET_ID", "Enter a valid wallet ID such as DW-XXXXXXXXXX."); return data; }
            const found = data.profiles.find(profile => profile.wallet_id === String(entry.wallet_id).toUpperCase());
            if (!found || found.id === user.id) { result = fail("CONTACT_NOT_FOUND", "Choose another registered wallet as the contact."); return data; }
            entry.contact_user_id = found.id;
            entry.wallet_id = found.wallet_id;
            entry.nickname = cleanText(entry.nickname || found.full_name, 40, { allowEmpty: false }) || found.full_name;
          }
          data[table].push(entry);
          created.push(sanitizeRow(table, entry));
        }
        result = ok(created.length === 1 ? created[0] : created);
        return data;
      }
      if (action === "update") {
        const table = String(body.table || "");
        if (!canUpdateTable(table)) { result = fail("MUTATION_NOT_ALLOWED", "This wallet table cannot be updated directly."); return data; }
        const rows = authorizedRows(data, table, user.id, body.filters || []);
        const values = permittedUpdate(table, body.values || {});
        if (table === "profiles" && !values.full_name) { result = fail("INVALID_NAME", "Enter your name."); return data; }
        if (["budgets", "recurring_payments"].includes(table) && values.amount != null && !validAmount(values.amount)) { result = fail("INVALID_AMOUNT", "Enter a valid positive amount."); return data; }
        if (table === "recurring_payments" && !["weekly", "monthly"].includes(values.frequency)) { result = fail("INVALID_RECURRING", "Invalid recurring frequency."); return data; }
        rows.forEach(row => Object.assign(row, values));
        result = ok(rows.map(row => sanitizeRow(table, row)));
        return data;
      }
      if (action === "delete") {
        const table = String(body.table || "");
        if (!["contacts", "budgets", "recurring_payments"].includes(table)) { result = fail("MUTATION_NOT_ALLOWED", "This wallet data cannot be deleted directly."); return data; }
        const rows = data[table] || [];
        const remove = new Set(authorizedRows(data, table, user.id, body.filters || []));
        data[table] = rows.filter(row => !remove.has(row));
        result = ok({ deleted: remove.size });
        return data;
      }
      if (action === "upsert") {
        const table = String(body.table || "");
        if (table !== "budgets") { result = fail("MUTATION_NOT_ALLOWED", "Only budgets support upsert."); return data; }
        const row = body.row || {};
        const amount = Number(row.amount);
        const category = cleanText(row.category, 30, { allowEmpty: false });
        if (!validAmount(amount) || !CATEGORIES.has(category)) { result = fail("INVALID_BUDGET", "Enter a valid budget amount and category."); return data; }
        const monthStart = String(row.month_start || "");
        if (!/^\d{4}-\d{2}-01$/.test(monthStart)) { result = fail("INVALID_MONTH", "Invalid budget month."); return data; }
        let existing = data.budgets.find(item => item.user_id === user.id && item.month_start === monthStart && item.category === category);
        if (existing) Object.assign(existing, { amount, category });
        else {
          existing = { id: randomUUID(), user_id: user.id, month_start: monthStart, category, amount, created_at: now() };
          data.budgets.push(existing);
        }
        result = ok(sanitizeRow(table, existing));
        return data;
      }
      result = fail("INVALID_ACTION", "Unsupported wallet data operation.");
      return data;
    });
  } catch (error) {
    result = fail(error.code || "DATA_WRITE_FAILED", error.message || "Unable to update wallet data.");
  }
  return sendJson(response, result?.error ? 400 : 200, result);
}

const CATEGORIES = new Set(["Food", "Shopping", "Travel", "Bills", "Income", "Entertainment", "Education", "Healthcare", "Other"]);

async function handleRpc(request, response) {
  let result = null;
  try {
    await mutateData(async data => {
      const user = requireSession(data, request);
      if (!user) { result = fail("AUTH_REQUIRED", "Please log in to use your wallet."); return data; }
      const params = await readBody(request).then(body => ({ name: body.name, params: body.params || {} }));
      const { name, params: p } = params;

      const wallet = data.wallets.find(item => item.user_id === user.id);
      const profile = data.profiles.find(item => item.id === user.id);
      const security = ensureWalletSecurity(data, user.id);
      if (!wallet || !profile || !security) { result = fail("WALLET_NOT_READY", "Your wallet is not ready. Refresh and try again."); return data; }

      if (name === "get_wallet_status") {
        result = ok({ has_pin: Boolean(security.pin_hash), locked: Boolean(security.locked), failed_attempts: Number(security.failed_attempts || 0), max_attempts: PIN_ATTEMPTS });
        return data;
      }

      if (name === "set_wallet_pin") {
        if (security.pin_hash) { result = fail("PIN_EXISTS", "A wallet PIN is already configured. Use Change PIN instead."); return data; }
        if (!validPin(p.p_pin)) { result = fail("INVALID_PIN", "PIN must be exactly 4 digits."); return data; }
        security.pin_hash = await hashSecret(p.p_pin);
        security.failed_attempts = 0;
        security.locked = false;
        security.updated_at = now();
        result = ok({ success: true });
        return data;
      }

      if (name === "change_wallet_pin") {
        if (!validPin(p.p_old_pin) || !validPin(p.p_pin)) { result = fail("INVALID_PIN", "Enter both PINs as exactly 4 digits."); return data; }
        const oldCheck = await verifySecret(p.p_old_pin, security.pin_hash);
        if (!oldCheck.valid) { result = ok({ success: false, message: "Current PIN is incorrect." }); return data; }
        security.pin_hash = await hashSecret(p.p_pin);
        security.failed_attempts = 0;
        security.locked = false;
        security.updated_at = now();
        result = ok({ success: true });
        return data;
      }

      if (name === "reset_wallet_pin_with_password") {
        if (!security.locked) { result = fail("PIN_NOT_LOCKED", "Your PIN does not need recovery."); return data; }
        if (!validPin(p.p_new_pin)) { result = fail("INVALID_PIN", "New PIN must be exactly 4 digits."); return data; }
        const check = await verifySecret(p.password, user.password_hash);
        if (!check.valid) { result = fail("INVALID_PASSWORD", "Account password is incorrect."); return data; }
        security.pin_hash = await hashSecret(p.p_new_pin);
        security.failed_attempts = 0;
        security.locked = false;
        security.updated_at = now();
        result = ok({ success: true });
        return data;
      }

      if (name === "verify_wallet_pin") {
        const verification = await verifyPin(data, user, p.p_pin);
        if (!verification.ok) result = ok({ success: false, locked: verification.code === "PIN_LOCKED", message: verification.message, remaining_attempts: verification.remaining_attempts });
        else result = ok({ success: true, remaining_attempts: PIN_ATTEMPTS });
        return data;
      }

      if (["deposit_wallet", "withdraw_wallet", "transfer_wallet", "run_recurring_payment"].includes(name)) {
        if (!security.pin_hash) { result = fail("PIN_REQUIRED", "Set your 4-digit wallet PIN before making transactions."); return data; }
        const pinCheck = await verifyPin(data, user, p.p_pin);
        if (!pinCheck.ok) { result = ok({ success: false, locked: pinCheck.code === "PIN_LOCKED", message: pinCheck.message, remaining_attempts: pinCheck.remaining_attempts }); return data; }
      }

      if (name === "deposit_wallet" || name === "withdraw_wallet") {
        if (!validAmount(p.p_amount)) { result = fail("INVALID_AMOUNT", "Enter a valid amount between ₹0.01 and ₹1,000,000,000."); return data; }
        const amount = Number(p.p_amount);
        const category = CATEGORIES.has(p.p_category) ? p.p_category : "Other";
        const note = cleanText(p.p_note, MAX_NOTE_LENGTH);
        if (name === "withdraw_wallet" && Number(wallet.balance) < amount) { result = fail("INSUFFICIENT_BALANCE", "Insufficient simulated balance."); return data; }
        wallet.balance = Number(wallet.balance) + (name === "deposit_wallet" ? amount : -amount);
        wallet.updated_at = now();
        const transaction = makeTransaction(data, {
          sender_id: name === "withdraw_wallet" ? user.id : null,
          receiver_id: name === "deposit_wallet" ? user.id : null,
          amount,
          type: name === "deposit_wallet" ? "deposit" : "withdrawal",
          category: name === "deposit_wallet" ? "Income" : category,
          note: note || null,
          counterparty_wallet_id: null,
          sender_wallet_id: null,
          receiver_wallet_id: null
        });
        addNotification(data, user.id, name === "deposit_wallet" ? "Money deposited" : "Money withdrawn", `${amount} was recorded in your simulated wallet.`);
        result = ok({ success: true, transaction_id: transaction.id, reference_id: transaction.reference_id, status: transaction.status });
        return data;
      }

      if (name === "transfer_wallet") {
        const recipientWalletId = String(p.p_receiver_wallet_id || "").trim().toUpperCase();
        if (!validWalletId(recipientWalletId)) { result = fail("INVALID_WALLET_ID", "Wallet ID should look like DW-XXXXXXXXXX."); return data; }
        if (!validAmount(p.p_amount)) { result = fail("INVALID_AMOUNT", "Enter a valid transfer amount."); return data; }
        const amount = Number(p.p_amount);
        const category = CATEGORIES.has(p.p_category) ? p.p_category : "Other";
        const note = cleanText(p.p_note, MAX_NOTE_LENGTH);
        const recipient = data.profiles.find(item => item.wallet_id === recipientWalletId);
        if (!recipient) { result = fail("RECIPIENT_NOT_FOUND", "Recipient wallet was not found."); return data; }
        if (recipient.id === user.id) { result = fail("SELF_TRANSFER", "You cannot transfer money to your own wallet."); return data; }
        if (Number(wallet.balance) < amount) { result = fail("INSUFFICIENT_BALANCE", "Insufficient simulated balance."); return data; }
        const receiverWallet = data.wallets.find(item => item.user_id === recipient.id);
        if (!receiverWallet) { result = fail("RECIPIENT_WALLET_MISSING", "Recipient wallet is not ready."); return data; }
        const senderWalletId = profile.wallet_id;
        wallet.balance -= amount;
        receiverWallet.balance += amount;
        const timestamp = now();
        wallet.updated_at = timestamp;
        receiverWallet.updated_at = timestamp;
        const transaction = makeTransaction(data, {
          sender_id: user.id,
          receiver_id: recipient.id,
          amount,
          type: "transfer",
          category,
          note: note || null,
          sender_wallet_id: senderWalletId,
          receiver_wallet_id: recipient.wallet_id,
          counterparty_wallet_id: recipient.wallet_id,
          counterparty_name: recipient.full_name
        });
        addNotification(data, recipient.id, "Money received", `You received ${amount} in your simulated wallet.`);
        addNotification(data, user.id, "Transfer completed", `You sent ${amount} to ${recipient.full_name}.`);
        result = ok({ success: true, transaction_id: transaction.id, reference_id: transaction.reference_id, status: transaction.status, recipient: { full_name: recipient.full_name, wallet_id: recipient.wallet_id } });
        return data;
      }

      if (name === "lookup_wallet") {
        const walletId = String(p.p_wallet_id || "").trim().toUpperCase();
        if (!validWalletId(walletId)) { result = fail("INVALID_WALLET_ID", "Enter a valid wallet ID such as DW-XXXXXXXXXX."); return data; }
        const found = data.profiles.find(item => item.wallet_id === walletId);
        result = found ? ok({ user_id: found.id, wallet_id: found.wallet_id, full_name: found.full_name }) : fail("WALLET_NOT_FOUND", "Wallet not found.");
        return data;
      }

      if (name === "run_recurring_payment") {
        const recurring = data.recurring_payments.find(item => item.id === p.p_recurring_id && item.user_id === user.id);
        if (!recurring) { result = fail("RECURRING_NOT_FOUND", "Recurring payment was not found."); return data; }
        if (!recurring.active) { result = fail("RECURRING_INACTIVE", "This recurring payment is paused."); return data; }
        if (!validAmount(recurring.amount)) { result = fail("INVALID_AMOUNT", "Recurring payment amount is invalid."); return data; }
        const amount = Number(recurring.amount);
        if (Number(wallet.balance) < amount) { result = fail("INSUFFICIENT_BALANCE", "Insufficient simulated balance."); return data; }
        wallet.balance -= amount;
        const currentNext = new Date(recurring.next_run_at);
        const next = Number.isNaN(currentNext.getTime()) ? new Date() : currentNext;
        if (recurring.frequency === "monthly") next.setMonth(next.getMonth() + 1); else next.setDate(next.getDate() + 7);
        recurring.next_run_at = next.toISOString();
        wallet.updated_at = now();
        const transaction = makeTransaction(data, { sender_id: user.id, receiver_id: null, amount, type: "recurring_payment", category: recurring.category, note: recurring.title, sender_wallet_id: profile.wallet_id, counterparty_wallet_id: null });
        addNotification(data, user.id, "Recurring payment completed", `${recurring.title} was paid.`);
        result = ok({ success: true, transaction_id: transaction.id, reference_id: transaction.reference_id, status: transaction.status });
        return data;
      }

      if (name === "delete_account") {
        const passwordCheck = await verifySecret(p.password, user.password_hash);
        if (!passwordCheck.valid) { result = fail("INVALID_PASSWORD", "Account password is incorrect."); return data; }
        const id = user.id;
        data.users = data.users.filter(row => row.id !== id);
        data.profiles = data.profiles.filter(row => row.id !== id);
        data.wallets = data.wallets.filter(row => row.user_id !== id);
        data.wallet_security = data.wallet_security.filter(row => row.user_id !== id);
        data.transactions = data.transactions.filter(row => row.sender_id !== id && row.receiver_id !== id);
        data.contacts = data.contacts.filter(row => row.owner_id !== id && row.contact_user_id !== id);
        data.budgets = data.budgets.filter(row => row.user_id !== id);
        data.recurring_payments = data.recurring_payments.filter(row => row.user_id !== id);
        data.notifications = data.notifications.filter(row => row.user_id !== id);
        result = ok({ success: true });
        return data;
      }

      if (name === "reset_user_data") {
        const passwordCheck = await verifySecret(p.password, user.password_hash);
        if (!passwordCheck.valid) { result = fail("INVALID_PASSWORD", "Account password is incorrect."); return data; }
        const id = user.id;
        data.wallets.filter(row => row.user_id === id).forEach(row => { row.balance = 0; row.updated_at = now(); });
        data.wallet_security.filter(row => row.user_id === id).forEach(row => { row.pin_hash = null; row.failed_attempts = 0; row.locked = false; row.updated_at = now(); });
        data.transactions = data.transactions.filter(row => row.sender_id !== id && row.receiver_id !== id);
        data.contacts = data.contacts.filter(row => row.owner_id !== id);
        data.budgets = data.budgets.filter(row => row.user_id !== id);
        data.recurring_payments = data.recurring_payments.filter(row => row.user_id !== id);
        data.notifications = data.notifications.filter(row => row.user_id !== id);
        addNotification(data, id, "Simulation reset", "Your wallet simulation data was reset. Set a new PIN before making transactions.");
        result = ok({ success: true });
        return data;
      }

      result = fail("UNSUPPORTED_RPC", `Unsupported wallet operation: ${name}`);
      return data;
    });
  } catch (error) {
    result = fail(error.code || "RPC_FAILED", error.message || "Unable to complete the wallet operation.");
  }
  const status = result?.error?.code === "AUTH_REQUIRED" ? 401 : result?.error ? 400 : 200;
  const headers = result?.data?.success === true && result?.data?.reference_id ? {} : {};
  return sendJson(response, status, result, headers);
}

await ensureDataFile();
const existing = JSON.parse(await fs.readFile(dataPath, "utf8"));
const canonical = migrateToVersion2(existing);
if (JSON.stringify(existing) !== JSON.stringify(canonical)) await writeData(canonical);

const vite = await createViteServer({ server: { middlewareMode: true, hmr: false }, appType: "spa" });
const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/api/auth/session" && request.method === "GET") return await authSession(request, response);
    if (requestUrl.pathname === "/api/auth/signup" && request.method === "POST") return await authSignup(request, response);
    if (requestUrl.pathname === "/api/auth/signin" && request.method === "POST") return await authSignin(request, response);
    if (requestUrl.pathname === "/api/auth/signout" && request.method === "POST") return await authSignout(request, response);
    if (requestUrl.pathname === "/api/data/query" && request.method === "POST") return await handleQuery(request, response);
    if (requestUrl.pathname === "/api/data/mutate" && request.method === "POST") return await handleMutation(request, response);
    if (requestUrl.pathname === "/api/rpc" && request.method === "POST") return await handleRpc(request, response);

    vite.middlewares(request, response, () => {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });
  } catch (error) {
    console.error(error);
    const status = Number(error.status) || 500;
    sendJson(response, status, fail(error.code || "SERVER_ERROR", error.message || "Unable to access wallet data."));
  }
});

server.listen(port, () => {
  console.log(`Digital Wallet running at http://localhost:${port}`);
  console.log(`Single wallet storage: ${dataPath}`);
});
