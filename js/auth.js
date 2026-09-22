import { db } from "./data-api.js";

const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const msg = document.querySelector("#form-message");

function showMessage(text, type = "error") {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `form-message ${type}`;
}

function setupPasswordToggles() {
  document.querySelectorAll("[data-toggle-password]").forEach(button => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.togglePassword);
      if (!input) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      button.setAttribute("aria-label", `${visible ? "Show" : "Hide"} password`);
      button.title = `${visible ? "Show" : "Hide"} password`;
      button.innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}" aria-hidden="true"></i>`;
      window.lucide?.createIcons();
    });
  });
}

setupPasswordToggles();

if (new URLSearchParams(location.search).has("expired")) {
  showMessage("Your session expired. Sign in again to continue.");
}

function readableAuthError(error) {
  const message = error?.message || "";
  if (message.toLowerCase().includes("network") || message.toLowerCase().includes("fetch")) {
    return "Unable to reach the wallet server. Check the server URL and Supabase environment variables.";
  }
  return message || "Unable to create the wallet account.";
}

async function redirectIfAlreadySignedIn() {
  const { data: { session } } = await db.auth.getSession();
  if (session && (location.pathname.endsWith("login.html") || location.pathname.endsWith("register.html"))) {
    location.href = "/user.html";
  }
}

if (loginForm) {
  redirectIfAlreadySignedIn();
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitButton = loginForm.querySelector("button[type=submit]");
    const email = document.querySelector("#email").value.trim().toLowerCase();
    const password = document.querySelector("#password").value;

    if (!email || !password) {
      showMessage("Enter your email and password.");
      return;
    }

    try {
      if (submitButton) submitButton.disabled = true;
      showMessage("Signing in…", "success");
      const { error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        showMessage("Invalid email or password.");
        return;
      }

      location.href = "/user.html";
    } catch (error) {
      console.error(error);
      showMessage("Unable to sign in. Check your wallet ID and password.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

if (registerForm) {
  redirectIfAlreadySignedIn();
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitButton = registerForm.querySelector("button[type=submit]");

    const fullName = document.querySelector("#full-name").value.trim();
    const email = document.querySelector("#email").value.trim().toLowerCase();
    const password = document.querySelector("#password").value;
    const confirmPassword = document.querySelector("#confirm-password").value;

    if (!fullName) {
      showMessage("Enter your name.");
      return;
    }

    if (!email) {
      showMessage("Invent an email-style ID such as alex@wallet.local. It does not need to be real.");
      return;
    }

    if (!email.includes("@")) {
      showMessage("Use an email-style ID such as alex@wallet.local.");
      return;
    }

    if (password !== confirmPassword) {
      showMessage("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      showMessage("Password must be at least 8 characters.");
      return;
    }

    try {
      if (submitButton) submitButton.disabled = true;
      showMessage("Creating your wallet…", "success");

      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            email_demo: true
          }
        }
      });

      if (error) {
        showMessage(readableAuthError(error));
        return;
      }

      if (data.session) {
        location.href = "/user.html";
        return;
      }

      showMessage(
        "Account created. Your wallet ID is ready to use.",
        "success"
      );
      registerForm.reset();
    } catch (error) {
      console.error(error);
      showMessage(readableAuthError(error));
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
