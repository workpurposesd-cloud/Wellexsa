import { app, auth, db, isFirebaseConfigured } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential,
  sendPasswordResetEmail, signInWithCustomToken, signInWithEmailAndPassword, signOut, updatePassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, doc, getDoc, onSnapshot, query, setDoc, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const functions = app ? getFunctions(app, "us-central1") : null;
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
    "functions/unauthenticated": "The administrator username or password is incorrect.",
    "functions/unavailable": "Secure administrator sign-in is unavailable. Try again shortly.",
    "functions/internal": "Secure administrator sign-in could not reach Firebase. Try again shortly.",
    "functions/deadline-exceeded": "Secure administrator sign-in timed out. Try again.",
    "functions/not-found": "Secure administrator sign-in is not deployed. Contact the showroom administrator.",
    "functions/failed-precondition": "Secure administrator sign-in is not configured. Contact the showroom administrator.",
    "functions/resource-exhausted": "Too many administrator sign-in attempts. Try again later.",
    "functions/invalid-argument": "Choose a new password with at least 12 characters."
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
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
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
    submit.disabled = true;
    submit.textContent = "Creating account…";
    setMessage("");
    let user;
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      user = credential.user;
    } catch (error) {
      setMessage(friendlyError(error));
      logAuthFailure("Customer signup", error);
      submit.disabled = false;
      submit.innerHTML = 'Create account <span aria-hidden="true">→</span>';
      return;
    }

    const profileDraft = { name, email: user.email || email, mobile };
    try {
      await updateProfile(user, { displayName: name });
    } catch (error) {
      logAuthFailure("Customer profile name update", error);
    }
    try {
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        ...profileDraft,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      logAuthFailure("Customer profile save", error);
    }

    setMessage("Your account has been created successfully!", true);
    window.location.assign("index.html?notice=signup-success");
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
    try {
      const data = new FormData(signinForm);
      await signInWithEmailAndPassword(auth, normalizeEmail(data.get("email")), data.get("password"));
      window.location.assign(customerDestination());
    } catch (error) {
      setMessage(friendlyError(error));
      logAuthFailure("Customer sign-in", error);
      submit.disabled = false;
      submit.innerHTML = 'Sign in <span aria-hidden="true">→</span>';
    }
  });
}

const adminLoginForm = document.getElementById("admin-login-form");
if (adminLoginForm) {
  if (new URLSearchParams(window.location.search).get("passwordChanged") === "1") {
    setMessage("Your password was updated. Sign in with your new password.", true);
  }
  adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!adminLoginForm.reportValidity()) return;
    if (!isFirebaseConfigured || !auth || !functions) {
      setMessage("Firebase could not be initialized. Check the Web App configuration and setup instructions in README.md.", false);
      return;
    }
    const submit = adminLoginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Verifying access…";
    setMessage("");
    try {
      const data = new FormData(adminLoginForm);
      const login = httpsCallable(functions, "adminSignInWithUsername");
      const response = await login({
        username: data.get("username").trim(),
        password: data.get("password")
      });
      if (typeof response.data?.token !== "string" || !response.data.token) {
        throw new Error("Administrator sign-in returned an invalid response.");
      }
      await signInWithCustomToken(auth, response.data.token);
      const token = await auth.currentUser.getIdTokenResult(true);
      if (token.claims.admin !== true) {
        await signOut(auth);
        setMessage("This account is not authorized for administrator access.");
        submit.disabled = false;
        submit.innerHTML = 'Admin sign in <span aria-hidden="true">→</span>';
        return;
      }
      window.location.assign(token.claims.mustChangePassword === true
        ? "admin-change-password.html"
        : "admin-dashboard.html");
    } catch (error) {
      setMessage(friendlyError(error));
      logAuthFailure("Administrator sign-in", error);
      submit.disabled = false;
      submit.innerHTML = 'Admin sign in <span aria-hidden="true">→</span>';
    }
  });
}

