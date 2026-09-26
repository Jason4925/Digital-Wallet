import { db } from "./data-api.js";
import QRCode from "qrcode";
import { Html5QrcodeScanner } from "html5-qrcode";
import Chart from "chart.js/auto";

const CATEGORIES = ["Food", "Shopping", "Travel", "Bills", "Income", "Entertainment", "Education", "Healthcare", "Other"];
const MAX_AMOUNT = 1_000_000_000;
const MAX_NOTE_LENGTH = 120;
const state = {
  user: null,
  profile: null,
  wallet: null,
  transactions: [],
  contacts: [],
  budgets: [],
  recurring: [],
  notifications: [],
  activeSection: "dashboard",
  transferDraft: null,
  cashOperation: null,
  pendingTransaction: null,
  onboardingPin: null,
  budgetMonth: todayMonth(),
  scanner: null,
  walletUnlocked: false,
  pinStatus: null,
  realtimeSource: null,
  realtimeRefreshTimer: null,
  realtimeLoading: false,
  charts: {}
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[m]));
}

function initials(name = "User") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("") || "U";
}

function toast(text, type = "success") {
  const container = $("#toast-container");
  if (!container) return;
  const box = document.createElement("div");
  box.className = "toast";
  box.innerHTML = `<strong>${type === "error" ? "Error" : "Done"}</strong><div>${escapeHtml(text)}</div>`;
  container.appendChild(box);
  setTimeout(() => box.remove(), 3600);
}

function formMessage(id, text, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `form-message ${type}`;
}

function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function dateText(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function counterpartyWallet(tx) {
  if (tx.type === "transfer") return tx.sender_id === state.user.id ? (tx.receiver_wallet_id || tx.counterparty_wallet_id) : (tx.sender_wallet_id || tx.counterparty_wallet_id);
  return tx.counterparty_wallet_id || tx.sender_wallet_id || tx.receiver_wallet_id || "";
}

function personLabel(tx) {
  if (tx.type === "deposit") return "Wallet deposit";
  if (tx.type === "withdrawal") return "Cash withdrawal";
  if (tx.type === "recurring_payment") return tx.note || "Recurring payment";
  if (tx.type === "transfer") {
    return tx.sender_id === state.user.id
      ? (tx.receiver_name || tx.counterparty_name || tx.receiver_wallet_id || "Sent transfer")
      : (tx.sender_name || tx.sender_wallet_id || "Received transfer");
  }
  return tx.counterparty_name || counterpartyWallet(tx) || "Transaction";
}

function isIncome(tx) {
  return tx.receiver_id === state.user.id && tx.type !== "withdrawal";
}

function isExpense(tx) {
  return tx.sender_id === state.user.id && tx.type !== "deposit";
}

function isValidAmount(value, allowEmpty = false) {
  if (allowEmpty && (value === "" || value == null)) return true;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= MAX_AMOUNT && Math.round(amount * 100) === amount * 100;
}

function isValidWalletId(value) {
  return /^DW-[A-Z0-9]{10}$/.test(String(value || "").trim().toUpperCase());
}

function isValidPin(value) {
  return /^\d{4}$/.test(String(value || ""));
}

function friendlyError(error) {
  const map = {
    AUTH_REQUIRED: "Your session has expired. Please sign in again.",
    INVALID_AMOUNT: "Enter a valid positive amount.",
    INSUFFICIENT_BALANCE: "Insufficient simulated balance.",
    INVALID_WALLET_ID: "Use a wallet ID in the format DW-XXXXXXXXXX.",
    RECIPIENT_NOT_FOUND: "Recipient wallet was not found.",
    SELF_TRANSFER: "You cannot transfer money to your own wallet.",
    PIN_REQUIRED: "Set a 4-digit wallet PIN before making transactions.",
    PIN_LOCKED: "Wallet PIN is locked. Reset it from Profile & Settings using your account password.",
    INVALID_PIN: "Incorrect wallet PIN.",
    INVALID_PASSWORD: "Account password is incorrect.",
    MUTATION_NOT_ALLOWED: "That action is not available from the wallet interface.",
    WALLET_NOT_READY: "Wallet data is not ready. Refresh the page and try again."
  };
  return map[error?.code] || error?.message || "The operation could not be completed.";
}

function setButtonBusy(button, busy, busyText = "Processing…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText ??= button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
  }
}

function setAppLoading(loading) {
  document.body.classList.toggle("is-loading", loading);
  $(".app-main")?.setAttribute("aria-busy", String(loading));
  $("#app-status")?.classList.toggle("hidden", !loading);
  if (loading) $("#app-status").textContent = "Refreshing wallet data…";
}

function showAppError(message = "We could not refresh your wallet data.") {
  const status = $("#app-status");
  if (!status) return;
  status.className = "app-status error";
  status.innerHTML = `<span>${escapeHtml(message)}</span><button class="text-btn" id="retry-load">Retry</button>`;
  $("#retry-load")?.addEventListener("click", () => loadAll());
}

function emptyState(icon, title, text, buttonHtml = "") {
  return `<div class="empty-content"><div class="empty-icon">${icon}</div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p>${buttonHtml}</div>`;
}

function refreshIcons() {
  window.lucide?.createIcons();
}

function setupPasswordToggles() {
  $$('[data-toggle-password]').forEach(button => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      const label = input.inputMode === "numeric" ? "PIN" : "password";
      button.setAttribute("aria-label", `${visible ? "Show" : "Hide"} ${label}`);
      button.title = `${visible ? "Show" : "Hide"} ${label}`;
      button.innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}" aria-hidden="true"></i>`;
      refreshIcons();
    });
  });
}

async function init() {
  const { data, error } = await db.auth.getSession();
  if (error || !data?.session) {
    location.href = "/login.html?expired=1";
    return;
  }
  state.user = data.session.user;
  setupNavigation();
  setupForms();
  setupPasswordToggles();
  setupTheme();
  setupRealtime();
  await loadAll();
  await ensureWalletPin();
  if (state.profile) await renderMyQr();
}

function setupNavigation() {
  $$(".nav-item[data-section]").forEach(btn => btn.addEventListener("click", () => switchSection(btn.dataset.section)));
  $$('[data-section-jump]').forEach(btn => btn.addEventListener("click", () => switchSection(btn.dataset.sectionJump)));
  history.pushState({ walletPage: true, section: "dashboard" }, "", location.href);
  history.pushState({ walletPage: true, section: "dashboard", guard: true }, "", location.href);
  window.addEventListener("popstate", handleHistoryNavigation);
  $("#open-sidebar")?.addEventListener("click", () => $("#sidebar")?.classList.add("open"));
  $("#close-sidebar")?.addEventListener("click", () => $("#sidebar")?.classList.remove("open"));
  $("#sidebar-overlay")?.addEventListener("click", () => $("#sidebar")?.classList.remove("open"));
  $("#logout-btn")?.addEventListener("click", signOut);
  $$(".modal-close, [data-close-modal]").forEach(btn => btn.addEventListener("click", () => {
    const modal = btn.closest(".modal-backdrop");
    modal?.classList.add("hidden");
  }));
  $$(".nav-item[data-section]").forEach(button => button.setAttribute("aria-current", button.classList.contains("active") ? "page" : "false"));
}

function handleHistoryNavigation(event) {
  const section = event.state?.walletPage ? event.state.section : "dashboard";
  switchSection(section, { updateHistory: false });
  if (section === "dashboard") {
    history.pushState({ walletPage: true, section: "dashboard", guard: true }, "", location.href);
  }
}

