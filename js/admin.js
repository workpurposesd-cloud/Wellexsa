import { auth, db, isFirebaseConfigured, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  deleteObject, getDownloadURL, ref, uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { demoScooters, formatPrice } from "./bikes.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const form = document.getElementById("bike-form");
const editor = document.getElementById("bike-editor");
const bikeList = document.getElementById("admin-bike-list");
const formMessage = document.getElementById("bike-form-message");
const dashboardMessage = document.getElementById("dashboard-message");
const publishButton = document.getElementById("publish-button");
const slideForm = document.getElementById("slider-form");
const slideList = document.getElementById("homepage-slide-list");
const slideFormMessage = document.getElementById("slider-form-message");
const slideSaveButton = document.getElementById("slider-save");
const demoModelSelect = document.getElementById("demo-model-select");
const adminActionButtons = ["new-bike-button", "deccan-template-button", "demo-template-button", "add-spec-button", "publish-button", "slider-save"]
  .map((id) => document.getElementById(id));
const maximumImageSize = 10 * 1024 * 1024;
const permittedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
let bikeRecords = new Map();
let slideRecords = new Map();
let orderRecords = new Map();
let activeAdmin = false;
let customerPage = 1;
let customerTotalPages = 1;
let customerRequestId = 0;
let customerSearchTimer = null;
const orderStatuses = ["pending", "processing", "ready_for_delivery", "delivered", "cancelled", "refunded"];
const orderStatusLabels = {
  pending: "Pending",
  processing: "Processing",
  ready_for_delivery: "Ready for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded"
};
const paymentStatusLabels = {
  pending: "Pending",
  captured: "Payment Successful",
  failed: "Failed",
  cancelled: "Cancelled",
  stock_conflict: "Captured — refund review",
  refunded: "Refunded"
};

function notifySliderForm(text, success) {
  slideFormMessage.textContent = text;
  slideFormMessage.classList.toggle("success", Boolean(success));
}

function setAdminActionsEnabled(enabled) {
  adminActionButtons.forEach((button) => { button.disabled = !enabled; });
  demoModelSelect.disabled = !enabled;
}

function setCustomerControlsEnabled(enabled) {
  for (const id of [
    "customer-refresh", "customer-search", "customer-date-from", "customer-date-to",
    "customer-status-filter", "customer-page-size"
  ]) {
    document.getElementById(id).disabled = !enabled;
  }
}

setAdminActionsEnabled(false);
setCustomerControlsEnabled(false);
demoScooters.forEach((bike) => {
  const option = document.createElement("option");
  option.value = bike.id;
  option.textContent = bike.name;
  demoModelSelect.append(option);
});

const notifyForm = (text, success) => {
  formMessage.textContent = text;
  formMessage.classList.toggle("success", Boolean(success));
};

function showAccessError(text) {
  bikeList.replaceChildren();
  const notice = document.createElement("p");
  notice.className = "details-error";
  notice.textContent = text;
  bikeList.append(notice);
}

function validateFiles(files, maximumCount = 8) {
  if (files.length > maximumCount) return `Choose no more than ${maximumCount} image${maximumCount === 1 ? "" : "s"} at a time.`;
  if (files.some((file) => !permittedImageTypes.has(file.type))) return "Use JPG, PNG or WebP image files only.";
  if (files.some((file) => file.size > maximumImageSize)) return "Each image must be 10 MB or smaller.";
  return "";
}

function displayPreview(files, target, existingUrl) {
  target.replaceChildren();
  if (existingUrl) {
    const image = document.createElement("img");
    image.src = existingUrl;
    image.alt = "Current bike image";
    target.append(image);
  }
  for (const file of files) {
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = file.name;
    image.addEventListener("load", () => URL.revokeObjectURL(image.src), { once: true });
    target.append(image);
  }
}

function renderBikeRows() {
  const bikes = Array.from(bikeRecords.values()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  document.getElementById("stat-total").textContent = String(bikes.length);
  document.getElementById("stat-stock").textContent = String(bikes.reduce((sum, bike) => sum + (Number(bike.stockQuantity) || 0), 0));
  document.getElementById("stat-published").textContent = String(bikes.filter((bike) => bike.status === "published").length);
  document.getElementById("stat-out").textContent = String(bikes.filter((bike) => bike.status === "published" && (Number(bike.stockQuantity) || 0) === 0).length);
  const lowStock = bikes.filter((bike) => bike.status === "published" && Number(bike.stockQuantity) > 0 && Number(bike.stockQuantity) <= 3);
  const alert = document.getElementById("low-stock-alert");
  alert.hidden = lowStock.length === 0;
  alert.textContent = lowStock.length ? `Low stock: ${lowStock.map((bike) => `${bike.name} (${bike.stockQuantity})`).join(", ")}` : "";
  bikeList.replaceChildren();
  renderInventory(bikes);
  if (!bikes.length) {
    const empty = document.createElement("p");
    empty.className = "details-error";
    empty.textContent = "Your inventory is empty. Add a bike to publish your first showroom listing.";
    bikeList.append(empty);
    return;
  }
  for (const bike of bikes) {
    const row = document.createElement("article");
    row.className = "admin-bike-row";
    const thumb = document.createElement("img");
    thumb.className = "admin-bike-thumb";
    thumb.alt = bike.name || "Scooter";
    thumb.src = bike.imageUrls?.[0] || "";
    if (!bike.imageUrls?.[0]) thumb.hidden = true;
    thumb.addEventListener("error", () => { thumb.hidden = true; });
    const info = document.createElement("div");
    info.className = "admin-bike-info";
    const name = document.createElement("h3");
    name.textContent = bike.name || "Unnamed scooter";
    const description = document.createElement("p");
    description.textContent = `${bike.brand || "Brand not specified"} · ${bike.model || "Model not specified"} · ${formatPrice(bike.price)} · Stock ${Number(bike.stockQuantity) || 0}`;
    info.append(name, description);
    const actions = document.createElement("div");
    actions.className = "admin-bike-actions";
    const status = document.createElement("span");
    status.className = `status-pill${bike.status === "published" ? " published" : ""}`;
    status.textContent = bike.status === "published" ? (Number(bike.stockQuantity) > 0 ? "Published · In stock" : "Published · Out of stock") : bike.status;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "admin-action";
    edit.dataset.action = "edit";
    edit.dataset.id = bike.id;
    edit.textContent = "Edit";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "admin-action";
    toggle.dataset.action = "toggle";
    toggle.dataset.id = bike.id;
    toggle.textContent = bike.status === "published" ? "Unpublish" : "Publish";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "admin-action danger";
    remove.dataset.action = "delete";
    remove.dataset.id = bike.id;
    remove.textContent = "Archive";
    actions.append(status, edit, toggle, remove);
    row.append(thumb, info, actions);
    bikeList.append(row);
  }
}

function renderSlideRows() {
  slideList.replaceChildren();
  const records = Array.from(slideRecords.values()).sort((a, b) => Number(b.active) - Number(a.active) || a.order - b.order);
  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "details-error";
    empty.textContent = "No homepage slides have been added.";
    slideList.append(empty);
    return;
  }
  records.forEach((slide) => {
    const row = document.createElement("article");
    row.className = "slider-admin-row";
    const image = document.createElement("img");
    image.className = "slider-admin-thumb";
    image.src = slide.imageUrl;
    image.alt = slide.title || "Homepage slide";
    image.addEventListener("error", () => { image.hidden = true; }, { once: true });

    const detail = document.createElement("div");
    detail.className = "slider-admin-detail";
    const title = document.createElement("strong");
    title.textContent = slide.title || "Untitled slide";
    const description = document.createElement("span");
    description.textContent = `Order ${Number(slide.order) || 0} · ${slide.status === "published" ? "Published" : "Draft"} · ${slide.enabled ? "Enabled" : "Disabled"}${slide.active ? " · Starting slide" : ""}`;
    detail.append(title, description);

    const actions = document.createElement("div");
    actions.className = "slider-admin-actions";
    [["edit", "Edit"], ["active", slide.active ? "Starting slide" : "Set as starting"], ["toggle", slide.enabled ? "Disable" : "Enable"], ["delete", "Delete"]]
      .forEach(([action, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `admin-action${action === "delete" ? " danger" : ""}`;
        button.dataset.slideAction = action;
        button.dataset.id = slide.id;
        button.textContent = label;
        button.disabled = action === "active" && slide.active === true;
        actions.append(button);
      });
    row.append(image, detail, actions);
    slideList.append(row);
  });
}

function resetSlideEditor() {
  slideForm.reset();
  slideForm.elements.slideId.value = "";
  const nextOrder = Array.from(slideRecords.values())
    .reduce((maximum, slide) => Math.max(maximum, Number(slide.order) || 0), -1) + 1;
  slideForm.elements.order.value = String(nextOrder);
  slideForm.elements.status.value = "draft";
  slideForm.elements.enabled.checked = true;
  slideForm.elements.active.checked = false;
  document.getElementById("slide-preview").replaceChildren();
  slideSaveButton.textContent = "SAVE SLIDE";
  notifySliderForm("");
}

function openSlideEditor(slide) {
  resetSlideEditor();
  if (slide) {
    slideForm.elements.slideId.value = slide.id;
    slideForm.elements.title.value = slide.title || "";
    slideForm.elements.description.value = slide.description || "";
    slideForm.elements.buttonText.value = slide.buttonText || "";
    slideForm.elements.buttonUrl.value = slide.buttonUrl || "#bikes";
    slideForm.elements.order.value = String(Number(slide.order) || 0);
    slideForm.elements.status.value = slide.status || "draft";
    slideForm.elements.enabled.checked = slide.enabled === true;
    slideForm.elements.active.checked = slide.active === true;
    displayPreview([], document.getElementById("slide-preview"), slide.imageUrl);
    slideSaveButton.textContent = "UPDATE SLIDE";
  }
  slideForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function validSlideDestination(value) {
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "https:" ||
      (url.origin === window.location.origin && ["http:", "file:"].includes(url.protocol));
  } catch {
    return false;
  }
}

async function uploadSlideImage(file, slideId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const path = `homepage-slides/${slideId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
  const imageRef = ref(storage, path);
  await uploadBytes(imageRef, file, { contentType: file.type });
  return { path, url: await getDownloadURL(imageRef) };
}

async function activateSlide(slideId) {
  if (!activeAdmin) return;
  if (slideRecords.size > 490) throw new Error("Too many slides to update the active selection in one operation.");
  const batch = writeBatch(db);
  slideRecords.forEach((slide) => {
    batch.update(doc(db, "homepageSlides", slide.id), {
      active: slide.id === slideId,
      updatedAt: serverTimestamp()
    });
  });
  await batch.commit();
}

function renderInventory(bikes) {
  const inventory = document.getElementById("inventory-list");
  inventory.replaceChildren();
  for (const bike of bikes.filter((entry) => entry.status !== "archived")) {
    const row = document.createElement("div");
    row.className = "inventory-row";
    const name = document.createElement("strong");
    name.textContent = bike.name || "Unnamed scooter";
    const stock = document.createElement("span");
    const quantity = Number(bike.stockQuantity) || 0;
    stock.className = quantity === 0 ? "out-of-stock" : "stock-good";
    stock.textContent = quantity === 0 ? "OUT OF STOCK" : `${quantity} in stock`;
    const adjust = document.createElement("input");
    adjust.type = "number";
    adjust.min = "0";
    adjust.max = "100000";
    adjust.step = "1";
    adjust.value = String(quantity);
    adjust.setAttribute("aria-label", `Available quantity for ${bike.name}`);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "admin-action";
    save.textContent = "Update stock";
    save.addEventListener("click", async () => {
      const next = Number(adjust.value);
      if (!Number.isInteger(next) || next < 0 || next > 100000) {
        window.alert("Enter a whole-number stock quantity from 0 to 100,000.");
        return;
      }
      save.disabled = true;
      try {
        await updateDoc(doc(db, "bikes", bike.id), { stockQuantity: next, updatedAt: serverTimestamp() });
      } catch (error) {
        window.alert("Stock could not be updated. Check Firebase permissions and try again.");
        console.error("Could not update stock", error);
      } finally {
        save.disabled = false;
      }
    });
    row.append(name, stock, adjust, save);
    inventory.append(row);
  }
}

function renderOrders() {
  const allOrders = Array.from(orderRecords.values()).sort((a, b) =>
    (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
  );
  const term = document.getElementById("order-search").value.trim().toLowerCase();
  const statusFilter = document.getElementById("order-status-filter").value;
  const dateFilter = document.getElementById("order-date-filter").value;
  const filtered = allOrders.filter((order) => {
    const text = [order.id, order.customer?.name, order.customer?.phone, order.customer?.email].join(" ").toLowerCase();
    const date = order.createdAt?.toDate?.().toISOString().slice(0, 10) || "";
    return (!term || text.includes(term)) &&
      (!statusFilter || order.paymentStatus === statusFilter) &&
      (!dateFilter || date === dateFilter);
  });
  document.getElementById("stat-orders").textContent = String(allOrders.length);
  document.getElementById("stat-paid").textContent = String(allOrders.filter((order) => order.paymentStatus === "captured").length);
  document.getElementById("stat-pending").textContent = String(allOrders.filter((order) => order.paymentStatus === "pending").length);
  renderOrderList(filtered, document.getElementById("admin-orders"), true);
  renderOrderList(allOrders, document.getElementById("payment-records"), false);
}

function formatCustomerDateTime(value, missingValue) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : missingValue;
}

function renderRecentCustomerLogins(customers) {
  const target = document.getElementById("recent-customer-logins");
  target.replaceChildren();
  if (!customers.length) {
    const empty = document.createElement("p");
    empty.className = "customer-activity-empty";
    empty.textContent = "No customer sign-ins have been recorded yet.";
    target.append(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "customer-recent-login-list";
  customers.forEach((customer) => {
    const item = document.createElement("li");
    const identity = document.createElement("strong");
    identity.textContent = customer.name || customer.email || customer.uid;
    const date = document.createElement("time");
    date.dateTime = customer.lastLoginAt;
    date.textContent = formatCustomerDateTime(customer.lastLoginAt, "Unknown time");
    item.append(identity, date);
    list.append(item);
  });
  target.append(list);
}

function renderCustomerTable(customers, result) {
  const target = document.getElementById("customer-table-body");
  target.replaceChildren();
  if (!customers.length) {
    const row = document.createElement("tr");
    const empty = document.createElement("td");
    empty.colSpan = 7;
    empty.textContent = "No customers match your filters.";
    row.append(empty);
    target.append(row);
  } else {
    const recentThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
    customers.forEach((customer) => {
      const row = document.createElement("tr");
      const registeredTimestamp = Date.parse(customer.registeredAt);
      const isNew = Number.isFinite(registeredTimestamp) && registeredTimestamp >= recentThreshold;
      if (isNew) row.classList.add("is-new");

      const nameCell = document.createElement("td");
      const name = document.createElement("strong");
      name.textContent = customer.name || "Not added";
      nameCell.append(name);
      if (isNew) {
        const badge = document.createElement("span");
        badge.className = "customer-new-badge";
        badge.textContent = "New";
        nameCell.append(badge);
      }

      const emailCell = document.createElement("td");
      if (customer.email) {
        const email = document.createElement("a");
        email.href = `mailto:${customer.email}`;
        email.textContent = customer.email;
        email.setAttribute("aria-label", `Email ${customer.email}`);
        emailCell.append(email);
      } else {
        emailCell.textContent = "Not added";
      }

      const mobileCell = document.createElement("td");
      if (customer.mobile) {
        const phone = document.createElement("a");
        phone.href = `tel:${customer.mobile.replace(/[^\d+]/g, "")}`;
        phone.textContent = customer.mobile;
        phone.setAttribute("aria-label", `Call ${customer.mobile}`);
        mobileCell.append(phone);
      } else {
        mobileCell.textContent = "Not added";
      }

      const registeredCell = document.createElement("td");
      registeredCell.textContent = formatCustomerDateTime(customer.registeredAt, "Unavailable");
      const lastLoginCell = document.createElement("td");
      lastLoginCell.textContent = formatCustomerDateTime(customer.lastLoginAt, "Never signed in");

      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `customer-status-pill ${customer.status === "disabled" ? "disabled" : "active"}`;
      status.textContent = customer.status === "disabled" ? "Disabled" : "Active";
      statusCell.append(status);

      const uidCell = document.createElement("td");
      uidCell.className = "customer-uid";
      uidCell.textContent = customer.uid;
      uidCell.title = customer.uid;

      row.append(nameCell, emailCell, mobileCell, registeredCell, lastLoginCell, statusCell, uidCell);
      target.append(row);
    });
  }

  const start = result.filteredCount ? (result.page - 1) * result.pageSize + 1 : 0;
  const end = Math.min(result.page * result.pageSize, result.filteredCount);
  document.getElementById("customer-pagination-status").textContent =
    `Showing ${start}-${end} of ${result.filteredCount} customers`;
  customerPage = result.page;
  customerTotalPages = result.totalPages;
  document.getElementById("customer-previous-page").disabled = customerPage <= 1;
  document.getElementById("customer-next-page").disabled = customerPage >= customerTotalPages;
}

async function loadCustomers(page = customerPage, forceRefresh = false) {
  if (!activeAdmin) return;
  const requestId = ++customerRequestId;
  const refreshButton = document.getElementById("customer-refresh");
  const target = document.getElementById("customer-table-body");
  const loadingRow = document.createElement("tr");
  const loadingCell = document.createElement("td");
  loadingCell.colSpan = 7;
  loadingCell.textContent = "Loading customer records…";
  loadingRow.append(loadingCell);
  target.replaceChildren(loadingRow);
  document.getElementById("customer-dashboard-message").textContent = "";
  refreshButton.disabled = true;

  try {
    const getCustomers = httpsCallable(getFunctions(), "listAdminCustomers");
    const response = await getCustomers({
      page,
      pageSize: Number(document.getElementById("customer-page-size").value),
      search: document.getElementById("customer-search").value.trim(),
      dateFrom: document.getElementById("customer-date-from").value,
      dateTo: document.getElementById("customer-date-to").value,
      status: document.getElementById("customer-status-filter").value,
      refresh: forceRefresh
    });
    if (requestId !== customerRequestId) return;

    const result = response.data;
    document.getElementById("customer-total").textContent = String(result.totalCustomers);
    document.getElementById("customer-new-registrations").textContent = String(result.newRegistrations);
    renderRecentCustomerLogins(result.recentLogins);
    renderCustomerTable(result.customers, result);
  } catch (error) {
    if (requestId !== customerRequestId) return;
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "Customer records could not be loaded.";
    row.append(cell);
    target.replaceChildren(row);
    document.getElementById("recent-customer-logins").textContent = "Login activity could not be loaded.";
    document.getElementById("customer-dashboard-message").textContent =
      error?.code === "functions/permission-denied"
        ? "Verified administrator access is required to view customer records."
        : "Customer records could not be loaded. Check your connection and try again.";
    console.error("Could not load admin customer records", {
      code: error?.code || "unknown",
      message: typeof error?.message === "string" ? error.message : "No Cloud Function error message provided"
    });
  } finally {
    if (requestId === customerRequestId && activeAdmin) refreshButton.disabled = false;
  }
}

function applyCustomerFilters() {
  customerPage = 1;
  window.clearTimeout(customerSearchTimer);
  customerSearchTimer = window.setTimeout(() => loadCustomers(1), 250);
}

document.getElementById("customer-search").addEventListener("input", applyCustomerFilters);
for (const id of ["customer-date-from", "customer-date-to", "customer-status-filter"]) {
  document.getElementById(id).addEventListener("change", applyCustomerFilters);
}
document.getElementById("customer-page-size").addEventListener("change", () => loadCustomers(1));
document.getElementById("customer-refresh").addEventListener("click", () => loadCustomers(1, true));
document.getElementById("customer-previous-page").addEventListener("click", () => {
  if (customerPage > 1) loadCustomers(customerPage - 1);
});
document.getElementById("customer-next-page").addEventListener("click", () => {
  if (customerPage < customerTotalPages) loadCustomers(customerPage + 1);
});

function renderOrderList(orders, target, withControls) {
  target.replaceChildren();
  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "details-error";
    empty.textContent = "No matching orders.";
    target.append(empty);
    return;
  }
  orders.forEach((order) => {
    const card = document.createElement("article");
    card.className = "order-card";
    const head = document.createElement("div");
    head.className = "order-card-head";
    const title = document.createElement("strong");
    title.textContent = `Order ${order.id}`;
    const created = document.createElement("span");
    created.textContent = order.createdAt?.toDate?.().toLocaleString("en-IN") || "Date unavailable";
    head.append(title, created);
    const details = document.createElement("div");
    details.className = "order-card-details";
    const bikeSummary = (order.items || []).map((item) => {
      const selectedOption = item.batteryOption
        ? ` (${item.batteryOption.batteryType} · ${item.batteryOption.range})`
        : "";
      return `${item.name}${selectedOption} × ${item.quantity}`;
    }).join(", ");
    const lines = [
      `Customer: ${order.customer?.name || "—"} · ${order.customer?.phone || "—"}`,
      `Scooter(s): ${bikeSummary || "—"}`,
      `Amount: ${formatPrice(order.totalAmount)}`,
      `Payment: ${paymentStatusLabels[order.paymentStatus] || order.paymentStatus || "Unknown"}`,
      `Gateway reference: ${order.razorpayPaymentId || "—"}`,
      `Delivery: ${[order.shipping?.address, order.shipping?.city, order.shipping?.state, order.shipping?.postalCode].filter(Boolean).join(", ") || "—"}`
    ];
    lines.forEach((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      details.append(p);
    });
    const footer = document.createElement("div");
    footer.className = "order-card-footer";
    const status = document.createElement("span");
    status.className = "status-pill";
    status.textContent = orderStatusLabels[order.orderStatus] || order.orderStatus || "Pending";
    footer.append(status);
    if (withControls) {
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Update fulfillment status for order ${order.id}`);
      orderStatuses.forEach((key) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = orderStatusLabels[key];
        option.selected = (order.orderStatus || "pending") === key;
        select.append(option);
      });
      const update = document.createElement("button");
      update.type = "button";
      update.className = "admin-action";
      update.textContent = "Update status";
      update.addEventListener("click", async () => {
        update.disabled = true;
        try {
          await httpsCallable(getFunctions(), "updateOrderStatus")({ orderId: order.id, orderStatus: select.value });
        } catch (error) {
          window.alert(error.message || "Order status could not be updated.");
          console.error("Could not update order status", error);
        } finally {
          update.disabled = false;
        }
      });
      footer.append(select, update);
      if (["captured", "stock_conflict"].includes(order.paymentStatus)) {
        const refund = document.createElement("button");
        refund.type = "button";
        refund.className = "admin-action danger";
        const refundPending = order.refundRequested && Number(order.refundRequestedAt) > Date.now() - 60000;
        refund.textContent = refundPending || order.refundId ? "Refund requested" : "Request refund";
        refund.disabled = Boolean(refundPending || order.refundId);
        refund.addEventListener("click", async () => {
          if (!window.confirm(`Request a full Razorpay refund for order ${order.id}?`)) return;
          refund.disabled = true;
          try {
            await httpsCallable(getFunctions(), "requestOrderRefund")({ orderId: order.id });
          } catch (error) {
            refund.disabled = false;
            window.alert(error.message || "Refund request could not be completed.");
            console.error("Could not request payment refund", error);
          }
        });
        footer.append(refund);
      }
    }
    card.append(head, details, footer);
    target.append(card);
  });
}

