import { auth, db, isFirebaseConfigured } from "./firebase-config.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, doc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const accountPage = document.querySelector(".account-dashboard");
const accountMessage = document.getElementById("account-message");
const profileName = document.getElementById("profile-name");
const profileEmail = document.getElementById("profile-email");
const profileMobile = document.getElementById("profile-mobile");
const accountOrders = document.getElementById("account-orders");
const editProfileButton = document.getElementById("edit-profile-button");
const editForm = document.getElementById("account-edit-form");
const editName = document.getElementById("edit-profile-name");
const editMobile = document.getElementById("edit-profile-mobile");
const editMessage = document.getElementById("account-edit-message");
const saveProfileButton = document.getElementById("save-profile-button");
const accountLogoutButton = document.getElementById("account-logout");

let activeUser = null;
let profileDetails = { name: "", email: "", mobile: "" };
let ordersUnsubscribe = null;
let accountLoadId = 0;

function cleanValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function permissionDenied(error) {
  return error?.code === "permission-denied";
}

function setAccountMessage(text, state = "") {
  accountMessage.textContent = text;
  if (state) accountMessage.dataset.state = state;
  else delete accountMessage.dataset.state;
}

function setEditMessage(text, state = "") {
  editMessage.textContent = text;
  if (state) editMessage.dataset.state = state;
  else delete editMessage.dataset.state;
}

function renderProfile(user, data) {
  profileDetails = {
    name: cleanValue(data.name) || cleanValue(user.displayName),
    email: cleanValue(data.email) || cleanValue(user.email),
    mobile: cleanValue(data.mobile) || cleanValue(user.phoneNumber)
  };

  profileName.textContent = profileDetails.name || "Not added";
  profileEmail.textContent = profileDetails.email || "Not added";
  profileMobile.textContent = profileDetails.mobile || "Not added";

  const firstName = profileDetails.name.split(/\s+/)[0];
  document.getElementById("account-greeting").textContent = firstName
    ? `Welcome back, ${firstName}!`
    : "Welcome back!";
}

function stopOrdersListener() {
  if (!ordersUnsubscribe) return;
  ordersUnsubscribe();
  ordersUnsubscribe = null;
}

function showOrdersEmptyState() {
  const emptyState = document.createElement("div");
  emptyState.className = "account-empty-orders";
  const message = document.createElement("p");
  message.textContent = "You haven't placed any orders yet.";
  const exploreLink = document.createElement("a");
  exploreLink.className = "button button-dark";
  exploreLink.href = "index.html#bikes";
  exploreLink.textContent = "Explore Scooters";
  emptyState.append(message, exploreLink);
  accountOrders.replaceChildren(emptyState);
}

function formatOrderDate(timestamp) {
  try {
    const date = timestamp?.toDate?.();
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "";
  } catch (error) {
    console.warn("Could not format customer order date", error);
    return "";
  }
}

function createOrderCard(orderDocument) {
  const order = orderDocument.data();
  const card = document.createElement("article");
  card.className = "account-order-card";

  const header = document.createElement("div");
  header.className = "account-order-header";
  const title = document.createElement("h3");
  title.textContent = `Order ${orderDocument.id}`;
  const date = document.createElement("p");
  date.textContent = formatOrderDate(order.createdAt);
  header.append(title, date);

  const items = document.createElement("ul");
  items.className = "account-order-items";
  if (Array.isArray(order.items)) {
    order.items.forEach((item) => {
      if (!item || typeof item.name !== "string") return;
      const listItem = document.createElement("li");
      const option = item.batteryOption
        ? ` (${[item.batteryOption.batteryType, item.batteryOption.range].filter(Boolean).join(" · ")})`
        : "";
      listItem.textContent = `${item.name}${option} × ${item.quantity}`;
      items.append(listItem);
    });
  }
  if (!items.childElementCount) {
    const listItem = document.createElement("li");
    listItem.textContent = "Order details unavailable.";
    items.append(listItem);
  }

  const footer = document.createElement("div");
  footer.className = "account-order-footer";
  const total = document.createElement("strong");
  total.textContent = Number.isSafeInteger(order.totalAmount)
    ? `Total: ₹${order.totalAmount.toLocaleString("en-IN")}`
    : "Total unavailable";
  const paymentStatus = cleanValue(order.paymentStatus);
  const payment = document.createElement("span");
  payment.textContent = `Payment: ${paymentStatus === "captured" ? "Successful" : paymentStatus || "Pending"}`;
  const fulfillment = document.createElement("span");
  fulfillment.textContent = `Order status: ${cleanValue(order.orderStatus) || "Pending"}`;
  footer.append(total, payment, fulfillment);

  card.append(header, items, footer);
  return card;
}

