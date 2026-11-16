import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { auth, isFirebaseConfigured } from "./firebase-config.js";

const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector(".main-nav");

if (menuButton && nav) {
  menuButton.addEventListener("click", () => {
    const expanded = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!expanded));
    menuButton.setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
    nav.classList.toggle("is-open", !expanded);
  });

  nav.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("a")) return;
    nav.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
  });

  const signinPath = new URL("signin.html", window.location.href).pathname;
  const loginLink = [...nav.querySelectorAll("a")].find((link) => {
    return new URL(link.href, window.location.href).pathname === signinPath;
  }) || document.createElement("a");
  loginLink.href = "signin.html";
  loginLink.textContent = "Login";
  loginLink.classList.remove("nav-account");
  loginLink.classList.add("nav-auth-link");

  const authControls = document.createElement("div");
  authControls.className = "nav-auth-controls";

  const signupLink = document.createElement("a");
  signupLink.href = "signup.html";
  signupLink.className = "nav-auth-link";
  signupLink.textContent = "Sign Up";

  const profileRegion = document.createElement("div");
  profileRegion.className = "nav-profile";

  const profileButton = document.createElement("button");
  profileButton.type = "button";
  profileButton.className = "nav-profile-button";
  profileButton.setAttribute("aria-label", "Open profile menu");
  profileButton.setAttribute("aria-haspopup", "true");
  profileButton.setAttribute("aria-expanded", "false");
  profileButton.setAttribute("aria-controls", "customer-profile-menu");
  profileButton.hidden = true;
  profileButton.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.6"></circle><path d="M5 20c.4-3.5 3.2-5.8 7-5.8s6.6 2.3 7 5.8"></path></svg>';

  const profileMenu = document.createElement("div");
  profileMenu.id = "customer-profile-menu";
  profileMenu.className = "nav-profile-dropdown";
  profileMenu.setAttribute("role", "group");
  profileMenu.setAttribute("aria-label", "Customer profile");
  profileMenu.hidden = true;

  const identity = document.createElement("p");
  identity.className = "nav-profile-identity";
  identity.setAttribute("aria-live", "polite");

  const profileLink = document.createElement("a");
  profileLink.href = "account.html";
  profileLink.textContent = "My Profile";

  const ordersLink = document.createElement("a");
  ordersLink.href = "account.html#orders";
  ordersLink.textContent = "My Orders";

  const feedback = document.createElement("p");
  feedback.className = "nav-profile-feedback";
  feedback.setAttribute("role", "status");
  feedback.hidden = true;

  const logoutButton = document.createElement("button");
  logoutButton.type = "button";
  logoutButton.className = "nav-profile-logout";
  logoutButton.textContent = "Logout";

  profileMenu.append(identity, profileLink, ordersLink, logoutButton, feedback);
  profileRegion.append(profileButton, profileMenu);
  authControls.append(loginLink, signupLink, profileRegion);
  nav.append(authControls);

  function setProfileMenuOpen(open) {
    profileMenu.hidden = !open;
    profileButton.setAttribute("aria-expanded", String(open));
    profileButton.setAttribute("aria-label", open ? "Close profile menu" : "Open profile menu");
  }

  profileButton.addEventListener("click", () => {
    setProfileMenuOpen(profileMenu.hidden);
  });

  document.addEventListener("click", (event) => {
    if (!profileRegion.contains(event.target)) setProfileMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !profileMenu.hidden) {
      setProfileMenuOpen(false);
      profileButton.focus();
    }
  });

  [profileLink, ordersLink].forEach((link) => {
    link.addEventListener("click", () => setProfileMenuOpen(false));
  });

  logoutButton.addEventListener("click", async () => {
    if (!auth) {
      window.location.assign("index.html");
      return;
    }
    logoutButton.disabled = true;
    feedback.hidden = true;
    window.__wellexsaLogoutInProgress = true;
    try {
      await signOut(auth);
      const destination = new URL("index.html", window.location.href);
      destination.searchParams.set("notice", "logout-success");
      window.location.assign(destination.href);
    } catch (error) {
      window.__wellexsaLogoutInProgress = false;
      logoutButton.disabled = false;
      feedback.textContent = "Sign out failed. Please try again.";
      feedback.hidden = false;
      console.error("Customer sign-out failed", {
        code: typeof error?.code === "string" ? error.code : "unknown",
        message: typeof error?.message === "string" ? error.message : "No Firebase error message provided"
      });
    }
  });

  if (isFirebaseConfigured && auth) {
    onAuthStateChanged(auth, (user) => {
      const signedIn = Boolean(user);
      loginLink.hidden = signedIn;
      signupLink.hidden = signedIn;
      profileButton.hidden = !signedIn;
      identity.textContent = user?.displayName || user?.email || "My account";
      if (!signedIn) setProfileMenuOpen(false);
    }, (error) => {
      console.error("Customer auth state listener failed", {
        code: typeof error?.code === "string" ? error.code : "unknown",
        message: typeof error?.message === "string" ? error.message : "No Firebase error message provided"
      });
    });
  }
}

const notice = new URLSearchParams(window.location.search).get("notice");
const homepage = window.location.pathname.endsWith("/index.html") || window.location.pathname === "/";
const noticeText = notice === "signup-success"
  ? "Your account has been created successfully!"
  : notice === "logout-success"
    ? "You have been logged out successfully."
    : null;

if (homepage && noticeText) {
  const toast = document.createElement("div");
  toast.className = "site-toast site-toast-success";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = noticeText;
  document.body.append(toast);

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("notice");
  window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  window.setTimeout(() => toast.remove(), 5000);
}