function switchSection(section, { updateHistory = true } = {}) {
  if (updateHistory) {
    if (section === "dashboard") {
      history.replaceState({ walletPage: true, section: "dashboard" }, "", location.href);
      history.pushState({ walletPage: true, section: "dashboard", guard: true }, "", location.href);
    } else {
      history.replaceState({ walletPage: true, section }, "", location.href);
    }
  }
  state.activeSection = section;
  $$(".nav-item[data-section]").forEach(button => {
    const active = button.dataset.section === section;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  $$(".view-section").forEach(view => view.classList.toggle("active", view.id === `section-${section}`));
  const titles = {
    dashboard: ["MY WALLET", "Dashboard"], send: ["WALLET OPERATION", "Send Money"], receive: ["RECEIVE", "My QR & wallet ID"],
    scan: ["QR PAYMENT", "Scan a payment QR"], transactions: ["HISTORY", "Transactions"], analytics: ["INSIGHTS", "Analytics & reports"],
    budget: ["PLANNING", "Budgets"], contacts: ["RECIPIENTS", "Contacts"], recurring: ["AUTOMATION SIMULATION", "Recurring payments"],
    notifications: ["UPDATES", "Notifications"], profile: ["ACCOUNT", "Profile & settings"]
  };
  const [eyebrow, title] = titles[section] || titles.dashboard;
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").textContent = title;
  $("#sidebar")?.classList.remove("open");
  if (section === "scan") startScanner();
  else if (state.scanner) stopScanner();
}

function setupRealtime() {
  if (!window.EventSource || state.realtimeSource) return;
  const source = new EventSource("/api/realtime", { withCredentials: true });
  state.realtimeSource = source;

  source.addEventListener("wallet-change", () => {
    clearTimeout(state.realtimeRefreshTimer);
    state.realtimeRefreshTimer = setTimeout(async () => {
      if (state.realtimeLoading) return;
      state.realtimeLoading = true;
      try {
        await loadAll();
        if (state.profile) await renderMyQr();
      } finally {
        state.realtimeLoading = false;
      }
    }, 120);
  });

  source.addEventListener("connected", () => {
    console.info("Wallet realtime connected.");
  });

  source.onerror = () => {
    // EventSource automatically reconnects. No credentials are stored client-side.
    console.warn("Wallet realtime connection interrupted; browser will reconnect automatically.");
  };
}

function closeRealtime() {
  clearTimeout(state.realtimeRefreshTimer);
  state.realtimeSource?.close();
  state.realtimeSource = null;
}

async function loadAll() {
  setAppLoading(true);
  let responses;
  try {
    responses = await Promise.all([
    db.get("profiles", { filters: [{ column: "id", op: "eq", value: state.user.id }], single: true }),
    db.get("wallets", { filters: [{ column: "user_id", op: "eq", value: state.user.id }], single: true }),
    db.get("transactions", { any: [[{ column: "sender_id", op: "eq", value: state.user.id }], [{ column: "receiver_id", op: "eq", value: state.user.id }]], sorts: [{ column: "created_at", ascending: false }] }),
    db.get("contacts", { filters: [{ column: "owner_id", op: "eq", value: state.user.id }], sorts: [{ column: "favorite", ascending: false }, { column: "created_at", ascending: false }] }),
    db.get("budgets", { filters: [{ column: "user_id", op: "eq", value: state.user.id }, { column: "month_start", op: "eq", value: state.budgetMonth }] }),
    db.get("recurring_payments", { filters: [{ column: "user_id", op: "eq", value: state.user.id }], sorts: [{ column: "created_at", ascending: false }] }),
    db.get("notifications", { filters: [{ column: "user_id", op: "eq", value: state.user.id }], sorts: [{ column: "created_at", ascending: false }], limit: 100 })
    ]);
  } catch (error) {
    console.error(error);
    setAppLoading(false);
    showAppError();
    return;
  }

  const [profileRes, walletRes, transactionsRes, contactsRes, budgetsRes, recurringRes, notificationsRes] = responses;
  const failedResponse = responses.find(response => response.error && response.error.code !== "AUTH_REQUIRED");
  if (failedResponse) {
    setAppLoading(false);
    showAppError(friendlyError(failedResponse.error));
    return;
  }

  for (const response of [profileRes, walletRes, transactionsRes, contactsRes, budgetsRes, recurringRes, notificationsRes]) {
    if (response.error?.code === "AUTH_REQUIRED") {
      location.href = "/login.html?expired=1";
      return;
    }
  }

  state.profile = profileRes.data;
  state.wallet = walletRes.data;
  state.transactions = transactionsRes.data || [];
  state.contacts = contactsRes.data || [];
  state.budgets = budgetsRes.data || [];
  state.recurring = recurringRes.data || [];
  state.notifications = notificationsRes.data || [];

  if (!state.profile || !state.wallet) {
    toast("Your wallet profile is not ready. Refresh the page and try again.", "error");
    setAppLoading(false);
    return;
  }

  hydrateIdentity();
  renderDashboard();
  renderTransactions();
  renderContacts();
  renderBudgets();
  renderRecurring();
  renderNotifications();
  renderAnalytics();
  refreshIcons();
  await loadPinStatus();
  $("#app-status")?.classList.add("hidden");
  setAppLoading(false);
}

function hydrateIdentity() {
  const name = state.profile.full_name || state.profile.username || "User";
  const init = initials(name);
  $("#sidebar-avatar").textContent = init;
  $("#header-avatar").textContent = init;
  $("#sidebar-name").textContent = name;
  $("#header-name").textContent = name;
  $("#sidebar-wallet-id").textContent = state.profile.wallet_id;
  $("#dashboard-wallet-id").textContent = state.profile.wallet_id;
  $("#receive-wallet-id").textContent = state.profile.wallet_id;
  $("#receive-name").textContent = name;
  $("#profile-name").value = state.profile.full_name || "";
  $("#profile-phone").value = state.profile.phone || "";
  $("#profile-wallet-id").value = state.profile.wallet_id || "";
}

function setupForms() {
  populateCategorySelect($("#transfer-category"));
  populateCategorySelect($("#budget-category"));
  populateCategorySelect($("#recurring-category"));
  populateCategorySelect($("#cash-category"));
  $("#budget-month").value = state.budgetMonth.slice(0, 7);
  const categoryFilter = $("#transaction-category-filter");
  CATEGORIES.forEach(category => categoryFilter.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`));

  $("#copy-wallet-id")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.profile.wallet_id);
      toast("Wallet ID copied.");
    } catch {
      toast("Clipboard access is unavailable in this browser.", "error");
    }
  });
  $("#copy-receive-wallet")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.profile.wallet_id);
      toast("Wallet ID copied.");
    } catch {
      toast("Clipboard access is unavailable in this browser.", "error");
    }
  });
  $("#deposit-btn")?.addEventListener("click", () => openCashModal("deposit"));
  $("#withdraw-btn")?.addEventListener("click", () => openCashModal("withdrawal"));
  $("#cash-form")?.addEventListener("submit", executeCashOperation);
  $("#transaction-pin-form")?.addEventListener("submit", authorizeTransaction);
  $("#unlock-form")?.addEventListener("submit", unlockWallet);
  $("#transfer-form")?.addEventListener("submit", prepareTransfer);
  $("#confirm-transfer")?.addEventListener("click", moveTransferToPin);
  $("#request-form")?.addEventListener("submit", generateRequestQr);
  $("#download-qr")?.addEventListener("click", downloadMyQr);
  $("#share-qr")?.addEventListener("click", shareQr);
  $("#stop-scanner")?.addEventListener("click", stopScanner);
  $("#parse-qr-btn")?.addEventListener("click", parseQrInput);
  $("#transaction-search")?.addEventListener("input", renderTransactions);
  $("#transaction-filter")?.addEventListener("change", renderTransactions);
  $("#transaction-category-filter")?.addEventListener("change", renderTransactions);
  $("#transaction-sort")?.addEventListener("change", renderTransactions);
  $("#transaction-from")?.addEventListener("change", renderTransactions);
  $("#transaction-to")?.addEventListener("change", renderTransactions);
  $("#notification-filter")?.addEventListener("change", renderNotifications);
  $("#budget-month")?.addEventListener("change", async event => {
    const value = event.target.value;
    if (!value) return;
    state.budgetMonth = `${value}-01`;
    await loadAll();
  });
  $("#export-transactions")?.addEventListener("click", exportTransactionsCsv);
  $("#budget-form")?.addEventListener("submit", saveBudget);
  $("#contact-form")?.addEventListener("submit", saveContact);
  $("#recurring-form")?.addEventListener("submit", saveRecurring);
  $("#mark-all-read")?.addEventListener("click", markAllNotificationsRead);
  $("#profile-form")?.addEventListener("submit", saveProfile);
  $("#pin-form")?.addEventListener("submit", savePin);
  $("#pin-recovery-form")?.addEventListener("submit", recoverPin);
  $("#theme-toggle")?.addEventListener("click", toggleTheme);
  $("#signout-everywhere")?.addEventListener("click", signOut);
  $("#print-receipt")?.addEventListener("click", () => window.print());
  $("#reset-simulation-btn")?.addEventListener("click", () => $("#reset-simulation-modal")?.classList.remove("hidden"));
  $("#delete-account-btn")?.addEventListener("click", () => $("#delete-account-modal")?.classList.remove("hidden"));
  $("#reset-simulation-form")?.addEventListener("submit", resetSimulation);
  $("#delete-account-form")?.addEventListener("submit", deleteAccount);
  $("#onboarding-profile-form")?.addEventListener("submit", completeOnboardingProfile);
  $("#onboarding-pin-form")?.addEventListener("submit", completeOnboardingPin);
  $("#onboarding-balance-form")?.addEventListener("submit", completeOnboardingBalance);
}

function populateCategorySelect(select) {
  if (!select) return;
  select.innerHTML = CATEGORIES.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
}

function renderDashboard() {
  $("#balance-value").textContent = money(state.wallet?.balance);
  const income = state.transactions.filter(isIncome).reduce((sum, tx) => sum + Number(tx.amount), 0);
  const expense = state.transactions.filter(isExpense).reduce((sum, tx) => sum + Number(tx.amount), 0);
  $("#income-value").textContent = money(income);
  $("#expense-value").textContent = money(expense);
  $("#transaction-count").textContent = state.transactions.length;

  const recent = state.transactions.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  const recentEl = $("#recent-transactions");
  recentEl.className = recent.length ? "transaction-list" : "transaction-list empty-state";
  recentEl.innerHTML = recent.length ? recent.map(transactionRowHtml).join("") : emptyState('<i data-lucide="inbox"></i>', "No transactions yet", "Your simulated wallet activity will appear here after your first transaction.", `<button class="btn btn-primary btn-sm" data-section-jump="send">Send money</button>`);
  $$('[data-tx]', recentEl).forEach(button => button.addEventListener("click", () => showReceipt(button.dataset.tx)));
  $$('[data-section-jump]', recentEl).forEach(button => button.addEventListener("click", () => switchSection(button.dataset.sectionJump)));
  renderMiniCategoryChart();
}

function transactionStatusClass(status) {
  return String(status || "completed").toLowerCase().replace(/[^a-z-]/g, "-");
}

function transactionRowHtml(tx) {
  const incoming = isIncome(tx);
  const label = personLabel(tx);
  const sign = incoming ? "+" : "-";
  return `<div class="transaction-row">
    <div class="tx-left"><span class="avatar">${escapeHtml(initials(label))}</span><div class="tx-main"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(tx.category || "Other")} · ${escapeHtml(dateText(tx.created_at))} · ${escapeHtml(tx.reference_id || tx.id.slice(0, 8))}</small></div></div>
    <div class="tx-amount ${incoming ? "income" : "expense"}">${sign}${money(tx.amount)}</div>
    <button class="table-action" data-tx="${escapeHtml(tx.id)}">View</button>
  </div>`;
}

function filteredTransactions() {
  let list = [...state.transactions];
  const search = $("#transaction-search")?.value.trim().toLowerCase() || "";
  const kind = $("#transaction-filter")?.value || "all";
  const category = $("#transaction-category-filter")?.value || "all";
  const sort = $("#transaction-sort")?.value || "newest";
  const from = $("#transaction-from")?.value || "";
  const to = $("#transaction-to")?.value || "";

  if (search) {
    list = list.filter(tx => [tx.id, tx.reference_id, tx.note, counterpartyWallet(tx), tx.sender_wallet_id, tx.receiver_wallet_id, tx.counterparty_name, tx.sender_name, tx.receiver_name, tx.category, tx.type]
      .some(value => String(value || "").toLowerCase().includes(search)));
  }
  if (kind === "income") list = list.filter(isIncome);
  if (kind === "expense") list = list.filter(isExpense);
  if (category !== "all") list = list.filter(tx => tx.category === category);
  if (from) list = list.filter(tx => String(tx.created_at).slice(0, 10) >= from);
  if (to) list = list.filter(tx => String(tx.created_at).slice(0, 10) <= to);

  list.sort((a, b) => {
    if (sort === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    if (sort === "amount-desc") return Number(b.amount) - Number(a.amount);
    if (sort === "amount-asc") return Number(a.amount) - Number(b.amount);
    return new Date(b.created_at) - new Date(a.created_at);
  });
  return list;
}

function renderTransactions() {
  const from = $("#transaction-from")?.value || "";
  const to = $("#transaction-to")?.value || "";
  const container = $("#all-transactions");
  if (from && to && from > to) {
    container.innerHTML = `<div class="empty-state">Start date cannot be after the end date.</div>`;
    return;
  }
  const list = filteredTransactions();
  if (!list.length) {
    container.innerHTML = emptyState('<i data-lucide="search-x"></i>', "No matching transactions", "Change the filters or date range to see more activity.");
    return;
  }
  container.innerHTML = `<table class="transaction-table"><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Counterparty</th><th>Category</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(tx => {
      const incoming = isIncome(tx);
      return `<tr><td data-label="Date">${escapeHtml(dateText(tx.created_at))}</td><td data-label="Reference"><code>${escapeHtml(tx.reference_id || tx.id.slice(0, 8))}</code></td><td data-label="Type">${escapeHtml(tx.type.replaceAll("_", " "))}</td><td data-label="Counterparty">${escapeHtml(personLabel(tx))}</td><td data-label="Category">${escapeHtml(tx.category || "Other")}</td><td data-label="Amount" class="${incoming ? "income" : "expense"}">${incoming ? "+" : "-"}${money(tx.amount)}</td><td data-label="Status"><span class="status-badge status-${transactionStatusClass(tx.status)}">${escapeHtml(tx.status || "completed")}</span></td><td><button class="table-action" data-tx="${escapeHtml(tx.id)}">Receipt</button></td></tr>`;
    }).join("")}
  </tbody></table>`;
  $$('[data-tx]', container).forEach(button => button.addEventListener("click", () => showReceipt(button.dataset.tx)));
}

function thisMonthTransactions() {
  const current = new Date();
  return state.transactions.filter(tx => {
    const date = new Date(tx.created_at);
    return date.getMonth() === current.getMonth() && date.getFullYear() === current.getFullYear();
  });
}

function renderMiniCategoryChart() {
  const canvas = $("#mini-category-chart");
  if (!canvas) return;
  const chartWrap = canvas.parentElement;
  const panel = chartWrap.parentElement;
  const monthExpenses = thisMonthTransactions().filter(isExpense);
  const data = {};
  monthExpenses.forEach(tx => { data[tx.category || "Other"] = (data[tx.category || "Other"] || 0) + Number(tx.amount); });
  const labels = Object.keys(data);
  const values = Object.values(data);
  state.charts.mini?.destroy();
  state.charts.mini = null;
  panel.querySelector(".chart-placeholder")?.remove();
  if (!labels.length) {
    chartWrap.hidden = true;
    panel.insertAdjacentHTML("beforeend", '<div class="chart-placeholder">No spending data for this month yet.</div>');
    return;
  }
  chartWrap.hidden = false;
  state.charts.mini = new Chart(canvas, { type: "doughnut", data: { labels, datasets: [{ data: values }] }, options: { plugins: { legend: { position: "bottom" } }, cutout: "64%", responsive: true, maintainAspectRatio: false } });
}

function renderAnalytics() {
  const currentMonth = thisMonthTransactions();
  const incomeThisMonth = currentMonth.filter(isIncome).reduce((sum, tx) => sum + Number(tx.amount), 0);
  const expenseThisMonth = currentMonth.filter(isExpense).reduce((sum, tx) => sum + Number(tx.amount), 0);
  const net = incomeThisMonth - expenseThisMonth;
  const largestExpense = currentMonth.filter(isExpense).sort((a, b) => Number(b.amount) - Number(a.amount))[0] || null;
  const cat = {};
  currentMonth.filter(isExpense).forEach(tx => { cat[tx.category || "Other"] = (cat[tx.category || "Other"] || 0) + Number(tx.amount); });
  const topCategory = Object.entries(cat).sort((a, b) => b[1] - a[1])[0] || null;

  $("#analytics-balance").textContent = money(state.wallet.balance);
  $("#analytics-net").textContent = money(net);
  $("#analytics-net").className = net >= 0 ? "income" : "expense";
  $("#analytics-largest").textContent = largestExpense ? money(largestExpense.amount) : "₹0.00";
  $("#analytics-largest-label").textContent = largestExpense ? `${largestExpense.category || "Other"} · ${dateText(largestExpense.created_at)}` : "No expense this month";
  $("#analytics-top-category").textContent = topCategory?.[0] || "—";
  $("#analytics-top-category-value").textContent = topCategory ? money(topCategory[1]) : "No expense this month";

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - i);
    months.push(date);
  }
  const labels = months.map(date => date.toLocaleString("en-IN", { month: "short" }));
  const income = months.map(month => state.transactions.filter(isIncome).filter(tx => {
    const date = new Date(tx.created_at); return date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear();
  }).reduce((sum, tx) => sum + Number(tx.amount), 0));
  const expenses = months.map(month => state.transactions.filter(isExpense).filter(tx => {
    const date = new Date(tx.created_at); return date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear();
  }).reduce((sum, tx) => sum + Number(tx.amount), 0));

  const payees = {};
  state.transactions.filter(tx => tx.sender_id === state.user.id && tx.type === "transfer").forEach(tx => {
    const label = tx.receiver_name || tx.counterparty_name || tx.receiver_wallet_id || "Unknown";
    payees[label] = (payees[label] || 0) + Number(tx.amount);
  });
  const topPayees = Object.entries(payees).sort((a, b) => b[1] - a[1]).slice(0, 8);
  $("#monthly-chart-summary").textContent = `Six-month total: ${money(income.reduce((sum, value) => sum + value, 0))} income and ${money(expenses.reduce((sum, value) => sum + value, 0))} expenses.`;
  $("#category-chart-summary").textContent = topCategory ? `Largest category: ${topCategory[0]} at ${money(topCategory[1])}.` : "No expense categories recorded this month.";
  $("#payee-chart-summary").textContent = topPayees.length ? `Top recipient: ${topPayees[0][0]} at ${money(topPayees[0][1])}.` : "No recipients recorded yet.";

  ["monthly", "category", "payee"].forEach(key => state.charts[key]?.destroy());
  state.charts.monthly = new Chart($("#monthly-chart"), { type: "bar", data: { labels, datasets: [{ label: "Income", data: income }, { label: "Expenses", data: expenses }] }, options: { responsive: true } });
  state.charts.category = new Chart($("#category-chart"), { type: "doughnut", data: { labels: Object.keys(cat), datasets: [{ data: Object.values(cat) }] }, options: { responsive: true, plugins: { legend: { position: "bottom" } } } });
  state.charts.payee = new Chart($("#payee-chart"), { type: "bar", data: { labels: topPayees.map(item => item[0]), datasets: [{ label: "Total sent", data: topPayees.map(item => item[1]) }] }, options: { indexAxis: "y", responsive: true } });
}

async function openCashModal(operation) {
  state.cashOperation = operation;
  $("#cash-modal-eyebrow").textContent = operation === "deposit" ? "ADD FUNDS" : "REMOVE FUNDS";
  $("#cash-modal-title").textContent = operation === "deposit" ? "Deposit money" : "Withdraw money";
  $("#cash-submit").textContent = "Continue to PIN";
  $("#cash-message").className = "form-message hidden";
  $("#cash-modal").classList.remove("hidden");
  $("#cash-amount").focus();
}

async function executeCashOperation(event) {
  event.preventDefault();
  const button = $("#cash-submit");
  const operation = state.cashOperation;
  const amount = Number($("#cash-amount").value);
  const category = $("#cash-category").value;
  const note = $("#cash-note").value.trim();
  if (!isValidAmount(amount)) return formMessage("cash-message", "Enter an amount from ₹0.01 to ₹1,000,000,000.");
  if (note.length > MAX_NOTE_LENGTH) return formMessage("cash-message", `Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
  if (operation === "withdrawal" && amount > Number(state.wallet.balance)) return formMessage("cash-message", "Insufficient simulated balance.");
  setButtonBusy(button, true, "Preparing…");
  $("#cash-modal").classList.add("hidden");
  setButtonBusy(button, false, "Continue to PIN");
  openTransactionPin({
    title: operation === "deposit" ? "Authorize deposit" : "Authorize withdrawal",
    summary: `${operation === "deposit" ? "Deposit" : "Withdrawal"} · ${money(amount)}`,
    rpcName: operation === "deposit" ? "deposit_wallet" : "withdraw_wallet",
    params: { p_amount: amount, p_category: category, p_note: note || null },
    onSuccess: async data => {
      toast(`${operation === "deposit" ? "Deposited" : "Withdrew"} ${money(amount)}.`);
      $("#cash-form").reset();
      await loadAll();
      if (data?.transaction_id) showReceipt(data.transaction_id);
    }
  });
}

function openTransactionPin({ title, summary, rpcName, params, onSuccess }) {
  state.pendingTransaction = { rpcName, params, onSuccess };
  $("#transaction-pin-title").textContent = title;
  $("#transaction-pin-summary").innerHTML = `<strong>${escapeHtml(summary)}</strong><small>PIN required for every money-moving transaction.</small>`;
  $("#transaction-pin-message").className = "form-message hidden";
  $("#transaction-pin").value = "";
  $("#transaction-pin-modal").classList.remove("hidden");
  setTimeout(() => $("#transaction-pin")?.focus(), 50);
}

async function authorizeTransaction(event) {
  event.preventDefault();
  const pending = state.pendingTransaction;
  if (!pending) return;
  const pin = $("#transaction-pin").value.trim();
  if (!isValidPin(pin)) return formMessage("transaction-pin-message", "PIN must be exactly 4 digits.");
  const button = $("#transaction-pin-submit");
  setButtonBusy(button, true, "Authorizing…");
  const result = await db.rpc(pending.rpcName, { ...pending.params, p_pin: pin });
  setButtonBusy(button, false, "Authorize transaction");
  if (result.error) {
    formMessage("transaction-pin-message", friendlyError(result.error));
    if (result.error.code === "PIN_LOCKED") {
      $("#transaction-pin-modal").classList.add("hidden");
      state.pendingTransaction = null;
      switchSection("profile");
      await loadPinStatus();
    }
    return;
  }
  if (result.data?.success === false) {
    formMessage("transaction-pin-message", `${result.data.message || "Incorrect PIN."}${result.data.remaining_attempts != null ? ` Attempts left: ${result.data.remaining_attempts}.` : ""}`);
    if (result.data.locked) {
      $("#transaction-pin-modal").classList.add("hidden");
      state.pendingTransaction = null;
      switchSection("profile");
      await loadPinStatus();
    }
    return;
  }
  state.pendingTransaction = null;
  $("#transaction-pin-modal").classList.add("hidden");
  $("#transaction-pin-form").reset();
  state.walletUnlocked = true;
  await pending.onSuccess(result.data || {});
}

async function prepareTransfer(event) {
  event.preventDefault();
  const submitButton = $("#transfer-submit");
  setButtonBusy(submitButton, true, "Verifying recipient…");
  updateTransferStep(1);
  const recipient = $("#transfer-recipient").value.trim().toUpperCase();
  const amount = Number($("#transfer-amount").value);
  const category = $("#transfer-category").value;
  const note = $("#transfer-note").value.trim();
  if (!isValidWalletId(recipient)) { setButtonBusy(submitButton, false); return formMessage("transfer-message", "Wallet ID should look like DW-XXXXXXXXXX."); }
  if (!isValidAmount(amount)) { setButtonBusy(submitButton, false); return formMessage("transfer-message", "Enter a valid amount from ₹0.01 to ₹1,000,000,000."); }
  if (amount > Number(state.wallet.balance)) { setButtonBusy(submitButton, false); return formMessage("transfer-message", "Insufficient simulated balance."); }
  if (note.length > MAX_NOTE_LENGTH) { setButtonBusy(submitButton, false); return formMessage("transfer-message", `Note must be ${MAX_NOTE_LENGTH} characters or fewer.`); }

  const lookup = await db.rpc("lookup_wallet", { p_wallet_id: recipient });
  setButtonBusy(submitButton, false);
  if (lookup.error) return formMessage("transfer-message", friendlyError(lookup.error));
  if (!lookup.data || lookup.data.user_id === state.user.id) return formMessage("transfer-message", "That wallet cannot be used as the recipient.");
  state.transferDraft = { recipient, amount, category, note, recipientName: lookup.data.full_name };
  $("#transfer-preview").innerHTML = `<div><strong>Recipient</strong><span>${escapeHtml(lookup.data.full_name || "Wallet user")}</span></div><div><strong>Wallet ID</strong><span>${escapeHtml(recipient)}</span></div><div><strong>Amount</strong><span>${money(amount)}</span></div><div><strong>Category</strong><span>${escapeHtml(category)}</span></div><div><strong>Note</strong><span>${escapeHtml(note || "—")}</span></div><div class="verification-note">✓ Recipient wallet verified before confirmation.</div>`;
  $("#confirm-modal").classList.remove("hidden");
  updateTransferStep(2);
}

function updateTransferStep(step) {
  $$(".flow-steps span").forEach((item, index) => item.classList.toggle("active", index === step - 1));
}

function moveTransferToPin() {
  if (!state.transferDraft) return;
  const draft = state.transferDraft;
  $("#confirm-modal").classList.add("hidden");
  updateTransferStep(3);
  openTransactionPin({
    title: "Authorize transfer",
    summary: `Send ${money(draft.amount)} to ${draft.recipientName || draft.recipient}`,
    rpcName: "transfer_wallet",
    params: { p_receiver_wallet_id: draft.recipient, p_amount: draft.amount, p_category: draft.category, p_note: draft.note || null },
    onSuccess: async data => {
      state.transferDraft = null;
      $("#transfer-form").reset();
      formMessage("transfer-message", "Transfer completed successfully.", "success");
      toast(`Sent ${money(draft.amount)} to ${draft.recipientName || draft.recipient}.`);
      await loadAll();
      if (data?.transaction_id) showReceipt(data.transaction_id);
    }
  });
}

async function generateRequestQr(event) {
  event.preventDefault();
  const rawAmount = $("#request-amount").value;
  const amount = rawAmount === "" ? null : Number(rawAmount);
  const note = $("#request-note").value.trim();
  if (!isValidAmount(amount, true)) return toast("Enter a valid requested amount.", "error");
  if (note.length > 100) return toast("Request note must be 100 characters or fewer.", "error");
  const payload = JSON.stringify({ app: "digital-wallet", version: 2, wallet_id: state.profile.wallet_id, name: state.profile.full_name, amount, note: note || null });
  await QRCode.toCanvas($("#request-qr"), payload, { width: 240, margin: 2 });
  $("#request-payload").textContent = payload;
  $("#request-qr-output").classList.remove("hidden");
}

async function renderMyQr() {
  const payload = JSON.stringify({ app: "digital-wallet", version: 2, wallet_id: state.profile.wallet_id, name: state.profile.full_name, amount: null, note: null });
  await QRCode.toCanvas($("#my-qr"), payload, { width: 240, margin: 2 });
}

function downloadMyQr() {
  const anchor = document.createElement("a");
  anchor.download = `${state.profile.wallet_id}-qr.png`;
  anchor.href = $("#my-qr").toDataURL("image/png");
  anchor.click();
}

async function shareQr() {
  const payload = JSON.stringify({ app: "digital-wallet", version: 2, wallet_id: state.profile.wallet_id, name: state.profile.full_name, amount: null, note: null });
  const shareText = `${state.profile.full_name || "Wallet user"} can receive a simulated payment at wallet ID ${state.profile.wallet_id}. No real money is involved.`;
  try {
    if (navigator.share) await navigator.share({ title: "My Digital Wallet", text: shareText });
    else {
      await navigator.clipboard.writeText(payload);
      toast("QR payload copied.");
    }
  } catch (error) {
    if (error?.name !== "AbortError") toast("Unable to share the QR payload.", "error");
  }
}

function startScanner() {
  if (state.scanner) return;
  state.scanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: { width: 240, height: 240 } }, false);
  state.scanner.render(decodedText => {
    $("#qr-payload-input").value = decodedText;
    parseQrInput();
    stopScanner();
  }, errorMessage => {
    const help = $(".scan-help");
    if (help && /permission|camera|secure/i.test(String(errorMessage))) help.textContent = "Camera access was unavailable. Paste a Digital Wallet QR payload below instead.";
  });
}

