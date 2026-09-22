import { createServer } from "node:http";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(root, "data.json");
const port = Number(process.env.PORT || 5173);
const maxAmount = 1_000_000_000;
const maxNoteLength = 120;
const maxNameLength = 80;
const maxPhoneLength = 25;
const pinAttempts = 3;
const sessionTtlMs = Number(process.env.SESSION_TTL_HOURS || 24) * 60 * 60 * 1000;
const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const supabaseSecretKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const cookieSecure = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";

if (!supabaseUrl || !supabaseSecretKey) {
  console.error("Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SECRET_KEY before starting the server.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const realtimeClients = new Map();
const realtimeTables = [
  "users", "profiles", "wallets", "wallet_security", "transactions",
  "contacts", "budgets", "recurring_payments", "notifications"
];
let realtimeChannel = null;
let realtimeStatus = "starting";

const categories = new Set(["Food", "Shopping", "Travel", "Bills", "Income", "Entertainment", "Education", "Healthcare", "Other"]);
const queryTables = new Set(["profiles", "wallets", "transactions", "contacts", "budgets", "recurring_payments", "notifications", "wallet_security"]);
const updateTables = new Set(["profiles", "contacts", "budgets", "recurring_payments", "notifications"]);
const deleteTables = new Set(["contacts", "budgets", "recurring_payments"]);

function now() { return new Date().toISOString(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function validEmailStyle(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validWalletId(value) { return /^DW-[A-Z0-9]{10}$/.test(String(value || "").trim().toUpperCase()); }
function validPin(value) { return /^\d{4}$/.test(String(value || "")); }
function validAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= maxAmount && Math.round(amount * 100) === amount * 100;
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
function ok(data = null) { return { data, error: null }; }
function fail(code, message) { return { data: null, error: { code, message } }; }

function sendJson(response, status, value, headers = {}) {
  if (response.headersSent || response.writableEnded) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error("Invalid JSON body."), { code: "INVALID_JSON", status: 400 }); }
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  const entries = header.split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return [part, ""];
    try { return [decodeURIComponent(part.slice(0, idx)), decodeURIComponent(part.slice(idx + 1))]; }
    catch { return [part.slice(0, idx), part.slice(idx + 1)]; }
  });
  return Object.fromEntries(entries);
}

function hashSessionToken(token) { return createHash("sha256").update(String(token)).digest("hex"); }
function sessionCookie(token) {
  const secure = cookieSecure ? "; Secure" : "";
  return `wallet_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure}`;
}
function clearedSessionCookie() {
  const secure = cookieSecure ? "; Secure" : "";
  return `wallet_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const { error } = await supabase.from("auth_sessions").insert({
    id: randomUUID(), token_hash: hashSessionToken(token), user_id: userId,
    created_at: now(), expires_at: new Date(Date.now() + sessionTtlMs).toISOString()
  });
  if (error) throw new Error(error.message);
  return token;
}

async function destroySession(request) {
  const token = parseCookies(request).wallet_session;
  if (!token) return;
  await supabase.from("auth_sessions").delete().eq("token_hash", hashSessionToken(token));
}

async function getSessionUser(request) {
  const token = parseCookies(request).wallet_session;
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const { data: session, error: sessionError } = await supabase
    .from("auth_sessions").select("user_id, expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (sessionError || !session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await supabase.from("auth_sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  const nextExpiry = new Date(Date.now() + sessionTtlMs).toISOString();
  await supabase.from("auth_sessions").update({ expires_at: nextExpiry }).eq("token_hash", tokenHash);
  const { data: user, error: userError } = await supabase.from("users").select("*").eq("id", session.user_id).maybeSingle();
  if (userError || !user) return null;
  return user;
}

async function verifySession(request) {
  const user = await getSessionUser(request);
  return user || null;
}

function tableScope(table, userId, query) {
  if (table === "profiles") return query.eq("id", userId);
  if (["wallets", "wallet_security", "budgets", "recurring_payments", "notifications"].includes(table)) return query.eq("user_id", userId);
  if (table === "contacts") return query.eq("owner_id", userId);
  if (table === "transactions") return query.or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  if (table === "users") return query.eq("id", userId);
  return query;
}

const filterColumns = {
  profiles: new Set(["id", "full_name", "email", "phone", "wallet_id"]),
  wallets: new Set(["user_id", "balance", "updated_at"]),
  transactions: new Set(["id", "reference_id", "status", "created_at", "sender_id", "receiver_id", "amount", "type", "category", "note", "sender_wallet_id", "receiver_wallet_id", "counterparty_wallet_id", "counterparty_name"]),
  contacts: new Set(["id", "owner_id", "contact_user_id", "wallet_id", "nickname", "favorite", "created_at"]),
  budgets: new Set(["id", "user_id", "month_start", "category", "amount", "created_at"]),
  recurring_payments: new Set(["id", "user_id", "title", "amount", "frequency", "category", "next_run_at", "active", "created_at"]),
  notifications: new Set(["id", "user_id", "title", "message", "type", "is_read", "created_at"]),
  wallet_security: new Set(["user_id", "failed_attempts", "locked", "updated_at"])
};

function matchesFilter(row, filter, allowedColumns) {
  if (!filter || typeof filter !== "object") return true;
  if (!allowedColumns?.has(filter.column)) return false;
  if (filter.op === "eq") return String(row[filter.column] ?? "") === String(filter.value ?? "");
  if (filter.op === "neq") return String(row[filter.column] ?? "") !== String(filter.value ?? "");
  if (filter.op === "contains") return String(row[filter.column] ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
  return false;
}

function applySort(rows, sorts = [], allowedColumns) {
  const output = [...rows];
  output.sort((a, b) => {
    for (const sort of sorts) {
      const column = String(sort.column || "");
      if (!allowedColumns?.has(column)) continue;
      const av = a[column] ?? "";
      const bv = b[column] ?? "";
      if (av === bv) continue;
      const result = av > bv ? 1 : -1;
      return sort.ascending === false ? -result : result;
    }
    return 0;
  });
  return output;
}

async function scopedRows(table, userId) {
  if (table === "users") {
    const { data, error } = await supabase.from("users").select("id,email,user_metadata,created_at").eq("id", userId);
    if (error) throw Object.assign(new Error(error.message), { code: "DATABASE_ERROR" });
    return data || [];
  }
  let query = tableScope(table, userId, supabase.from(table).select("*"));
  const { data, error } = await query;
  if (error) throw Object.assign(new Error(error.message), { code: "DATABASE_ERROR" });
  return data || [];
}

async function authSignup(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const fullName = cleanText(body.full_name, maxNameLength, { allowEmpty: false });
  const password = String(body.password || "");
  if (!validEmailStyle(email)) return sendJson(response, 400, fail("INVALID_EMAIL", "Use an email-style wallet login ID such as alex@wallet.local."));
  if (!fullName) return sendJson(response, 400, fail("INVALID_NAME", "Enter your name using 80 characters or fewer."));
  if (password.length < 8 || password.length > 128) return sendJson(response, 400, fail("INVALID_PASSWORD", "Password must be 8–128 characters."));

  try {
    const passwordHash = await hashSecret(password);
    const { data, error } = await supabase.rpc("create_wallet_account", {
      p_email: email, p_full_name: fullName, p_password_hash: passwordHash
    });
    if (error) {
      const duplicate = error.code === "23505" || /duplicate|already registered/i.test(error.message || "");
      return sendJson(response, duplicate ? 400 : 500, fail(duplicate ? "DUPLICATE_EMAIL" : "SIGNUP_FAILED", duplicate ? "This wallet login ID is already registered." : error.message));
    }
    const userId = data?.user_id;
    const { data: user, error: userError } = await supabase.from("users").select("id,email,user_metadata,created_at").eq("id", userId).single();
    if (userError) throw new Error(userError.message);
    const token = await createSession(userId);
    return sendJson(response, 200, ok({ user: publicUser(user), session: { user: publicUser(user) } }), { "Set-Cookie": sessionCookie(token) });
  } catch (error) {
    return sendJson(response, 500, fail("SIGNUP_FAILED", error.message || "Unable to create the wallet account."));
  }
}

async function authSignin(request, response) {
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!validEmailStyle(email) || !password) return sendJson(response, 400, fail("INVALID_CREDENTIALS", "Enter your wallet login ID and password."));
  try {
    const { data: user, error } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
    if (error) throw new Error(error.message);
    const check = user ? await verifySecret(password, user.password_hash) : { valid: false };
    if (!user || !check.valid) return sendJson(response, 401, fail("INVALID_CREDENTIALS", "Invalid wallet login ID or password."));
    if (check.legacy) await supabase.from("users").update({ password_hash: await hashSecret(password) }).eq("id", user.id);
    const token = await createSession(user.id);
    return sendJson(response, 200, ok({ user: publicUser(user), session: { user: publicUser(user) } }), { "Set-Cookie": sessionCookie(token) });
  } catch (error) {
    return sendJson(response, 500, fail("SIGNIN_FAILED", error.message || "Unable to sign in."));
  }
}

async function authSession(request, response) {
  const user = await verifySession(request);
  return sendJson(response, 200, ok({ session: user ? { user: publicUser(user) } : null }));
}

async function authSignout(request, response) {
  await destroySession(request);
  return sendJson(response, 200, ok({}), { "Set-Cookie": clearedSessionCookie() });
}

async function handleQuery(request, response) {
  const user = await verifySession(request);
  if (!user) return sendJson(response, 401, fail("AUTH_REQUIRED", "Please log in to use your wallet."));
  const body = await readBody(request);
  const table = String(body.table || "");
  if (!queryTables.has(table)) return sendJson(response, 400, fail("INVALID_TABLE", "That wallet data table is not available."));
  let rows;
  try {
    rows = await scopedRows(table, user.id);
    const allowedColumns = filterColumns[table];
    const filters = Array.isArray(body.filters) ? body.filters : [];
    const any = Array.isArray(body.any) ? body.any : [];
    if (filters.some(filter => !filterColumns[table]?.has(String(filter.column || "")))) return sendJson(response, 400, fail("INVALID_FILTER", "One of the requested filters is not allowed."));
    if (any.flat().some(filter => !filterColumns[table]?.has(String(filter?.column || "")))) return sendJson(response, 400, fail("INVALID_FILTER", "One of the requested filters is not allowed."));
    rows = rows.filter(row => filters.every(filter => matchesFilter(row, filter, allowedColumns)) && (!any.length || any.some(group => Array.isArray(group) && group.every(filter => matchesFilter(row, filter, allowedColumns)))));
    rows = applySort(rows, Array.isArray(body.sorts) ? body.sorts : [], allowedColumns);
    if (Number.isInteger(body.limit) && body.limit > 0) rows = rows.slice(0, body.limit);
    rows = rows.map(row => sanitizeRow(table, row));
    return sendJson(response, 200, ok(body.single ? rows[0] || null : rows));
  } finally {
    // Query filtering uses per-request allowlists; no shared mutable query state.
  }
}

function allowedInsert(table, row, userId) {
  const value = clone(row || {});
  if (table === "contacts") return { ...value, id: randomUUID(), owner_id: userId, created_at: now(), favorite: Boolean(value.favorite) };
  if (table === "budgets") return { ...value, id: randomUUID(), user_id: userId, created_at: now() };
  if (table === "recurring_payments") return { ...value, id: randomUUID(), user_id: userId, created_at: now(), active: value.active !== false };
  return null;
}

function permittedUpdate(table, values) {
  if (table === "profiles") return { full_name: cleanText(values.full_name, maxNameLength) ?? "", phone: cleanText(values.phone, maxPhoneLength) ?? "" };
  if (table === "contacts") return { nickname: cleanText(values.nickname, 40) ?? "", favorite: Boolean(values.favorite) };
  if (table === "budgets") return { amount: Number(values.amount), category: cleanText(values.category, 30, { allowEmpty: false }) };
  if (table === "recurring_payments") return { title: cleanText(values.title, 80, { allowEmpty: false }), amount: Number(values.amount), frequency: values.frequency, category: cleanText(values.category, 30, { allowEmpty: false }), active: values.active !== false, next_run_at: values.next_run_at };
  if (table === "notifications") return { is_read: Boolean(values.is_read) };
  return {};
}

async function handleMutation(request, response) {
  const user = await verifySession(request);
  if (!user) return sendJson(response, 401, fail("AUTH_REQUIRED", "Please log in to use your wallet."));
  const body = await readBody(request);
  const table = String(body.table || "");
  const action = String(body.action || "");
  try {
    if (action === "insert") {
      const rows = Array.isArray(body.rows) ? body.rows : [body.rows];
      if (!["contacts", "budgets", "recurring_payments"].includes(table)) return sendJson(response, 400, fail("MUTATION_NOT_ALLOWED", "This wallet table cannot be changed directly."));
      const created = [];
      for (const row of rows) {
        const entry = allowedInsert(table, row, user.id);
        if (table === "budgets" && (!validAmount(entry.amount) || !categories.has(entry.category) || entry.category === "Income")) return sendJson(response, 400, fail("INVALID_BUDGET", "Enter a valid budget amount and category."));
        if (table === "recurring_payments" && (!validAmount(entry.amount) || !["weekly", "monthly"].includes(entry.frequency) || !categories.has(entry.category))) return sendJson(response, 400, fail("INVALID_RECURRING", "Enter valid recurring payment details."));
        if (table === "contacts") {
          if (!validWalletId(entry.wallet_id)) return sendJson(response, 400, fail("INVALID_WALLET_ID", "Enter a valid wallet ID such as DW-XXXXXXXXXX."));
          const { data: found, error: lookupError } = await supabase.from("profiles").select("id,wallet_id,full_name").eq("wallet_id", String(entry.wallet_id).toUpperCase()).maybeSingle();
          if (lookupError) throw new Error(lookupError.message);
          if (!found || found.id === user.id) return sendJson(response, 400, fail("CONTACT_NOT_FOUND", "Choose another registered wallet as the contact."));
          entry.contact_user_id = found.id;
          entry.wallet_id = found.wallet_id;
          entry.nickname = cleanText(entry.nickname || found.full_name, 40, { allowEmpty: false }) || found.full_name;
        }
        const { data, error } = await supabase.from(table).insert(entry).select("*").single();
        if (error) throw new Error(error.message);
        created.push(sanitizeRow(table, data));
      }
      return sendJson(response, 200, ok(created.length === 1 ? created[0] : created));
    }

    if (action === "upsert") {
      if (table !== "budgets") return sendJson(response, 400, fail("MUTATION_NOT_ALLOWED", "Only budgets support upsert."));
      const row = body.row || {};
      const amount = Number(row.amount);
      const category = cleanText(row.category, 30, { allowEmpty: false });
      const monthStart = String(row.month_start || "");
      if (!validAmount(amount) || !categories.has(category) || category === "Income") return sendJson(response, 400, fail("INVALID_BUDGET", "Enter a valid budget amount and category."));
      if (!/^\d{4}-\d{2}-01$/.test(monthStart)) return sendJson(response, 400, fail("INVALID_MONTH", "Invalid budget month."));
      const entry = { id: row.id || randomUUID(), user_id: user.id, month_start: monthStart, category, amount };
      const { data, error } = await supabase.from("budgets").upsert(entry, { onConflict: "user_id,month_start,category" }).select("*").single();
      if (error) throw new Error(error.message);
      return sendJson(response, 200, ok(sanitizeRow(table, data)));
    }

    if (action === "update") {
      if (!updateTables.has(table)) return sendJson(response, 400, fail("MUTATION_NOT_ALLOWED", "That wallet table cannot be updated directly."));
      const filters = Array.isArray(body.filters) ? body.filters : [];
      if (filters.some(filter => !filterColumns[table]?.has(String(filter.column || "")))) return sendJson(response, 400, fail("INVALID_FILTER", "One of the requested filters is not allowed."));
      const allowedColumns = filterColumns[table];
      const rows = (await scopedRows(table, user.id)).filter(row => filters.every(filter => matchesFilter(row, filter, allowedColumns)));
      if (!rows.length) return sendJson(response, 200, ok([]));
      const values = permittedUpdate(table, body.values || {});
      if (table === "budgets" && (!validAmount(values.amount) || !categories.has(values.category) || values.category === "Income")) return sendJson(response, 400, fail("INVALID_BUDGET", "Invalid budget values."));
      if (table === "recurring_payments" && (!validAmount(values.amount) || !["weekly", "monthly"].includes(values.frequency) || !categories.has(values.category))) return sendJson(response, 400, fail("INVALID_RECURRING", "Invalid recurring payment values."));
      const idColumn = table === "profiles" ? "id" : table === "wallet_security" ? "user_id" : "id";
      const updated = [];
      for (const row of rows) {
        const { data, error } = await supabase.from(table).update(values).eq(idColumn, row[idColumn]).select("*").single();
        if (error) throw new Error(error.message);
        updated.push(sanitizeRow(table, data));
      }
      return sendJson(response, 200, ok(updated.length === 1 ? updated[0] : updated));
    }

    if (action === "delete") {
      if (!deleteTables.has(table)) return sendJson(response, 400, fail("MUTATION_NOT_ALLOWED", "That wallet table cannot be deleted directly."));
      const filters = Array.isArray(body.filters) ? body.filters : [];
      const allowedColumns = filterColumns[table];
      const rows = (await scopedRows(table, user.id)).filter(row => filters.every(filter => matchesFilter(row, filter, allowedColumns)));
      for (const row of rows) {
        const { error } = await supabase.from(table).delete().eq("id", row.id);
        if (error) throw new Error(error.message);
      }
      return sendJson(response, 200, ok({ deleted: rows.length }));
    }

    return sendJson(response, 400, fail("INVALID_ACTION", "Unsupported wallet data operation."));
  } catch (error) {
    return sendJson(response, 500, fail("DATA_WRITE_FAILED", error.message || "Unable to update wallet data."));
  }
}

async function loadUserWallet(userId) {
  const [{ data: wallet }, { data: profile }, { data: security }] = await Promise.all([
    supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("wallet_security").select("*").eq("user_id", userId).maybeSingle()
  ]);
  return { wallet, profile, security };
}

async function updateSecurity(userId, values) {
  const { data, error } = await supabase.from("wallet_security").update(values).eq("user_id", userId).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

async function getSecurity(userId) {
  const { data, error } = await supabase.from("wallet_security").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function verifyPin(userId, pin) {
  const security = await getSecurity(userId);
  if (!security) return { ok: false, code: "WALLET_NOT_READY", message: "Wallet security is not ready." };
  if (security.locked) return { ok: false, code: "PIN_LOCKED", message: "Wallet PIN is locked after 3 failed attempts. Reset it with your account password in Profile & Settings." };
  if (!validPin(pin)) return { ok: false, code: "INVALID_PIN", message: "Enter the 4-digit wallet PIN." };
  const check = await verifySecret(pin, security.pin_hash);
  if (check.valid) {
    const values = { failed_attempts: 0, updated_at: now() };
    if (check.legacy) values.pin_hash = await hashSecret(pin);
    await updateSecurity(userId, values);
    return { ok: true };
  }
  const failedAttempts = Number(security.failed_attempts || 0) + 1;
  const locked = failedAttempts >= pinAttempts;
  await updateSecurity(userId, { failed_attempts: failedAttempts, locked, updated_at: now() });
  return {
    ok: false, code: locked ? "PIN_LOCKED" : "INVALID_PIN",
    message: locked ? "Wallet PIN is now locked after 3 failed attempts. Reset it with your account password." : "Incorrect PIN.",
    remaining_attempts: Math.max(0, pinAttempts - failedAttempts)
  };
}

async function handleRpc(request, response) {
  const user = await verifySession(request);
  if (!user) return sendJson(response, 401, fail("AUTH_REQUIRED", "Please log in to use your wallet."));
  const body = await readBody(request);
  const name = String(body.name || "");
  const p = body.params || {};
  try {
    const { wallet, profile, security } = await loadUserWallet(user.id);
    if (!["lookup_wallet", "delete_account", "reset_user_data"].includes(name) && (!wallet || !profile || !security)) return sendJson(response, 400, fail("WALLET_NOT_READY", "Your wallet is not ready. Refresh and try again."));

    if (name === "get_wallet_status") {
      return sendJson(response, 200, ok({ has_pin: Boolean(security?.pin_hash), locked: Boolean(security?.locked), failed_attempts: Number(security?.failed_attempts || 0), max_attempts: pinAttempts }));
    }

    if (name === "set_wallet_pin") {
      if (security.pin_hash) return sendJson(response, 400, fail("PIN_EXISTS", "A wallet PIN is already configured. Use Change PIN instead."));
      if (!validPin(p.p_pin)) return sendJson(response, 400, fail("INVALID_PIN", "PIN must be exactly 4 digits."));
      await updateSecurity(user.id, { pin_hash: await hashSecret(p.p_pin), failed_attempts: 0, locked: false, updated_at: now() });
      return sendJson(response, 200, ok({ success: true }));
    }

    if (name === "change_wallet_pin") {
      if (!validPin(p.p_old_pin) || !validPin(p.p_pin)) return sendJson(response, 400, fail("INVALID_PIN", "Enter both PINs as exactly 4 digits."));
      const check = await verifySecret(p.p_old_pin, security.pin_hash);
      if (!check.valid) return sendJson(response, 200, ok({ success: false, message: "Current PIN is incorrect." }));
      await updateSecurity(user.id, { pin_hash: await hashSecret(p.p_pin), failed_attempts: 0, locked: false, updated_at: now() });
      return sendJson(response, 200, ok({ success: true }));
    }

    if (name === "reset_wallet_pin_with_password") {
      if (!security.locked) return sendJson(response, 400, fail("PIN_NOT_LOCKED", "Your PIN does not need recovery."));
      if (!validPin(p.p_new_pin)) return sendJson(response, 400, fail("INVALID_PIN", "New PIN must be exactly 4 digits."));
      const check = await verifySecret(p.password, user.password_hash);
      if (!check.valid) return sendJson(response, 400, fail("INVALID_PASSWORD", "Account password is incorrect."));
      await updateSecurity(user.id, { pin_hash: await hashSecret(p.p_new_pin), failed_attempts: 0, locked: false, updated_at: now() });
      return sendJson(response, 200, ok({ success: true }));
    }

    if (name === "verify_wallet_pin") {
      const result = await verifyPin(user.id, p.p_pin);
      if (!result.ok) return sendJson(response, 200, ok({ success: false, locked: result.code === "PIN_LOCKED", message: result.message, remaining_attempts: result.remaining_attempts }));
      return sendJson(response, 200, ok({ success: true, remaining_attempts: pinAttempts }));
    }

    if (["deposit_wallet", "withdraw_wallet", "transfer_wallet", "run_recurring_payment"].includes(name)) {
      if (!security?.pin_hash) return sendJson(response, 400, fail("PIN_REQUIRED", "Set your 4-digit wallet PIN before making transactions."));
      const pinResult = await verifyPin(user.id, p.p_pin);
      if (!pinResult.ok) return sendJson(response, 200, ok({ success: false, locked: pinResult.code === "PIN_LOCKED", message: pinResult.message, remaining_attempts: pinResult.remaining_attempts }));
    }

    const referenceId = `TXN-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

    if (name === "deposit_wallet") {
      if (!validAmount(p.p_amount)) return sendJson(response, 400, fail("INVALID_AMOUNT", "Enter a valid amount between ₹0.01 and ₹1,000,000,000."));
      const category = "Income";
      const { data, error } = await supabase.rpc("wallet_deposit", { p_user_id: user.id, p_amount: Number(p.p_amount), p_category: category, p_note: cleanText(p.p_note, maxNoteLength) || null, p_reference_id: referenceId });
      if (error) throw new Error(error.message);
      return sendJson(response, 200, ok(data));
    }

    if (name === "withdraw_wallet") {
      if (!validAmount(p.p_amount)) return sendJson(response, 400, fail("INVALID_AMOUNT", "Enter a valid amount between ₹0.01 and ₹1,000,000,000."));
      const category = categories.has(p.p_category) && p.p_category !== "Income" ? p.p_category : "Other";
      const { data, error } = await supabase.rpc("wallet_withdraw", { p_user_id: user.id, p_amount: Number(p.p_amount), p_category: category, p_note: cleanText(p.p_note, maxNoteLength) || null, p_reference_id: referenceId });
      if (error) throw new Error(error.message);
      return sendJson(response, 200, ok(data));
    }

    if (name === "transfer_wallet") {
      const recipient = String(p.p_receiver_wallet_id || "").trim().toUpperCase();
      if (!validWalletId(recipient)) return sendJson(response, 400, fail("INVALID_WALLET_ID", "Wallet ID should look like DW-XXXXXXXXXX."));
      if (!validAmount(p.p_amount)) return sendJson(response, 400, fail("INVALID_AMOUNT", "Enter a valid transfer amount."));
      const category = categories.has(p.p_category) && p.p_category !== "Income" ? p.p_category : "Other";
      const { data, error } = await supabase.rpc("wallet_transfer", { p_user_id: user.id, p_receiver_wallet_id: recipient, p_amount: Number(p.p_amount), p_category: category, p_note: cleanText(p.p_note, maxNoteLength) || null, p_reference_id: referenceId });
      if (error) {
        const codeMap = { INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE", SELF_TRANSFER: "SELF_TRANSFER", RECIPIENT_NOT_FOUND: "RECIPIENT_NOT_FOUND", RECIPIENT_WALLET_MISSING: "RECIPIENT_WALLET_MISSING" };
        const code = codeMap[error.message] || (error.message?.includes("Insufficient") ? "INSUFFICIENT_BALANCE" : "TRANSFER_FAILED");
        return sendJson(response, 400, fail(code, error.message));
      }
      return sendJson(response, 200, ok(data));
    }

    if (name === "lookup_wallet") {
      const walletId = String(p.p_wallet_id || "").trim().toUpperCase();
      if (!validWalletId(walletId)) return sendJson(response, 400, fail("INVALID_WALLET_ID", "Enter a valid wallet ID such as DW-XXXXXXXXXX."));
      const { data: found, error } = await supabase.from("profiles").select("id,wallet_id,full_name").eq("wallet_id", walletId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!found) return sendJson(response, 400, fail("WALLET_NOT_FOUND", "Wallet not found."));
      return sendJson(response, 200, ok({ user_id: found.id, wallet_id: found.wallet_id, full_name: found.full_name }));
    }

    if (name === "run_recurring_payment") {
      const { data, error } = await supabase.rpc("wallet_run_recurring", { p_user_id: user.id, p_recurring_id: p.p_recurring_id, p_reference_id: referenceId });
      if (error) throw new Error(error.message);
      return sendJson(response, 200, ok(data));
    }

    if (name === "reset_user_data") {
      const check = await verifySecret(p.password, user.password_hash);
      if (!check.valid) return sendJson(response, 400, fail("INVALID_PASSWORD", "Account password is incorrect."));
      const { error } = await supabase.rpc("reset_wallet_simulation", { p_user_id: user.id });
      if (error) throw new Error(error.message);
      return sendJson(response, 200, ok({ success: true }));
    }

    if (name === "delete_account") {
      const check = await verifySecret(p.password, user.password_hash);
      if (!check.valid) return sendJson(response, 400, fail("INVALID_PASSWORD", "Account password is incorrect."));
      const { error } = await supabase.rpc("delete_wallet_account", { p_user_id: user.id });
      if (error) throw new Error(error.message);
      await supabase.from("auth_sessions").delete().eq("user_id", user.id);
      return sendJson(response, 200, ok({ success: true }), { "Set-Cookie": clearedSessionCookie() });
    }

    return sendJson(response, 400, fail("UNSUPPORTED_RPC", `Unsupported wallet operation: ${name}`));
  } catch (error) {
    console.error("RPC error:", error);
    return sendJson(response, 500, fail("RPC_FAILED", error.message || "Unable to complete the wallet operation."));
  }
}

async function resetAllPublicData(request, response) {
  const user = await verifySession(request);
  if (!user) return sendJson(response, 401, fail("AUTH_REQUIRED", "Please log in."));
  return sendJson(response, 403, fail("FORBIDDEN", "Use reset_supabase_data.py for a full database reset."));
}

function affectedUserIds(payload) {
  const ids = new Set();
  const oldRow = payload.old || {};
  const newRow = payload.new || {};
  const table = payload.table;
  const add = value => { if (value) ids.add(String(value)); };
  if (table === "profiles" || table === "users") { add(oldRow.id); add(newRow.id); }
  else if (["wallets", "wallet_security", "budgets", "recurring_payments", "notifications"].includes(table)) { add(oldRow.user_id); add(newRow.user_id); }
  else if (table === "contacts") { add(oldRow.owner_id); add(newRow.owner_id); add(oldRow.contact_user_id); add(newRow.contact_user_id); }
  else if (table === "transactions") { add(oldRow.sender_id); add(newRow.sender_id); add(oldRow.receiver_id); add(newRow.receiver_id); }
  return ids;
}

function sendRealtimeEvent(userId, payload) {
  const clients = realtimeClients.get(userId);
  if (!clients) return;
  const data = JSON.stringify({ table: payload.table, event: payload.eventType, at: Date.now() });
  for (const response of clients) {
    try { response.write(`event: wallet-change\ndata: ${data}\n\n`); }
    catch { clients.delete(response); }
  }
}

function handleRealtimePayload(payload) {
  for (const userId of affectedUserIds(payload)) sendRealtimeEvent(userId, payload);
}

async function handleRealtime(request, response) {
  const user = await verifySession(request);
  if (!user) return sendJson(response, 401, fail("AUTH_REQUIRED", "Please log in to use wallet realtime updates."));
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(`event: connected\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  if (!realtimeClients.has(user.id)) realtimeClients.set(user.id, new Set());
  realtimeClients.get(user.id).add(response);
  const keepAlive = setInterval(() => {
    try { response.write(`: keepalive ${Date.now()}\n\n`); }
    catch { clearInterval(keepAlive); }
  }, 20000);
  request.on("close", () => {
    clearInterval(keepAlive);
    const clients = realtimeClients.get(user.id);
    clients?.delete(response);
    if (clients && clients.size === 0) realtimeClients.delete(user.id);
  });
}

async function startRealtime() {
  realtimeChannel = supabase.channel("wallet-db-changes");
  for (const table of realtimeTables) {
    realtimeChannel = realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table }, payload => handleRealtimePayload(payload));
  }
  realtimeChannel.subscribe((status, error) => {
    realtimeStatus = String(status || "unknown");
    if (status === "SUBSCRIBED") console.log("Supabase Realtime connected.");
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") console.error("Supabase Realtime status:", status, error?.message || "");
  });
}

async function health(request, response) {
  const { error } = await supabase.from("users").select("id", { head: true, count: "exact" });
  if (error) return sendJson(response, 503, { ok: false, database: false });
  return sendJson(response, 200, { ok: true, database: true, realtime: realtimeStatus === "SUBSCRIBED", realtime_status: realtimeStatus });
}

function hashLegacy(value) { return createHash("sha256").update(String(value)).digest("hex"); }
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

await access(path.join(root, "package.json"));
// const vite = await createViteServer({ server: { middlewareMode: true, hmr: false, cors: false }, appType: "mpa" });
const allowedHosts = [
  "localhost",
  process.env.RENDER_EXTERNAL_HOSTNAME
].filter(Boolean);

const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: false,
    allowedHosts
  },
  appType: "mpa"
});
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/health" && request.method === "GET") return await health(request, response);
    if (url.pathname === "/api/auth/session" && request.method === "GET") return await authSession(request, response);
    if (url.pathname === "/api/auth/signup" && request.method === "POST") return await authSignup(request, response);
    if (url.pathname === "/api/auth/signin" && request.method === "POST") return await authSignin(request, response);
    if (url.pathname === "/api/auth/signout" && request.method === "POST") return await authSignout(request, response);
    if (url.pathname === "/api/data/query" && request.method === "POST") return await handleQuery(request, response);
    if (url.pathname === "/api/data/mutate" && request.method === "POST") return await handleMutation(request, response);
    if (url.pathname === "/api/rpc" && request.method === "POST") return await handleRpc(request, response);
    if (url.pathname === "/api/realtime" && request.method === "GET") return await handleRealtime(request, response);

    vite.middlewares(request, response, () => {
      if (response.headersSent || response.writableEnded) return;
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });
  } catch (error) {
    console.error(error);
    if (response.headersSent || response.writableEnded) return;
    sendJson(response, Number(error.status) || 500, fail(error.code || "SERVER_ERROR", error.message || "Unable to access the wallet."));
  }
});

server.listen(port, "0.0.0.0", async () => {
  console.log(`Digital Wallet running on port ${port}`);
  console.log("Storage: Supabase PostgreSQL (data.json is migration/backup data only).");
  console.log("Authentication: dummy email identifier + password (no email delivery).");
  try { await startRealtime(); }
  catch (error) { console.error("Unable to start Supabase Realtime:", error.message); }
});

setInterval(async () => {
  try { await supabase.from("auth_sessions").delete().lt("expires_at", new Date().toISOString()); }
  catch (error) { console.error("Session cleanup failed:", error.message); }
}, 60 * 60 * 1000).unref();