function addCustomSpec(label, value) {
  const row = document.createElement("div");
  row.className = "custom-spec-row";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 100;
  nameInput.placeholder = "Specification name";
  nameInput.setAttribute("aria-label", "Custom specification name");
  nameInput.value = label || "";
  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.maxLength = 240;
  valueInput.placeholder = "Value";
  valueInput.setAttribute("aria-label", "Custom specification value");
  valueInput.value = value || "";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-spec";
  remove.setAttribute("aria-label", "Remove custom specification");
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());
  row.append(nameInput, valueInput, remove);
  document.getElementById("custom-specs-list").append(row);
}

function resetEditor() {
  form.reset();
  form.elements.bikeId.value = "";
  form.elements.mainImage.required = true;
  document.getElementById("editor-title").textContent = "Add a new bike";
  document.getElementById("main-preview").replaceChildren();
  document.getElementById("gallery-preview").replaceChildren();
  document.getElementById("custom-specs-list").replaceChildren();
  notifyForm("");
}

function openEditor(bike) {
  resetEditor();
  if (bike) {
    document.getElementById("editor-title").textContent = "Edit bike";
    form.elements.bikeId.value = bike.id;
    for (const key of ["name", "price", "model", "brand", "shortDescription", "description", "batteryChemistry", "range", "batteryWarranty", "motor", "topSpeed", "batteryLife", "chargingTime", "loadCapacity", "groundClearance", "wheelbase", "paintFinish", "keylessEntry", "antiTheft", "gpsTracking", "appConnectivity", "ipRating"]) {
      if (bike[key] !== undefined && form.elements[key]) form.elements[key].value = bike[key];
    }
    form.elements.stockQuantity.value = String(Number(bike.stockQuantity) || 0);
    form.elements.mainImage.required = !bike.imageUrls?.[0];
    displayPreview([], document.getElementById("main-preview"), bike.imageUrls?.[0]);
    displayPreview([], document.getElementById("gallery-preview"));
    for (const [label, value] of Object.entries(bike.specifications || {})) addCustomSpec(label, value);
  }
  editor.classList.add("is-open");
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function formValues() {
  const names = ["name", "model", "brand", "shortDescription", "description", "batteryChemistry", "range", "batteryWarranty", "motor", "topSpeed", "batteryLife", "chargingTime", "loadCapacity", "groundClearance", "wheelbase", "paintFinish", "keylessEntry", "antiTheft", "gpsTracking", "appConnectivity", "ipRating"];
  const values = {};
  for (const key of names) values[key] = form.elements[key].value.trim();
  values.price = Number(form.elements.price.value);
  values.stockQuantity = Number(form.elements.stockQuantity.value);
  values.specifications = {};
  document.querySelectorAll(".custom-spec-row").forEach((row) => {
    const [label, value] = row.querySelectorAll("input");
    if (label.value.trim() && value.value.trim()) values.specifications[label.value.trim()] = value.value.trim();
  });
  return values;
}

async function uploadImage(file, bikeId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const path = `bike-images/${bikeId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
  const imageRef = ref(storage, path);
  await uploadBytes(imageRef, file, { contentType: file.type });
  return { path, url: await getDownloadURL(imageRef) };
}

document.getElementById("new-bike-button").addEventListener("click", () => {
  if (!activeAdmin) return;
  openEditor();
});
document.querySelector('.dashboard-nav a[href="#bike-editor"]').addEventListener("click", (event) => {
  event.preventDefault();
  if (!activeAdmin) return;
  openEditor();
});
document.getElementById("editor-close").addEventListener("click", () => {
  editor.classList.remove("is-open");
});
document.getElementById("add-spec-button").addEventListener("click", () => addCustomSpec("", ""));
document.getElementById("deccan-template-button").addEventListener("click", () => {
  if (!activeAdmin) return;
  const defaults = {
    name: "DECCAN R – RAYA FLUX",
    price: "89999",
    stockQuantity: "10",
    brand: "DECCAN R",
    model: "RAYA FLUX",
    shortDescription: "A considered electric ride with LFP battery technology and everyday-ready performance.",
    description: "Meet the DECCAN R – RAYA FLUX. Contact WELLEXSA MOTORS for availability, a test ride and further details.",
    batteryChemistry: "Lithium Iron Phosphate (LFP)",
    range: "120 KM",
    batteryWarranty: "3 Years",
    motor: "Premium BLDC hub motor with enhanced torque",
    topSpeed: "45 KM/H (regulated)",
    batteryLife: "2,500+ charge cycles (A+ Grade cells)",
    chargingTime: "4–5 hours (0–100%)",
    loadCapacity: "130 KG",
    groundClearance: "170 MM",
    wheelbase: "1,340 MM",
    paintFinish: "Premium metallic paint with anti-scratch coating",
    keylessEntry: "QR code scan technology",
    antiTheft: "Motion sensor alarm and GPS tracking",
    gpsTracking: "Included with anti-theft system",
    appConnectivity: "Battery monitoring, diagnostics and remote features",
    ipRating: "IP67 — water and dust resistant"
  };
  for (const [key, value] of Object.entries(defaults)) form.elements[key].value = value;
  notifyForm("DECCAN R details filled in. Upload the original three-angle product image before publishing.", true);
});

document.getElementById("demo-template-button").addEventListener("click", () => {
  if (!activeAdmin) return;
  const sample = demoScooters.find((bike) => bike.id === demoModelSelect.value);
  if (!sample) {
    notifyForm("Choose a WELLEXSA demo model to load its sample specifications.");
    demoModelSelect.focus();
    return;
  }
  openEditor();
  for (const key of ["name", "model", "brand", "shortDescription", "description", "batteryChemistry", "range", "motor", "topSpeed", "chargingTime"]) {
    form.elements[key].value = sample[key] || "";
  }
  form.elements.price.value = "";
  form.elements.stockQuantity.value = "0";
  form.elements.batteryWarranty.value = "";
  form.elements.mainImage.required = true;
  Object.entries(sample.specifications).forEach(([label, value]) => addCustomSpec(label, value));
  notifyForm("Sample specs loaded for editing. Verify every value and add a real price, warranty, stock level and product photo before publishing.", true);
});

for (const [inputName, previewId, isMain] of [["mainImage", "main-preview", true], ["galleryImages", "gallery-preview", false]]) {
  form.elements[inputName].addEventListener("change", () => {
    const files = Array.from(form.elements[inputName].files);
    const error = validateFiles(files, isMain ? 1 : 7);
    if (error) {
      form.elements[inputName].value = "";
      notifyForm(error);
      return;
    }
    const bike = bikeRecords.get(form.elements.bikeId.value);
    displayPreview(files, document.getElementById(previewId), isMain && !files.length ? bike?.imageUrls?.[0] : "");
  });
}

slideForm.elements.images.addEventListener("change", () => {
  const files = Array.from(slideForm.elements.images.files);
  const editing = Boolean(slideForm.elements.slideId.value);
  const error = validateFiles(files, editing ? 1 : 8);
  if (error) {
    slideForm.elements.images.value = "";
    notifySliderForm(error);
    return;
  }
  const current = slideRecords.get(slideForm.elements.slideId.value);
  displayPreview(files, document.getElementById("slide-preview"), files.length ? "" : current?.imageUrl);
});

document.getElementById("slider-reset").addEventListener("click", resetSlideEditor);

slideList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-slide-action]");
  if (!button || !activeAdmin) return;
  const slide = slideRecords.get(button.dataset.id);
  if (!slide) return;
  const action = button.dataset.slideAction;
  if (action === "edit") {
    openSlideEditor(slide);
    return;
  }
  if (action === "delete" && !window.confirm(`Delete the homepage slide “${slide.title}”?`)) return;
  button.disabled = true;
  try {
    if (action === "active") {
      await activateSlide(slide.id);
      dashboardMessage.textContent = "The homepage starting slide has been updated.";
    } else if (action === "toggle") {
      await updateDoc(doc(db, "homepageSlides", slide.id), {
        enabled: !slide.enabled,
        updatedAt: serverTimestamp()
      });
      dashboardMessage.textContent = `Slide ${slide.enabled ? "disabled" : "enabled"}.`;
    } else if (action === "delete") {
      await deleteDoc(doc(db, "homepageSlides", slide.id));
      try {
        await deleteObject(ref(storage, slide.imagePath));
        dashboardMessage.textContent = "Homepage slide and image deleted.";
      } catch (error) {
        dashboardMessage.textContent = "Slide deleted, but its Storage image could not be removed. Check Firebase Storage.";
        console.error("Could not remove homepage slide image", error);
      }
    }
    dashboardMessage.classList.add("success");
  } catch (error) {
    dashboardMessage.classList.remove("success");
    dashboardMessage.textContent = "The slide could not be updated. Check Firebase access and try again.";
    console.error("Could not update homepage slide", error);
  } finally {
    button.disabled = false;
  }
});

slideForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeAdmin) {
    notifySliderForm("Administrator access is required before managing homepage slides.");
    return;
  }
  if (!slideForm.reportValidity()) return;

  const slideId = slideForm.elements.slideId.value;
  const current = slideRecords.get(slideId);
  const files = Array.from(slideForm.elements.images.files);
  const fileError = validateFiles(files, slideId ? 1 : 8);
  if (fileError) {
    notifySliderForm(fileError);
    return;
  }
  if (!files.length && !current?.imageUrl) {
    notifySliderForm("Upload at least one banner image before saving.");
    slideForm.elements.images.focus();
    return;
  }
  const baseOrder = Number(slideForm.elements.order.value);
  if (!Number.isInteger(baseOrder) || baseOrder < 0 || baseOrder + Math.max(0, files.length - 1) > 10000) {
    notifySliderForm("Enter a whole-number slide order from 0 to 10,000.");
    slideForm.elements.order.focus();
    return;
  }
  const buttonUrl = slideForm.elements.buttonUrl.value.trim();
  if (!validSlideDestination(buttonUrl)) {
    notifySliderForm("Use a same-site link or an HTTPS destination.");
    slideForm.elements.buttonUrl.focus();
    return;
  }

  const common = {
    title: slideForm.elements.title.value.trim(),
    description: slideForm.elements.description.value.trim(),
    buttonText: slideForm.elements.buttonText.value.trim(),
    buttonUrl,
    enabled: slideForm.elements.enabled.checked,
    active: slideForm.elements.active.checked,
    status: slideForm.elements.status.value
  };
  slideSaveButton.disabled = true;
  slideSaveButton.textContent = "UPLOADING AND SAVING…";
  notifySliderForm("");
  const uploaded = [];
  let cleanupWarning = false;
  try {
    const records = [];
    for (let index = 0; index < Math.max(files.length, 1); index += 1) {
      const id = slideId || doc(collection(db, "homepageSlides")).id;
      const image = files[index] ? await uploadSlideImage(files[index], id) : null;
      if (image) uploaded.push(image);
      const title = !slideId && index > 0
        ? `${common.title} ${index + 1}`.slice(0, 120)
        : common.title;
      records.push({
        id,
        data: {
          ...common,
          title,
          active: common.active && index === 0,
          order: baseOrder + index,
          imageUrl: image?.url || current.imageUrl,
          imagePath: image?.path || current.imagePath,
          createdAt: current?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      });
    }

    const batch = writeBatch(db);
    if (common.active) {
      slideRecords.forEach((slide) => {
        if (slide.id !== slideId) {
          batch.update(doc(db, "homepageSlides", slide.id), {
            active: false,
            updatedAt: serverTimestamp()
          });
        }
      });
    }
    records.forEach(({ id, data }) => batch.set(doc(db, "homepageSlides", id), data));
    await batch.commit();

    const replacedPath = slideId && files.length && current?.imagePath ? current.imagePath : "";
    if (replacedPath) {
      try {
        await deleteObject(ref(storage, replacedPath));
      } catch (error) {
        cleanupWarning = true;
        console.error("Could not remove replaced homepage slide image", error);
      }
    }
    resetSlideEditor();
    dashboardMessage.textContent = cleanupWarning
      ? "Slide saved, but its replaced image could not be removed from Storage."
      : records.length > 1 ? `${records.length} homepage slides saved.` : "Homepage slide saved.";
    dashboardMessage.classList.add("success");
  } catch (error) {
    const cleanupResults = await Promise.allSettled(uploaded.map((image) => deleteObject(ref(storage, image.path))));
    if (cleanupResults.some((result) => result.status === "rejected")) {
      console.error("Some failed homepage slide uploads could not be removed", cleanupResults);
    }
    notifySliderForm(error.code === "storage/unauthorized" || error.code === "permission-denied"
      ? "Firebase denied this slide update. Verify the admin claim and deployed rules."
      : "The homepage slide could not be saved. Check your connection and Firebase setup, then try again.");
    console.error("Could not save homepage slide", error);
  } finally {
    slideSaveButton.disabled = false;
    slideSaveButton.textContent = slideForm.elements.slideId.value ? "UPDATE SLIDE" : "SAVE SLIDE";
  }
});

bikeList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !activeAdmin) return;
  const bike = bikeRecords.get(button.dataset.id);
  if (!bike) return;
  if (button.dataset.action === "edit") {
    openEditor(bike);
    return;
  }
  button.disabled = true;
  if (button.dataset.action === "toggle") {
    const status = bike.status === "published" ? "draft" : "published";
    if (status === "draft" && !window.confirm(`Unpublish “${bike.name}”? It will no longer appear on the public website.`)) {
      button.disabled = false;
      return;
    }
    try {
      await updateDoc(doc(db, "bikes", bike.id), { status, updatedAt: serverTimestamp() });
    } catch (error) {
      button.disabled = false;
      window.alert("The listing could not be updated. Check your connection and Firebase permissions, then try again.");
      console.error("Could not change listing status", error);
    }
  }
  if (button.dataset.action === "delete") {
    if (!window.confirm(`Archive “${bike.name}”? It will be removed from active listings while historical orders remain available.`)) {
      button.disabled = false;
      return;
    }
    try {
      await updateDoc(doc(db, "bikes", bike.id), { status: "archived", stockQuantity: 0, updatedAt: serverTimestamp() });
    } catch (error) {
      button.disabled = false;
      window.alert("The listing could not be deleted. Check your connection and Firebase permissions, then try again.");
      console.error("Could not delete listing", error);
    }
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeAdmin) {
    notifyForm("Administrator access is required before managing inventory.");
    return;
  }
  if (!form.reportValidity()) return;
  const id = form.elements.bikeId.value;
  const current = bikeRecords.get(id);
  const mainFiles = Array.from(form.elements.mainImage.files);
  const galleryFiles = Array.from(form.elements.galleryImages.files);
  const allFiles = [...mainFiles, ...galleryFiles];
  const fileError = validateFiles(mainFiles, 1) ||
    validateFiles(galleryFiles, 7) ||
    validateFiles(allFiles);
  if (fileError) {
    notifyForm(fileError);
    return;
  }
  const values = formValues();
  if (!Number.isFinite(values.price) || values.price <= 0) {
    notifyForm("Enter a selling price greater than zero.");
    form.elements.price.focus();
    return;
  }
  if (!Number.isInteger(values.stockQuantity) || values.stockQuantity < 0 || values.stockQuantity > 100000) {
    notifyForm("Enter a whole-number stock quantity from 0 to 100,000.");
    form.elements.stockQuantity.focus();
    return;
  }
  if (!mainFiles.length && !current?.imageUrls?.[0]) {
    notifyForm("Upload a main bike image before publishing.");
    form.elements.mainImage.focus();
    return;
  }
  const bikeId = id || doc(collection(db, "bikes")).id;
  publishButton.disabled = true;
  publishButton.textContent = "Uploading images and publishing…";
  notifyForm("");
  const uploaded = [];
  try {
    for (const file of allFiles) uploaded.push(await uploadImage(file, bikeId));
    const oldUrls = current?.imageUrls || [];
    const oldPaths = current?.imagePaths || [];
    const imageUrls = mainFiles.length
      ? [uploaded[0].url, ...oldUrls.slice(1)]
      : [...oldUrls];
    const imagePaths = mainFiles.length
      ? [uploaded[0].path, ...oldPaths.slice(1)]
      : [...oldPaths];
    const galleryStart = mainFiles.length ? 1 : 0;
    if (galleryFiles.length) {
      imageUrls.splice(1);
      imagePaths.splice(1);
    }
    uploaded.slice(galleryStart).forEach((image) => {
      imageUrls.push(image.url);
      imagePaths.push(image.path);
    });
    const payload = {
      ...values,
      imageUrls,
      imagePaths,
      status: "published",
      createdAt: current?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "bikes", bikeId), payload);
    const retainedPaths = new Set(imagePaths);
    const removedPaths = oldPaths.filter((path) => !retainedPaths.has(path));
    const cleanupResults = await Promise.allSettled(removedPaths.map((path) => deleteObject(ref(storage, path))));
    editor.classList.remove("is-open");
    resetEditor();
    dashboardMessage.textContent = cleanupResults.some((result) => result.status === "rejected")
      ? "Bike published. One or more replaced images could not be removed from storage; check Firebase Storage."
      : "Bike saved and published successfully.";
    dashboardMessage.classList.add("success");
    if (cleanupResults.some((result) => result.status === "rejected")) {
      console.error("Some replaced images could not be removed from Firebase Storage", cleanupResults);
    }
  } catch (error) {
    const cleanupResults = await Promise.allSettled(uploaded.map((image) => deleteObject(ref(storage, image.path))));
    if (cleanupResults.some((result) => result.status === "rejected")) {
      console.error("Some incomplete upload files could not be removed", cleanupResults);
    }
    notifyForm(error.code === "storage/unauthorized" || error.code === "permission-denied"
      ? "Firebase denied this update. Verify that this account has the admin claim and the deployed Firestore and Storage rules allow admin writes."
      : "The bike could not be published. Check your connection and Firebase setup, then try again.");
    console.error("Could not publish bike", error);
  } finally {
    publishButton.disabled = false;
    publishButton.innerHTML = 'SAVE &amp; PUBLISH BIKE <span aria-hidden="true">↗</span>';
  }
});

async function logoutAdmin() {
  const logoutButton = document.getElementById("logout-button");
  if (!auth) {
    window.location.assign("index.html");
    return;
  }
  logoutButton.disabled = true;
  try {
    await signOut(auth);
    window.location.assign("index.html");
  } catch (error) {
    logoutButton.disabled = false;
    window.alert("Sign out failed. Please try again.");
    console.error("Admin sign out failed", error);
  }
}

document.getElementById("logout-button").addEventListener("click", logoutAdmin);
document.getElementById("admin-nav-logout").addEventListener("click", (event) => {
  event.preventDefault();
  logoutAdmin();
});

if (!isFirebaseConfigured) {
  showAccessError("Firebase is not configured. Complete the project setup in README.md before using the admin dashboard.");
  for (const id of ["admin-orders", "payment-records"]) {
    const target = document.getElementById(id);
    target.replaceChildren();
    const notice = document.createElement("p");
    notice.className = "details-error";
    notice.textContent = "Connect Firebase to load secure showroom data.";
    target.append(notice);
  }
  const unavailableCustomerRow = document.createElement("tr");
  const unavailableCustomerCell = document.createElement("td");
  unavailableCustomerCell.colSpan = 7;
  unavailableCustomerCell.textContent = "Connect Firebase to load customer records.";
  unavailableCustomerRow.append(unavailableCustomerCell);
  document.getElementById("customer-table-body").replaceChildren(unavailableCustomerRow);
  document.getElementById("recent-customer-logins").textContent = "Connect Firebase to load login activity.";
  document.getElementById("customer-dashboard-message").textContent =
    "Connect Firebase before viewing customer information.";
  document.getElementById("customer-total").textContent = "—";
  document.getElementById("customer-new-registrations").textContent = "—";
  document.getElementById("customer-pagination-status").textContent = "Customer data is unavailable.";
  slideList.replaceChildren();
  const slideNotice = document.createElement("p");
  slideNotice.className = "details-error";
  slideNotice.textContent = "Connect Firebase to manage homepage slides.";
  slideList.append(slideNotice);
  slideSaveButton.disabled = true;
  dashboardMessage.textContent = "Connect Firebase before managing showroom inventory or viewing live business data.";
  ["stat-total", "stat-stock", "stat-published", "stat-out", "stat-orders", "stat-paid", "stat-pending"]
    .forEach((id) => { document.getElementById(id).textContent = "—"; });
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
      if (token.claims.mustChangePassword === true) {
        window.location.replace("admin-change-password.html");
        return;
      }
      activeAdmin = true;
      setAdminActionsEnabled(true);
      setCustomerControlsEnabled(true);
      loadCustomers(1);
      onSnapshot(collection(db, "bikes"), (snapshot) => {
        bikeRecords = new Map(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
        renderBikeRows();
      }, (error) => {
        showAccessError("Inventory could not be loaded. Verify your Firebase configuration and administrator permissions.");
        console.error("Could not load admin inventory", error);
      });
      onSnapshot(collection(db, "homepageSlides"), (snapshot) => {
        slideRecords = new Map(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
        renderSlideRows();
      }, (error) => {
        slideList.textContent = "Homepage slides could not be loaded. Verify your Firebase configuration and administrator permissions.";
        console.error("Could not load homepage slides", error);
      });
      for (const id of ["order-search", "order-status-filter", "order-date-filter"]) {
        document.getElementById(id).addEventListener("input", renderOrders);
      }
      onSnapshot(collection(db, "orders"), (snapshot) => {
        orderRecords = new Map(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
        renderOrders();
      }, (error) => {
        document.getElementById("admin-orders").textContent = "Orders could not be loaded.";
        console.error("Could not load orders", error);
      });
    } catch (error) {
      showAccessError("Administrator access could not be verified. Sign in again or contact your Firebase project administrator.");
      console.error("Could not verify admin role", error);
    }
  });
}
