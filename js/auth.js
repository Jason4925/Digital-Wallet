import { db } from "./data-api.js";

const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const msg = document.querySelector("#form-message");

function showMessage(text, type = "error") {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `form-message ${type}`;
}

function readableAuthError(error) {
  const message = error?.message || "";
  if (message.toLowerCase().includes("rate limit")) {
    return "This wallet ID is temporarily unavailable. Wait a moment and try a different ID.";
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
    const email = document.querySelector("#email").value.trim().toLowerCase();
    const password = document.querySelector("#password").value;

    if (!email || !password) {
      showMessage("Enter your dummy email and password.");
      return;
    }

    try {
      showMessage("Signing in…", "success");
      const { error } = await db.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        showMessage("Invalid dummy email or password.");
        return;
      }

      location.href = "/user.html";
    } catch (error) {
      console.error(error);
      showMessage("Unable to sign in. Check your wallet ID and password.");
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