function stopScanner() {
  if (!state.scanner) return;
  state.scanner.clear().catch(() => {});
  state.scanner = null;
  $("#qr-reader").innerHTML = "";
}

async function parseQrInput() {
  const raw = $("#qr-payload-input").value.trim();
  const target = $("#parsed-qr");
  target.classList.remove("hidden");
  target.className = "parsed-qr";
  if (!raw || raw.length > 2000) {
    target.innerHTML = `<strong>Invalid QR payload.</strong><div>Paste a valid Digital Wallet QR payload.</div>`;
    return;
  }
  try {
    const data = JSON.parse(raw);
    const amount = data.amount == null ? null : Number(data.amount);
    const note = data.note == null ? "" : String(data.note);
    if (data.app !== "digital-wallet" || Number(data.version) !== 2 || !isValidWalletId(data.wallet_id)) throw new Error("Unsupported or invalid wallet QR payload.");
    if (data.amount != null && !isValidAmount(amount)) throw new Error("The QR requested amount is invalid.");
    if (note.length > 120) throw new Error("The QR note is too long.");
    const lookup = await db.rpc("lookup_wallet", { p_wallet_id: String(data.wallet_id).toUpperCase() });
    if (lookup.error) throw new Error(friendlyError(lookup.error));
    if (!lookup.data || lookup.data.user_id === state.user.id) throw new Error("You cannot pay your own wallet.");
    const walletId = lookup.data.wallet_id;
    const recipientName = lookup.data.full_name || "Wallet user";
    target.innerHTML = `<div class="verified-qr"><div class="verified-icon">✓</div><div><strong>${escapeHtml(recipientName)}</strong><small>Verified recipient</small></div></div><div>Wallet ID: <strong>${escapeHtml(walletId)}</strong></div>${amount != null ? `<div>Requested: <strong>${money(amount)}</strong></div>` : ""}${note ? `<div>Note: ${escapeHtml(note)}</div>` : ""}<button class="btn btn-primary" id="pay-scanned" style="margin-top:12px">Review payment</button>`;
    $("#pay-scanned").addEventListener("click", () => {
      switchSection("send");
      $("#transfer-recipient").value = walletId;
      if (amount != null) $("#transfer-amount").value = amount;
      if (note) $("#transfer-note").value = note;
      $("#transfer-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  } catch (error) {
    target.innerHTML = `<strong>Invalid QR payload.</strong><div>${escapeHtml(error.message || "Unable to read QR payload.")}</div>`;
  }
}

async function saveBudget(event) {
  event.preventDefault();
  const category = $("#budget-category").value;
  const amount = Number($("#budget-amount").value);
  if (!CATEGORIES.includes(category)) return toast("Choose a valid category.", "error");
  if (!isValidAmount(amount)) return toast("Enter a valid budget amount.", "error");
  const month = $("#budget-month").value;
  if (!month) return toast("Choose a budget month.", "error");
  state.budgetMonth = `${month}-01`;
  const result = await db.upsert("budgets", { user_id: state.user.id, month_start: state.budgetMonth, category, amount }, ["user_id", "month_start", "category"]);
  if (result.error) return toast(friendlyError(result.error), "error");
  toast(`${category} budget saved.`);
  await loadAll();
}

function budgetState(spent, limit) {
  const percentage = limit > 0 ? (spent / limit) * 100 : 0;
  if (percentage > 100) return { label: "Exceeded", className: "over" };
  if (percentage >= 90) return { label: "Near limit", className: "critical" };
  if (percentage >= 70) return { label: "Watch", className: "watch" };
  return { label: "On track", className: "healthy" };
}

function renderBudgets() {
  const element = $("#budget-list");
  $("#budget-month").value = state.budgetMonth.slice(0, 7);
  $("#budget-period-label").textContent = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(`${state.budgetMonth}T00:00:00`)).toUpperCase();
  if (!state.budgets.length) {
    element.className = "budget-list empty-state";
    element.innerHTML = emptyState('<i data-lucide="target"></i>', "No budgets yet", "Create a monthly category limit to track your simulated spending.");
    return;
  }
  element.className = "budget-list";
  element.innerHTML = state.budgets.map(budget => {
    const category = String(budget.category || "").trim().toLowerCase();
    const spent = state.transactions.filter(tx => String(tx.category || "").trim().toLowerCase() === category && isExpense(tx)).filter(tx => {
      const date = new Date(tx.created_at); const month = new Date(`${budget.month_start}T00:00:00`);
      return date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear();
    }).reduce((sum, tx) => sum + Number(tx.amount), 0);
    const limit = Number(budget.amount);
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    const visiblePct = spent > 0 ? Math.min(pct, 100) : 0;
    const remaining = Math.max(0, limit - spent);
    const status = budgetState(spent, limit);
    return `<div class="budget-item"><div class="budget-head"><strong>${escapeHtml(budget.category)}</strong><span>${money(spent)} / ${money(limit)}</span></div><div class="progress-bar"><span class="${pct > 100 ? "over" : ""}" style="width:${visiblePct}%"></span></div><div class="budget-meta"><small class="${status.className}">${pct}% used · ${status.label}</small><strong class="${pct > 100 ? "expense" : "income"}">${pct > 100 ? `${money(spent - limit)} over` : `${money(remaining)} remaining`}</strong></div><div class="contact-actions"><button class="table-action" data-delete-budget="${escapeHtml(budget.id)}">Delete</button></div></div>`;
  }).join("");
  $$('[data-delete-budget]', element).forEach(button => button.addEventListener("click", async () => {
    if (!window.confirm("Delete this budget? Its limit and progress will be removed.")) return;
    const result = await db.delete("budgets", [{ column: "id", op: "eq", value: button.dataset.deleteBudget }]);
    if (result.error) toast(friendlyError(result.error), "error"); else await loadAll();
  }));
}

async function saveContact(event) {
  event.preventDefault();
  const walletId = $("#contact-wallet-id").value.trim().toUpperCase();
  const nickname = $("#contact-nickname").value.trim();
  if (!isValidWalletId(walletId)) return formMessage("contact-message", "Wallet ID should look like DW-XXXXXXXXXX.");
  if (nickname.length > 40) return formMessage("contact-message", "Nickname must be 40 characters or fewer.");
  const lookup = await db.rpc("lookup_wallet", { p_wallet_id: walletId });
  if (lookup.error) return formMessage("contact-message", friendlyError(lookup.error));
  if (!lookup.data?.user_id || lookup.data.user_id === state.user.id) return formMessage("contact-message", "That wallet could not be added.");
  const duplicate = state.contacts.some(contact => contact.wallet_id === walletId);
  if (duplicate) return formMessage("contact-message", "That wallet is already in your contacts.");
  const result = await db.insert("contacts", { contact_user_id: lookup.data.user_id, wallet_id: walletId, nickname: nickname || lookup.data.full_name, favorite: false });
  if (result.error) return formMessage("contact-message", friendlyError(result.error));
  formMessage("contact-message", "Contact added.", "success");
  $("#contact-form").reset();
  await loadAll();
}

function renderContacts() {
  const element = $("#contacts-list");
  element.className = state.contacts.length ? "contact-list" : "contact-list empty-state";
  element.innerHTML = state.contacts.length ? state.contacts.map(contact => `<div class="contact-item"><div class="contact-head"><div><strong>${escapeHtml(contact.nickname || contact.wallet_id)}</strong><small class="muted" style="display:block">${escapeHtml(contact.wallet_id)}</small></div><button class="favorite-btn ${contact.favorite ? "active" : ""}" data-favorite-contact="${escapeHtml(contact.id)}" aria-label="${contact.favorite ? "Remove favorite" : "Add favorite"}">${contact.favorite ? "★" : "☆"}</button></div><div class="contact-actions"><button class="btn btn-outline btn-sm" data-quick-send="${escapeHtml(contact.wallet_id)}">Send</button><button class="table-action" data-edit-contact="${escapeHtml(contact.id)}">Edit</button><button class="table-action" data-delete-contact="${escapeHtml(contact.id)}">Remove</button></div></div>`).join("") : emptyState('<i data-lucide="contact-round"></i>', "No contacts yet", "Save a verified wallet recipient here for faster transfers.", `<button class="btn btn-primary btn-sm" data-section-jump="send">Send money</button>`);
  $$('[data-section-jump]', element).forEach(button => button.addEventListener("click", () => switchSection(button.dataset.sectionJump)));
  $$('[data-quick-send]', element).forEach(button => button.addEventListener("click", () => { switchSection("send"); $("#transfer-recipient").value = button.dataset.quickSend; }));
  $$('[data-edit-contact]', element).forEach(button => button.addEventListener("click", async () => {
    const contact = state.contacts.find(item => item.id === button.dataset.editContact);
    if (!contact) return;
    const nickname = window.prompt("Contact nickname", contact.nickname || "");
    if (nickname === null || nickname.trim() === contact.nickname) return;
    if (nickname.trim().length > 40) return toast("Nickname must be 40 characters or fewer.", "error");
    const result = await db.update("contacts", { nickname: nickname.trim() }, [{ column: "id", op: "eq", value: contact.id }]);
    if (result.error) toast(friendlyError(result.error), "error"); else await loadAll();
  }));
  $$('[data-delete-contact]', element).forEach(button => button.addEventListener("click", async () => {
    if (!window.confirm("Remove this saved contact? Their wallet account will not be affected.")) return;
    const result = await db.delete("contacts", [{ column: "id", op: "eq", value: button.dataset.deleteContact }]);
    if (result.error) toast(friendlyError(result.error), "error"); else await loadAll();
  }));
  $$('[data-favorite-contact]', element).forEach(button => button.addEventListener("click", async () => {
    const contact = state.contacts.find(item => item.id === button.dataset.favoriteContact);
    if (!contact) return;
    const result = await db.update("contacts", { favorite: !contact.favorite }, [{ column: "id", op: "eq", value: contact.id }]);
    if (result.error) toast(friendlyError(result.error), "error"); else await loadAll();
  }));
  const quick = $("#quick-contacts");
  quick.innerHTML = state.contacts.slice(0, 8).map(contact => `<button type="button" class="quick-contact" data-qcontact="${escapeHtml(contact.wallet_id)}">${contact.favorite ? "★ " : ""}${escapeHtml(contact.nickname || contact.wallet_id)}</button>`).join("");
  $$('[data-qcontact]', quick).forEach(button => button.addEventListener("click", () => { $("#transfer-recipient").value = button.dataset.qcontact; }));
}

async function saveRecurring(event) {
  event.preventDefault();
  const title = $("#recurring-title").value.trim();
  const amount = Number($("#recurring-amount").value);
  const frequency = $("#recurring-frequency").value;
  const category = $("#recurring-category").value;
  if (!title || title.length > 80) return toast("Enter a recurring payment title up to 80 characters.", "error");
  if (!isValidAmount(amount)) return toast("Enter a valid recurring amount.", "error");
  if (!["weekly", "monthly"].includes(frequency)) return toast("Choose a valid frequency.", "error");
  const next = new Date();
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1); else next.setDate(next.getDate() + 7);
  const result = await db.insert("recurring_payments", { title, amount, frequency, category, next_run_at: next.toISOString(), active: true });
  if (result.error) return toast(friendlyError(result.error), "error");
  $("#recurring-form").reset();
  toast("Recurring payment added.");
  await loadAll();
}

function renderRecurring() {
  const element = $("#recurring-list");
  element.className = state.recurring.length ? "recurring-list" : "recurring-list empty-state";
  element.innerHTML = state.recurring.length ? state.recurring.map(item => `<div class="recurring-item"><div class="recurring-head"><strong>${escapeHtml(item.title)}</strong><span>${money(item.amount)}</span></div><small class="muted">${escapeHtml(item.frequency)} · ${escapeHtml(item.category)} · next ${escapeHtml(dateText(item.next_run_at))}</small><div class="recurring-actions"><button class="btn btn-secondary" data-run-recurring="${escapeHtml(item.id)}" ${item.active ? "" : "disabled"}>Run now</button><button class="table-action" data-delete-recurring="${escapeHtml(item.id)}">Delete</button></div></div>`).join("") : emptyState('<i data-lucide="repeat-2"></i>', "No recurring payments yet", "Add a recurring item, then run it manually as a simulated scheduled payment.");
  $$('[data-run-recurring]', element).forEach(button => button.addEventListener("click", () => {
    const item = state.recurring.find(candidate => candidate.id === button.dataset.runRecurring);
    if (!item) return;
    openTransactionPin({
      title: "Authorize recurring payment",
      summary: `${item.title} · ${money(item.amount)}`,
      rpcName: "run_recurring_payment",
      params: { p_recurring_id: item.id },
      onSuccess: async data => {
        toast(`${item.title} payment completed.`);
        await loadAll();
        if (data?.transaction_id) showReceipt(data.transaction_id);
      }
    });
  }));
  $$('[data-delete-recurring]', element).forEach(button => button.addEventListener("click", async () => {
    if (!window.confirm("Delete this recurring payment? Its schedule will be removed.")) return;
    const result = await db.delete("recurring_payments", [{ column: "id", op: "eq", value: button.dataset.deleteRecurring }]);
    if (result.error) toast(friendlyError(result.error), "error"); else await loadAll();
  }));
  $$('[data-toggle-recurring]', element).forEach(button => button.addEventListener("click", async () => {
    const item = state.recurring.find(candidate => candidate.id === button.dataset.toggleRecurring);
    if (!item) return;
    const result = await db.update("recurring_payments", { active: !item.active }, [{ column: "id", op: "eq", value: item.id }]);
    if (result.error) toast(friendlyError(result.error), "error"); else await loadAll();
  }));
}

function renderNotifications() {
  const unread = state.notifications.filter(notification => !notification.is_read).length;
  $("#notification-count").textContent = unread;
  $("#notification-count").classList.toggle("hidden", unread === 0);
  const filter = $("#notification-filter")?.value || "all";
  const notifications = state.notifications.filter(notification => filter === "all" || (filter === "unread" ? !notification.is_read : notification.is_read));
  const element = $("#notifications-list");
  element.className = notifications.length ? "notification-list" : "notification-list empty-state";
  element.innerHTML = notifications.length ? notifications.map(notification => `<div class="notification-item ${notification.is_read ? "" : "unread"}"><div class="notification-head"><strong>${escapeHtml(notification.title)}</strong><small>${escapeHtml(dateText(notification.created_at))}</small></div><p>${escapeHtml(notification.message)}</p>${!notification.is_read ? `<button class="table-action" data-read-notification="${escapeHtml(notification.id)}">Mark read</button>` : ""}</div>`).join("") : emptyState('<i data-lucide="bell-off"></i>', filter === "all" ? "No notifications" : "No matching notifications", "Wallet and account updates will appear here.");
  $$('[data-read-notification]', element).forEach(button => button.addEventListener("click", async () => {
    const result = await db.update("notifications", { is_read: true }, [{ column: "id", op: "eq", value: button.dataset.readNotification }]);
    if (result.error) toast(friendlyError(result.error), "error"); else await loadAll();
  }));
}

async function markAllNotificationsRead() {
  const result = await db.update("notifications", { is_read: true }, [{ column: "user_id", op: "eq", value: state.user.id }, { column: "is_read", op: "eq", value: false }]);
  if (result.error) toast(friendlyError(result.error), "error"); else await loadAll();
}

async function saveProfile(event) {
  event.preventDefault();
  const fullName = $("#profile-name").value.trim();
  const phone = $("#profile-phone").value.trim();
  if (!fullName || fullName.length > 80) return toast("Enter a name up to 80 characters.", "error");
  if (phone.length > 25) return toast("Phone must be 25 characters or fewer.", "error");
  const result = await db.update("profiles", { full_name: fullName, phone }, [{ column: "id", op: "eq", value: state.user.id }]);
  if (result.error) return toast(friendlyError(result.error), "error");
  toast("Profile updated.");
  await loadAll();
  await renderMyQr();
}

async function loadPinStatus() {
  const result = await db.rpc("get_wallet_status");
  if (result.error) {
    $("#pin-status").textContent = friendlyError(result.error);
    return;
  }
  state.pinStatus = result.data;
  const hasPin = Boolean(result.data?.has_pin);
  const locked = Boolean(result.data?.locked);
  $("#pin-status").textContent = locked
    ? "Your wallet PIN is locked after 3 failed attempts. Use PIN recovery below."
    : hasPin
      ? "Your wallet PIN is configured. Every money-moving transaction requires it."
      : "No wallet PIN is configured. Set one before using transactions.";
  $("#old-pin-label").classList.toggle("hidden", !hasPin);
  $("#pin-recovery").classList.toggle("hidden", !locked);
}

async function savePin(event) {
  event.preventDefault();
  const hasPin = Boolean(state.pinStatus?.has_pin);
  const oldPin = $("#old-pin").value.trim();
  const newPin = $("#new-pin").value.trim();
  const confirm = $("#confirm-pin").value.trim();
  if (hasPin && !isValidPin(oldPin)) return formMessage("pin-message", "Current PIN must be exactly 4 digits.");
  if (!isValidPin(newPin)) return formMessage("pin-message", "New PIN must be exactly 4 digits.");
  if (newPin !== confirm) return formMessage("pin-message", "New PIN and confirmation do not match.");
  const result = hasPin
    ? await db.rpc("change_wallet_pin", { p_old_pin: oldPin, p_pin: newPin })
    : await db.rpc("set_wallet_pin", { p_pin: newPin });
  if (result.error) return formMessage("pin-message", friendlyError(result.error));
  $("#pin-form").reset();
  state.walletUnlocked = true;
  formMessage("pin-message", "Wallet PIN updated successfully.", "success");
  await loadPinStatus();
}

async function recoverPin(event) {
  event.preventDefault();
  const password = $("#recovery-password").value;
  const newPin = $("#recovery-pin").value.trim();
  const confirm = $("#recovery-pin-confirm").value.trim();
  if (!password) return formMessage("pin-recovery-message", "Enter your account password.");
  if (!isValidPin(newPin)) return formMessage("pin-recovery-message", "New PIN must be exactly 4 digits.");
  if (newPin !== confirm) return formMessage("pin-recovery-message", "New PIN and confirmation do not match.");
  const result = await db.rpc("reset_wallet_pin_with_password", { password, p_new_pin: newPin });
  if (result.error) return formMessage("pin-recovery-message", friendlyError(result.error));
  $("#pin-recovery-form").reset();
  state.walletUnlocked = true;
  formMessage("pin-recovery-message", "Wallet PIN reset successfully.", "success");
  await loadPinStatus();
}

async function ensureWalletPin() {
  const status = state.pinStatus || (await db.rpc("get_wallet_status")).data;
  state.pinStatus = status || null;
  if (!status?.has_pin) {
    state.walletUnlocked = false;
    openOnboarding();
    return;
  }
  if (status.locked) {
    state.walletUnlocked = false;
    switchSection("profile");
    toast("Your wallet PIN is locked. Use PIN recovery in Profile & Settings.", "error");
    return;
  }
  $("#pin-modal").classList.remove("hidden");
  setTimeout(() => $("#unlock-pin")?.focus(), 50);
}

function openOnboarding() {
  $("#onboarding-name").value = state.profile?.full_name || "";
  $("#onboarding-modal")?.classList.remove("hidden");
  $("#onboarding-name")?.focus();
}

function showOnboardingStep(step) {
  $$(".onboarding-step").forEach((item, index) => item.classList.toggle("hidden", index !== step - 1));
  $$(".onboarding-progress span").forEach((item, index) => item.classList.toggle("active", index === step - 1));
  refreshIcons();
}

async function completeOnboardingProfile(event) {
  event.preventDefault();
  const name = $("#onboarding-name").value.trim();
  if (!name || name.length > 80) return formMessage("onboarding-profile-message", "Enter your name to continue.");
  const button = event.currentTarget.querySelector("button[type=submit]");
  setButtonBusy(button, true, "Saving profile…");
  const result = await db.update("profiles", { full_name: name }, [{ column: "id", op: "eq", value: state.user.id }]);
  setButtonBusy(button, false);
  if (result.error) return formMessage("onboarding-profile-message", friendlyError(result.error));
  state.profile.full_name = name;
  hydrateIdentity();
  showOnboardingStep(2);
  $("#onboarding-pin")?.focus();
}

async function completeOnboardingPin(event) {
  event.preventDefault();
  const pin = $("#onboarding-pin").value.trim();
  const confirm = $("#onboarding-pin-confirm").value.trim();
  if (!isValidPin(pin)) return formMessage("onboarding-pin-message", "PIN must be exactly 4 digits.");
  if (pin !== confirm) return formMessage("onboarding-pin-message", "PINs do not match.");
  const button = event.currentTarget.querySelector("button[type=submit]");
  setButtonBusy(button, true, "Creating PIN…");
  const result = await db.rpc("set_wallet_pin", { p_pin: pin });
  setButtonBusy(button, false);
  if (result.error) return formMessage("onboarding-pin-message", friendlyError(result.error));
  state.onboardingPin = pin;
  state.pinStatus = { has_pin: true, locked: false };
  showOnboardingStep(3);
  $("#onboarding-balance")?.focus();
}

async function completeOnboardingBalance(event) {
  event.preventDefault();
  const rawAmount = $("#onboarding-balance").value;
  const amount = rawAmount === "" ? null : Number(rawAmount);
  if (amount !== null && !isValidAmount(amount)) return formMessage("onboarding-balance-message", "Enter a valid starting balance or leave it blank.");
  const button = event.currentTarget.querySelector("button[type=submit]");
  setButtonBusy(button, true, amount === null ? "Opening dashboard…" : "Adding simulated funds…");
  if (amount !== null) {
    const result = await db.rpc("deposit_wallet", { p_amount: amount, p_category: "Income", p_note: "Starting balance" , p_pin: state.onboardingPin });
    if (result.error) {
      setButtonBusy(button, false);
      return formMessage("onboarding-balance-message", friendlyError(result.error));
    }
  }
  state.walletUnlocked = true;
  state.onboardingPin = null;
  $("#onboarding-modal")?.classList.add("hidden");
  setButtonBusy(button, false);
  await loadAll();
  toast("Your wallet is ready.");
}

async function unlockWallet(event) {
  event.preventDefault();
  const pin = $("#unlock-pin").value.trim();
  if (!isValidPin(pin)) return formMessage("unlock-message", "PIN must be exactly 4 digits.");
  const result = await db.rpc("verify_wallet_pin", { p_pin: pin });
  if (result.error) return formMessage("unlock-message", friendlyError(result.error));
  if (!result.data?.success) {
    formMessage("unlock-message", `${result.data?.message || "Incorrect PIN."}${result.data?.remaining_attempts != null ? ` Attempts left: ${result.data.remaining_attempts}.` : ""}`);
    if (result.data?.locked) {
      $("#pin-modal").classList.add("hidden");
      switchSection("profile");
      await loadPinStatus();
    }
    return;
  }
  state.walletUnlocked = true;
  $("#pin-modal").classList.add("hidden");
  $("#unlock-form").reset();
  toast("Wallet unlocked.");
}

function setupTheme() {
  const isDark = localStorage.getItem("digital-wallet-theme") === "dark";
  document.body.classList.toggle("dark", isDark);
  $("#theme-toggle")?.setAttribute("aria-pressed", String(isDark));
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("digital-wallet-theme", isDark ? "dark" : "light");
  $("#theme-toggle")?.setAttribute("aria-pressed", String(isDark));
}

async function signOut() {
  if (!window.confirm("Are you sure you want to log out?")) return;
  closeRealtime();
  await db.auth.signOut();
  state.walletUnlocked = false;
  state.pendingTransaction = null;
  location.href = "/";
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportTransactionsCsv() {
  const list = filteredTransactions();
  if (!list.length) return toast("There are no transactions matching the current filters.", "error");
  const header = ["Date", "Reference", "Transaction ID", "Type", "Counterparty", "Counterparty Wallet", "Category", "Amount", "Direction", "Status", "Note"];
  const rows = list.map(tx => [
    new Date(tx.created_at).toISOString(), tx.reference_id || "", tx.id, tx.type, personLabel(tx), tx.counterparty_wallet_id || tx.sender_wallet_id || tx.receiver_wallet_id || "", tx.category || "Other", Number(tx.amount).toFixed(2), isIncome(tx) ? "Income" : "Expense", tx.status || "completed", tx.note || ""
  ]);
  const csv = `\ufeff${[header, ...rows].map(row => row.map(csvValue).join(",")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("Transaction CSV exported.");
}

async function showReceipt(id) {
  const transaction = state.transactions.find(item => item.id === id);
  if (!transaction) return;
  const incoming = isIncome(transaction);
  $("#receipt-content").innerHTML = `<div class="receipt-box"><div class="eyebrow">DIGITAL WALLET SIMULATOR</div><h2>Payment Receipt</h2><p class="receipt-status status-${transactionStatusClass(transaction.status)}">${escapeHtml(transaction.status || "completed")}</p><h2>${incoming ? "+" : "-"}${money(transaction.amount)}</h2><div class="receipt-row"><span>Reference</span><strong>${escapeHtml(transaction.reference_id || "—")}</strong></div><div class="receipt-row"><span>Transaction ID</span><strong>${escapeHtml(transaction.id)}</strong></div><div class="receipt-row"><span>Type</span><strong>${escapeHtml(transaction.type.replaceAll("_", " "))}</strong></div><div class="receipt-row"><span>Counterparty</span><strong>${escapeHtml(personLabel(transaction))}</strong></div><div class="receipt-row"><span>Wallet ID</span><strong>${escapeHtml(counterpartyWallet(transaction) || "—")}</strong></div><div class="receipt-row"><span>Category</span><strong>${escapeHtml(transaction.category || "Other")}</strong></div><div class="receipt-row"><span>Note</span><strong>${escapeHtml(transaction.note || "—")}</strong></div><div class="receipt-row"><span>Date</span><strong>${escapeHtml(dateText(transaction.created_at))}</strong></div><p class="receipt-disclaimer">Simulation only — no real money was transferred.</p></div>`;
  $("#receipt-modal").classList.remove("hidden");
}

async function resetSimulation(event) {
  event.preventDefault();
  const password = $("#reset-password").value;
  const confirm = $("#reset-confirm-text").value.trim();
  if (!password) return formMessage("reset-simulation-message", "Enter your account password.");
  if (confirm !== "RESET") return formMessage("reset-simulation-message", "Type RESET exactly to continue.");
  const result = await db.rpc("reset_user_data", { password });
  if (result.error) return formMessage("reset-simulation-message", friendlyError(result.error));
  $("#reset-simulation-form").reset();
  $("#reset-simulation-modal").classList.add("hidden");
  state.walletUnlocked = false;
  toast("Your wallet simulation was reset.");
  await loadAll();
  await ensureWalletPin();
}

async function deleteAccount(event) {
  event.preventDefault();
  const password = $("#delete-password").value;
  if (!password) return formMessage("delete-account-message", "Enter your account password.");
  const result = await db.rpc("delete_account", { password });
  if (result.error) return formMessage("delete-account-message", friendlyError(result.error));
  await db.auth.signOut();
  location.href = "/";
}

init().catch(error => {
  console.error(error);
  toast("The wallet could not be loaded. Refresh the page and try again.", "error");
});