function listenForOrders(user) {
  stopOrdersListener();
  accountOrders.replaceChildren(Object.assign(document.createElement("p"), {
    className: "loading-state",
    textContent: "Loading your orders…"
  }));

  const userOrders = query(collection(db, "orders"), where("userId", "==", user.uid));
  ordersUnsubscribe = onSnapshot(userOrders, (snapshot) => {
    if (auth.currentUser?.uid !== user.uid) return;
    if (snapshot.empty) {
      showOrdersEmptyState();
      return;
    }

    const sortedOrders = snapshot.docs.slice().sort((first, second) =>
      (second.data().createdAt?.toMillis?.() || 0) - (first.data().createdAt?.toMillis?.() || 0)
    );
    accountOrders.replaceChildren(...sortedOrders.map(createOrderCard));
  }, (error) => {
    if (auth.currentUser?.uid !== user.uid) return;
    accountOrders.className = "order-list";
    const errorMessage = document.createElement("p");
    errorMessage.className = "account-orders-error";
    errorMessage.textContent = permissionDenied(error)
      ? "You don't have permission to view these orders. Contact the showroom if you believe this is an error."
      : "Your orders couldn't be loaded. Please try again later.";
    accountOrders.replaceChildren(errorMessage);
    console.error("Could not load customer orders", {
      code: error?.code || "unknown",
      message: typeof error?.message === "string" ? error.message : "No Firestore error message provided"
    });
  });
}

async function loadAccount(user) {
  const loadId = ++accountLoadId;
  activeUser = user;
  stopOrdersListener();
  accountPage.dataset.state = "loading";
  setAccountMessage("");
  setEditMessage("");
  editForm.hidden = true;
  editName.value = "";
  editMobile.value = "";
  accountOrders.replaceChildren(Object.assign(document.createElement("p"), {
    className: "loading-state",
    textContent: "Loading your orders…"
  }));
  profileName.textContent = "Loading…";
  profileEmail.textContent = "Loading…";
  profileMobile.textContent = "Loading…";
  editProfileButton.hidden = true;

  let profileSnapshot = null;
  let profileError = null;
  try {
    profileSnapshot = await getDoc(doc(db, "users", user.uid));
  } catch (error) {
    profileError = error;
  }

  if (loadId !== accountLoadId || auth.currentUser?.uid !== user.uid) return;

  const profileData = profileSnapshot?.exists() ? profileSnapshot.data() : {};
  renderProfile(user, profileData);
  accountPage.dataset.state = "ready";
  editProfileButton.hidden = false;
  editProfileButton.disabled = false;
  accountLogoutButton.disabled = false;

  if (profileError) {
    setAccountMessage(permissionDenied(profileError)
      ? "Your account is signed in, but Firestore denied access to the saved profile. You can still try editing it or contact the showroom."
      : "Your account is signed in, but saved profile details couldn't be loaded. You can still try editing your profile.", "error");
    console.error("Could not load customer profile", {
      code: profileError?.code || "unknown",
      message: typeof profileError?.message === "string" ? profileError.message : "No Firestore error message provided"
    });
  } else if (!profileSnapshot.exists()) {
    setAccountMessage("Your saved profile is missing. Add your name and mobile number to complete it.", "info");
  }

  listenForOrders(user);
}

