import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
const message = document.getElementById("form-message");
const setMessage = (text, success) => {
  if (!message) return;
  message.textContent = text;
  message.classList.toggle("success", Boolean(success));
};

const friendlyError = (error) => {
  const messages = {
    "auth/email-already-in-use": "This email is already registered. Please log in.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/user-not-found": "The email or password is incorrect.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/user-disabled": "This account has been disabled. Please contact the showroom.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/weak-password": "Choose a stronger password with at least 8 characters.",
    "auth/network-request-failed": "Network connection failed. Check your connection and try again.",
    "auth/operation-not-allowed": "Email and password sign-in is not enabled in Firebase Authentication.",
    "auth/admin-restricted-operation": "Email and password sign-in is not enabled for this Firebase project.",
    "auth/api-key-not-valid": "Firebase rejected this app's API key. Verify the Web App configuration and API key restrictions.",
    "auth/invalid-api-key": "Firebase rejected this app's API key. Verify the Web App configuration and API key restrictions.",
    "auth/app-not-authorized": "This website's domain is not authorized for Firebase Authentication. Add it in Firebase Authentication settings.",
    "auth/unauthorized-domain": "This website's domain is not authorized for Firebase Authentication. Add it in Firebase Authentication settings.",
    "auth/requests-to-this-api-are-blocked": "The Firebase API key is restricted from Authentication requests. Review its API restrictions in Google Cloud Console.",
    "auth/configuration-not-found": "Firebase Authentication has not been initialized for this project. In Firebase Console, open Build → Authentication and select Get started, then enable Email/Password.",
    "auth/password-does-not-meet-requirements": "Choose a password that meets the requirements configured for this Firebase project.",
  };
  return messages[error.code] || "We couldn't complete that request. Please try again.";
};

function logAuthFailure(action, error) {
  console.error(`${action} failed`, {
    code: error?.code || "unknown",
    message: typeof error?.message === "string" ? error.message : "No Firebase error message provided"
  });
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function validMobileNumber(value) {
  const digits = value.replace(/\D/g, "");
  return /^\+?[0-9 ()-]{10,18}$/.test(value) && digits.length >= 10 && digits.length <= 15;
}

const SIGNUP_OPERATION_TIMEOUT_MS = 20000;

function withSignupTimeout(operation, operationName) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(`${operationName} timed out`);
      error.code = "signup/timeout";
      reject(error);
    }, SIGNUP_OPERATION_TIMEOUT_MS);
  });
  return Promise.race([operation, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function profileSaveErrorMessage(error) {
  const message = "Your account was created, but its profile could not be saved.";
  if (error?.code === "permission-denied") {
    return `${message} Firestore denied the profile write. Do not sign up again; continue to My Account after access is restored.`;
  }
  if (error?.code === "unavailable" || error?.code === "network-request-failed") {
    return `${message} Firebase is temporarily unavailable. Do not sign up again; check your connection and continue to My Account to retry.`;
  }
  if (error?.code === "signup/timeout") {
    return `${message} The save was not confirmed within 20 seconds and may still complete. Do not sign up again; continue to My Account to check your profile.`;
  }
  return `${message} Do not sign up again; continue to My Account to complete your profile.`;
}

function customerDestination() {
  const requestedDestination = new URLSearchParams(window.location.search).get("return");
  return ["account.html", "checkout.html"].includes(requestedDestination)
    ? requestedDestination
    : "index.html";
}

const signupLink = document.querySelector('.auth-switch a[href="signup.html"]');
const requestedDestination = customerDestination();
if (signupLink && requestedDestination !== "index.html") {
  signupLink.href = `signup.html?return=${encodeURIComponent(requestedDestination)}`;
}

document.querySelectorAll(".password-toggle").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.parentElement.querySelector("input");
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Hide" : "Show";
    button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  });
});