const adminPasswordForm = document.getElementById("admin-password-form");
if (adminPasswordForm) {
  let adminUser = null;
  let mustChangePassword = false;
  const voluntaryMode = new URLSearchParams(window.location.search).get("mode") === "change";
  const currentPasswordField = document.getElementById("current-password-field");
  const currentPasswordInput = adminPasswordForm.elements.currentPassword;
  if (!isFirebaseConfigured) {
    setMessage("Firebase is not configured yet. Follow the setup instructions in README.md.", false);
  } else {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.replace("admin-login.html");
        return;
      }
      try {
        const token = await user.getIdTokenResult();
        if (token.claims.admin !== true) {
          await signOut(auth);
          window.location.replace("admin-login.html");
          return;
        }
        mustChangePassword = token.claims.mustChangePassword === true;
        if (!mustChangePassword && !voluntaryMode) {
          window.location.replace("admin-dashboard.html");
          return;
        }
        currentPasswordField.hidden = mustChangePassword;
        currentPasswordInput.required = !mustChangePassword;
        adminUser = user;
      } catch (error) {
        setMessage("Administrator access could not be verified. Sign in again.", false);
        console.error("Could not verify administrator password-change access", error);
      }
    });
  }
  adminPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!adminPasswordForm.reportValidity()) return;
    if (!isFirebaseConfigured || !adminUser) {
      setMessage("Administrator access could not be verified. Sign in again.", false);
      return;
    }
    const password = adminPasswordForm.elements.password.value;
    if (password !== adminPasswordForm.elements.confirmPassword.value) {
      setMessage("Your new passwords do not match.", false);
      adminPasswordForm.elements.confirmPassword.focus();
      return;
    }
    if (password.length < 12) {
      setMessage("Choose a new password with at least 12 characters.", false);
      adminPasswordForm.elements.password.focus();
      return;
    }
    const submit = adminPasswordForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Updating password…";
    setMessage("");
    try {
      if (!mustChangePassword) {
        if (!adminUser.email) throw new Error("The administrator account has no email address for secure reauthentication.");
        await reauthenticateWithCredential(
          adminUser,
          EmailAuthProvider.credential(adminUser.email, adminPasswordForm.elements.currentPassword.value)
        );
        await updatePassword(adminUser, password);
      } else {
        await httpsCallable(functions, "completeAdminPasswordChange")({ newPassword: password });
        window.location.replace("admin-login.html?passwordChanged=1");
        return;
      }
      window.location.assign("admin-dashboard.html");
    } catch (error) {
      setMessage(friendlyError(error), false);
      submit.disabled = false;
      submit.textContent = "Update password";
      console.error("Could not complete the required administrator password change", error);
    }
  });
}

const accountName = document.getElementById("account-name");
if (accountName) {
  const accountMessage = document.getElementById("account-message");
  if (!isFirebaseConfigured) {
    accountMessage.textContent = "Firebase is not configured. Follow the setup instructions in README.md.";
    document.getElementById("account-orders").textContent = "Order history is available after Firebase setup.";
  } else {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (!window.__wellexsaLogoutInProgress) {
          window.location.replace("signin.html?return=account.html");
        }
        return;
      }
      try {
        const profile = await getDoc(doc(db, "users", user.uid));
        const data = profile.exists() ? profile.data() : {};
        const name = data.name || user.displayName || "there";
        accountName.textContent = name.split(" ")[0];
        document.getElementById("profile-name").textContent = data.name || user.displayName || "—";
        document.getElementById("profile-email").textContent = data.email || user.email || "—";
        document.getElementById("profile-mobile").textContent = data.mobile || user.phoneNumber || "—";
        const orderTarget = document.getElementById("account-orders");
        if (orderTarget) {
          const userOrders = query(collection(db, "orders"), where("userId", "==", user.uid));
          onSnapshot(userOrders, (snapshot) => {
            orderTarget.replaceChildren();
            if (snapshot.empty) {
              const empty = document.createElement("p");
              empty.className = "details-error";
              empty.textContent = "Your order history will appear here after you complete checkout.";
              orderTarget.append(empty);
              return;
            }
            const sortedOrders = snapshot.docs.slice().sort((a, b) =>
              (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0)
            );
            sortedOrders.forEach((orderDocument) => {
              const order = orderDocument.data();
              const card = document.createElement("article");
              card.className = "order-card";
              const title = document.createElement("strong");
              title.textContent = `Order ${orderDocument.id}`;
              const items = document.createElement("p");
              items.textContent = (order.items || []).map((item) => {
                const selectedOption = item.batteryOption
                  ? ` (${item.batteryOption.batteryType} · ${item.batteryOption.range})`
                  : "";
                return `${item.name}${selectedOption} × ${item.quantity}`;
              }).join(", ");
              const amount = document.createElement("p");
              amount.textContent = `Total: ₹${Number(order.totalAmount || 0).toLocaleString("en-IN")}`;
              const payment = document.createElement("p");
              payment.textContent = `Payment: ${order.paymentStatus === "captured" ? "Payment Successful" : order.paymentStatus || "Pending"}`;
              const fulfillment = document.createElement("p");
              fulfillment.textContent = `Order status: ${order.orderStatus || "Pending"}`;
              const time = document.createElement("p");
              time.textContent = order.createdAt?.toDate?.().toLocaleString("en-IN") || "";
              card.append(title, items, amount, payment, fulfillment, time);
              orderTarget.append(card);
            });
          }, (error) => {
            orderTarget.textContent = "Your order history could not be loaded.";
            console.error("Could not load customer orders", error);
          });
        }
      } catch (error) {
        accountMessage.textContent = "Your account is signed in, but your profile could not be loaded. Please refresh or contact the showroom.";
        console.error("Could not load customer profile", error);
      }

      if (isFirebaseConfigured) {
        const cartCount = document.querySelector(".cart-count");
        if (cartCount) {
          try {
            const cart = JSON.parse(localStorage.getItem("wellexsa-cart-v1") || "[]");
            cartCount.textContent = String(Array.isArray(cart) ? cart.reduce((total, item) => total + (Number(item.quantity) || 0), 0) : 0);
          } catch (error) {
            console.warn("Could not read cart badge", error);
          }
        }
      }
    });
  }
}