async function saveProfile(event) {
  event.preventDefault();
  const user = activeUser;
  if (!user || !editForm.reportValidity()) return;

  const name = editName.value.trim();
  const mobile = editMobile.value.trim();
  const digits = mobile.replace(/\D/g, "");
  if (name.length < 2) {
    setEditMessage("Enter your full name.", "error");
    editName.focus();
    return;
  }
  if (mobile && (!/^\+?[0-9 ()-]{10,18}$/.test(mobile) || digits.length < 10 || digits.length > 15)) {
    setEditMessage("Enter a valid mobile number with 10 to 15 digits.", "error");
    editMobile.focus();
    return;
  }
  if (auth.currentUser?.uid !== user.uid) {
    setEditMessage("Your sign-in has changed. Refresh the page and try again.", "error");
    return;
  }

  saveProfileButton.disabled = true;
  saveProfileButton.textContent = "Saving…";
  setEditMessage("");

  try {
    const profileRef = doc(db, "users", user.uid);
    await runTransaction(db, async (transaction) => {
      const profileSnapshot = await transaction.get(profileRef);
      if (profileSnapshot.exists()) {
        transaction.update(profileRef, { name, mobile });
        return;
      }
      if (!user.email) throw new Error("A verified email address is required to create your customer profile.");
      transaction.set(profileRef, {
        uid: user.uid,
        name,
        email: user.email,
        mobile,
        createdAt: serverTimestamp()
      });
    });

    let authNameSynced = true;
    try {
      await updateProfile(user, { displayName: name });
    } catch (error) {
      authNameSynced = false;
      console.error("Could not synchronize customer display name", {
        code: error?.code || "unknown",
        message: typeof error?.message === "string" ? error.message : "No Firebase error message provided"
      });
    }

    if (auth.currentUser?.uid !== user.uid || activeUser?.uid !== user.uid) return;
    profileDetails = { ...profileDetails, name, mobile };
    renderProfile(user, profileDetails);
    editForm.hidden = true;
    accountPage.dataset.state = "ready";
    setAccountMessage(
      authNameSynced
        ? "Your profile has been updated."
        : "Your profile was saved, but the sign-in display name could not be synchronized. Please sign in again to retry.",
      authNameSynced ? "success" : "error"
    );
  } catch (error) {
    const message = error.message === "A verified email address is required to create your customer profile."
      ? error.message
      : permissionDenied(error)
        ? "Firestore denied permission to save your profile. Contact the showroom if this continues."
        : "Your profile couldn't be saved. Check your connection and try again.";
    setEditMessage(message, "error");
    console.error("Could not save customer profile", {
      code: error?.code || "unknown",
      message: typeof error?.message === "string" ? error.message : "No Firestore error message provided"
    });
  } finally {
    saveProfileButton.disabled = false;
    saveProfileButton.textContent = "Save changes";
  }
}

editProfileButton.addEventListener("click", () => {
  editName.value = profileDetails.name;
  editMobile.value = profileDetails.mobile;
  setEditMessage("");
  editForm.hidden = false;
  editName.focus();
});

document.getElementById("cancel-profile-edit").addEventListener("click", () => {
  editForm.hidden = true;
  setEditMessage("");
});

editForm.addEventListener("submit", saveProfile);

accountLogoutButton.addEventListener("click", async () => {
  if (!auth || !activeUser) return;
  accountLogoutButton.disabled = true;
  setAccountMessage("");
  window.__wellexsaLogoutInProgress = true;
  try {
    await signOut(auth);
    window.location.replace("signin.html");
  } catch (error) {
    window.__wellexsaLogoutInProgress = false;
    accountLogoutButton.disabled = false;
    setAccountMessage("You couldn't be signed out. Please try again.", "error");
    console.error("Customer sign-out failed", {
      code: error?.code || "unknown",
      message: typeof error?.message === "string" ? error.message : "No Firebase error message provided"
    });
  }
});

if (!isFirebaseConfigured || !auth || !db) {
  accountPage.dataset.state = "error";
  profileName.textContent = "Unavailable";
  profileEmail.textContent = "Unavailable";
  profileMobile.textContent = "Unavailable";
  accountOrders.textContent = "Order history is unavailable until Firebase is configured.";
  setAccountMessage("Firebase account services are unavailable. Please try again later.", "error");
  editProfileButton.disabled = true;
  accountLogoutButton.disabled = true;
} else {
  accountLogoutButton.disabled = true;
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      accountLoadId += 1;
      stopOrdersListener();
      activeUser = null;
      accountOrders.replaceChildren();
      profileName.textContent = "";
      profileEmail.textContent = "";
      profileMobile.textContent = "";
      if (!window.__wellexsaLogoutInProgress) {
        window.location.replace("signin.html?return=account.html");
      }
      return;
    }
    loadAccount(user).catch((error) => {
      if (auth.currentUser?.uid !== user.uid) return;
      accountPage.dataset.state = "error";
      setAccountMessage("Your account couldn't be loaded. Please refresh and try again.", "error");
      console.error("Could not initialize customer account", error);
    });
  });
}