const signupForm = document.getElementById("signup-form");
if (signupForm) {
  const signupProfileRecovery = document.getElementById("signup-profile-recovery");
  let signupInProgress = false;

  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (signupInProgress) return;
    if (!signupForm.reportValidity()) return;
    if (!isFirebaseConfigured || !auth || !db) {
      setMessage("Firebase could not be initialized. Check the Web App configuration and setup instructions in README.md.", false);
      return;
    }
    const data = new FormData(signupForm);
    const name = data.get("name").trim();
    const email = normalizeEmail(data.get("email"));
    const mobile = data.get("mobile").trim();
    const password = data.get("password");
    if (name.length < 2) {
      setMessage("Enter your full name.", false);
      signupForm.elements.name.focus();
      return;
    }
    if (!validMobileNumber(mobile)) {
      setMessage("Enter a valid mobile number with 10 to 15 digits.", false);
      signupForm.elements.mobile.focus();
      return;
    }
    if (password !== data.get("confirmPassword")) {
      setMessage("Your passwords do not match.", false);
      signupForm.elements.confirmPassword.focus();
      return;
    }
    const submit = signupForm.querySelector('button[type="submit"]');
    const idleButtonMarkup = submit.innerHTML;
    signupInProgress = true;
    submit.disabled = true;
    submit.textContent = "Creating account…";
    submit.setAttribute("aria-busy", "true");
    setMessage("");
    signupProfileRecovery.hidden = true;
    let user = null;
    let accountCreated = false;

    try {
      const credential = await withSignupTimeout(
        createUserWithEmailAndPassword(auth, email, password),
        "Account creation"
      );
      user = credential.user;
      accountCreated = true;
      submit.textContent = "Saving profile…";

      try {
        await withSignupTimeout(updateProfile(user, { displayName: name }), "Auth profile update");
      } catch (error) {
        logAuthFailure("Customer profile name update", error);
      }

      await withSignupTimeout(setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name,
        email: user.email || email,
        mobile,
        createdAt: serverTimestamp()
      }), "Firestore profile save");

      setMessage("Your account has been created successfully!", true);
      window.location.assign("index.html?notice=signup-success");
    } catch (error) {
      if (accountCreated) {
        setMessage(profileSaveErrorMessage(error), false);
        signupProfileRecovery.hidden = false;
        logAuthFailure("Customer profile save", error);
      } else {
        setMessage(error?.code === "signup/timeout"
          ? "We couldn't confirm account creation within 20 seconds. Do not submit again yet; try signing in with the email and password you entered."
          : friendlyError(error), false);
        logAuthFailure("Customer signup", error);
      }
    } finally {
      signupInProgress = false;
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
      submit.innerHTML = idleButtonMarkup;
    }
  });
}

const signinForm = document.getElementById("signin-form");
if (signinForm) {
  const resetButton = document.getElementById("forgot-password");
  resetButton?.addEventListener("click", async () => {
    const email = normalizeEmail(signinForm.elements.email.value);
    if (!email) {
      setMessage("Enter your email address first, and we’ll send you a password reset link.", false);
      signinForm.elements.email.focus();
      return;
    }
    if (!isFirebaseConfigured || !auth) {
      setMessage("Firebase could not be initialized. Check the Web App configuration and setup instructions in README.md.", false);
      return;
    }
    resetButton.disabled = true;
    resetButton.textContent = "Sending reset link…";
    setMessage("");
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("If an account exists for this address, a password reset link has been sent.", true);
    } catch (error) {
      if (["auth/user-not-found", "auth/invalid-credential"].includes(error.code)) {
        setMessage("If an account exists for this address, a password reset link has been sent.", true);
      } else {
        setMessage(friendlyError(error));
        logAuthFailure("Password reset", error);
      }
    } finally {
      resetButton.disabled = false;
      resetButton.textContent = "Forgot password?";
    }
  });

  signinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!signinForm.reportValidity()) return;
    if (!isFirebaseConfigured || !auth) {
      setMessage("Firebase could not be initialized. Check the Web App configuration and setup instructions in README.md.", false);
      return;
    }
    const submit = signinForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Signing in…";
    setMessage("");
    let authenticatedUser = null;
    try {
      const data = new FormData(signinForm);
      const credential = await signInWithEmailAndPassword(auth, normalizeEmail(data.get("email")), data.get("password"));
      authenticatedUser = credential.user;
      const token = await credential.user.getIdTokenResult();
      if (token.claims.admin === true) {
        await signOut(auth);
        setMessage("Administrator sign-in is currently unavailable.", false);
        submit.disabled = false;
        submit.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
        return;
      }
      window.location.assign(customerDestination());
    } catch (error) {
      if (authenticatedUser && auth.currentUser?.uid === authenticatedUser.uid) {
        try {
          await signOut(auth);
        } catch (signOutError) {
          logAuthFailure("Customer sign-in cleanup", signOutError);
        }
      }
      setMessage(friendlyError(error));
      logAuthFailure("Customer sign-in", error);
      submit.disabled = false;
      submit.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
    }
  });
}


