import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { auth, isFirebaseConfigured } from "./firebase-config.js";
import { readCart } from "./bikes.js";

const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector(".main-nav");
const header = document.querySelector(".site-header");
const cartLink = document.querySelector(".nav-cart");
const mobileNavigation = window.matchMedia("(max-width: 767px)");
const cartCount = readCart().reduce((total, item) => total + item.quantity, 0);

document.querySelectorAll(".cart-count").forEach((counter) => {
  counter.textContent = String(cartCount);
});

function closeProfileMenu() {
  const profileButton = header?.querySelector(".nav-profile-button");
  const profileMenu = header?.querySelector(".nav-profile-dropdown");
  if (profileMenu) profileMenu.hidden = true;
  profileButton?.setAttribute("aria-expanded", "false");
}

if (menuButton && nav) {
  menuButton.addEventListener("click", () => {
    const expanded = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!expanded));
    menuButton.setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
    nav.classList.toggle("is-open", !expanded);
    if (expanded) closeProfileMenu();
  });

  nav.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("a")) return;
    nav.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");
    closeProfileMenu();
  });
}

if (header && !header.querySelector(".nav-profile")) {
  const profileRegion = document.createElement("div");
  profileRegion.className = "nav-profile";
  profileRegion.dataset.authState = "loading";

  const profileButton = document.createElement("button");
  profileButton.type = "button";
  profileButton.className = "nav-profile-button";
  profileButton.setAttribute("aria-label", "Checking account status");
  profileButton.setAttribute("aria-haspopup", "true");
  profileButton.setAttribute("aria-expanded", "false");
  profileButton.setAttribute("aria-controls", "customer-profile-menu");
  profileButton.disabled = true;

  const profileLabel = document.createElement("span");
  profileLabel.className = "nav-profile-label";
  profileLabel.setAttribute("aria-hidden", "true");
  profileLabel.textContent = "Checking…";

  const profileIcon = document.createElement("span");
  profileIcon.className = "nav-profile-icon";
  profileIcon.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="9" r="3"></circle><path d="M6.5 18.5c1.2-2.6 3.1-3.8 5.5-3.8s4.3 1.2 5.5 3.8"></path></svg>';

  const profileStatus = document.createElement("span");
  profileStatus.className = "nav-profile-status";
  profileStatus.setAttribute("role", "img");
  profileStatus.setAttribute("aria-label", "Signed in");
  profileStatus.hidden = true;
  profileIcon.append(profileStatus);
  profileButton.append(profileLabel, profileIcon);

  const profileMenu = document.createElement("div");
  profileMenu.id = "customer-profile-menu";
  profileMenu.className = "nav-profile-dropdown";
  profileMenu.setAttribute("role", "group");
  profileMenu.setAttribute("aria-label", "Customer profile");
  profileMenu.hidden = true;

  const signinLink = document.createElement("a");
  signinLink.href = "signin.html";
  signinLink.className = "nav-profile-link";
  signinLink.textContent = "Sign In";
  signinLink.hidden = true;

  const signupLink = document.createElement("a");
  signupLink.href = "signup.html";
  signupLink.className = "nav-profile-link";
  signupLink.textContent = "Create Account";
  signupLink.hidden = true;

  const identity = document.createElement("p");
  identity.className = "nav-profile-identity";
  identity.setAttribute("aria-live", "polite");
  identity.hidden = true;

  const profileLink = document.createElement("a");
  profileLink.href = "account.html";
  profileLink.className = "nav-profile-link";
  profileLink.textContent = "My Profile";
  profileLink.hidden = true;

  const ordersLink = document.createElement("a");
  ordersLink.href = "account.html#orders";
  ordersLink.className = "nav-profile-link";
  ordersLink.textContent = "My Orders";
  ordersLink.hidden = true;

  const logoutButton = document.createElement("button");
  logoutButton.type = "button";
  logoutButton.className = "nav-profile-logout";
  logoutButton.textContent = "Logout";
  logoutButton.hidden = true;

  const feedback = document.createElement("p");
  feedback.className = "nav-profile-feedback";
  feedback.setAttribute("role", "status");
  feedback.hidden = true;

  profileMenu.append(signinLink, signupLink, identity, profileLink, ordersLink, logoutButton, feedback);
  profileRegion.append(profileButton, profileMenu);
  header.append(profileRegion);

  function updateAuthLinkVisibility() {
    const authState = profileRegion.dataset.authState;
    const signedIn = authState === "signed-in";
    const authReady = authState !== "loading";
    signinLink.hidden = !authReady || signedIn || mobileNavigation.matches;
    signupLink.hidden = !authReady || signedIn;
  }

  function setProfileMenuOpen(open) {
    profileMenu.hidden = !open;
    profileButton.setAttribute("aria-expanded", String(open));
    profileButton.setAttribute("aria-label", open ? "Close account menu" : getProfileButtonLabel());
  }

  function syncHeaderLayout() {
    if (!header || !nav || !cartLink) return;
    if (mobileNavigation.matches) {
      nav.append(cartLink, profileRegion, signupLink);
      signupLink.classList.add("mobile-account-link");
    } else {
      profileMenu.insertBefore(signinLink, identity);
      profileMenu.insertBefore(signupLink, identity);
      signupLink.classList.remove("mobile-account-link");
      header.append(cartLink, profileRegion);
    }
    updateAuthLinkVisibility();
    nav.classList.remove("is-open");
    if (menuButton) {
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open navigation");
    }
    setProfileMenuOpen(false);
  }

  syncHeaderLayout();
  mobileNavigation.addEventListener("change", syncHeaderLayout);

  function getProfileButtonLabel() {
    if (profileRegion.dataset.authState === "loading") return "Checking account status";
    if (profileRegion.dataset.authState === "unavailable") return "Account status unavailable";
    if (profileRegion.dataset.authState === "signed-in") return "My Account, open account menu";
    return mobileNavigation.matches ? "Sign In" : "Sign In, open account menu";
  }

  function renderAuthState(user) {
    const signedIn = Boolean(user);
    profileRegion.dataset.authState = signedIn ? "signed-in" : "signed-out";
    profileButton.disabled = false;
    profileLabel.textContent = signedIn ? "My Account" : "Sign In";
    profileButton.setAttribute("aria-label", getProfileButtonLabel());
    profileStatus.hidden = !signedIn;
    updateAuthLinkVisibility();
    identity.hidden = !signedIn;
    identity.textContent = user?.displayName || user?.email || "My account";
    profileLink.hidden = !signedIn;
    ordersLink.hidden = !signedIn;
    logoutButton.hidden = !signedIn;
    setProfileMenuOpen(false);
  }

  function renderAuthUnavailable() {
    profileRegion.dataset.authState = "unavailable";
    profileButton.disabled = false;
    profileLabel.textContent = "Account";
    profileButton.setAttribute("aria-label", getProfileButtonLabel());
    profileStatus.hidden = true;
    updateAuthLinkVisibility();
    identity.hidden = true;
    profileLink.hidden = true;
    ordersLink.hidden = true;
    logoutButton.hidden = true;
    setProfileMenuOpen(false);
  }

  profileButton.addEventListener("click", () => {
    if (mobileNavigation.matches && profileRegion.dataset.authState !== "signed-in") {
      window.location.assign(signinLink.href);
      return;
    }
    setProfileMenuOpen(profileMenu.hidden);
  });

  document.addEventListener("click", (event) => {
    const openingMobileMenu = mobileNavigation.matches &&
      menuButton?.contains(event.target) && nav?.classList.contains("is-open");
    if (!profileRegion.contains(event.target) && !openingMobileMenu) setProfileMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !profileMenu.hidden) {
      setProfileMenuOpen(false);
      profileButton.focus();
    }
  });

  [signinLink, signupLink, profileLink, ordersLink].forEach((link) => {
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
    onAuthStateChanged(auth, renderAuthState, (error) => {
      console.error("Customer auth state listener failed", {
        code: typeof error?.code === "string" ? error.code : "unknown",
        message: typeof error?.message === "string" ? error.message : "No Firebase error message provided"
      });
      renderAuthUnavailable();
    });
  } else {
    console.error("Customer profile unavailable because Firebase Auth is not configured.");
    renderAuthUnavailable();
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
  const main = document.querySelector("main");
  if (main) main.before(toast);
  else document.body.append(toast);

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("notice");
  window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  window.setTimeout(() => toast.remove(), 3000);
}
