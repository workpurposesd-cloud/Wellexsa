import { onAuthStateChanged, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, collectionGroup, getDocs, limit, orderBy, query, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { crmAuth, crmDb, crmFunctions } from "./crm-config.js";

const expectedRole = document.body.dataset.crmRole;
const loginUrl = expectedRole === "owner" ? "owner-login.html" : "staff-login.html";
const dialog = document.getElementById("crm-dialog");
const dialogContent = document.getElementById("crm-dialog-content");
const toast = document.getElementById("crm-toast");
const message = document.getElementById("crm-page-message");
const state = {
  role: "",
  session: null,
  customers: [],
  purchases: [],
  intakes: [],
  completedFollowUps: [],
  staff: [],
  models: [],
  audit: [],
  onlineOrders: []
};
let toastTimeout;

const callable = (name) => httpsCallable(crmFunctions, name);
const can = (permission) => state.role === "owner" ||
  Boolean(state.session?.permissions?.includes(permission));
const make = (tag, className = "", value = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value) element.textContent = value;
  return element;
};

function showToast(value, isError = false) {
  toast.textContent = value;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function dateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateText(value, includeTime = false) {
  const date = dateValue(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(date);
}

function indiaDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function statusLabel(status) {
  return ({
    new: "New lead",
    active: "Active",
    purchased: "Purchased",
    not_interested: "Not interested",
    needs_review: "Needs review"
  })[status] || status || "—";
}

function staffLabel(uid) {
  return state.staff.find((member) => member.uid === uid)?.displayName || "Unassigned";
}

function customerSummary(customer) {
  const content = make("div");
  content.append(
    make("strong", "", customer.name || "Unnamed customer"),
    make("small", "", `${customer.email || "No email"} · ${customer.customerType === "existing" ? "Existing" : "New"} · ${dateText(customer.createdAt)}`)
  );
  return content;
}

function appendCell(row, value, className = "") {
  const cell = make("td", className);
  if (value instanceof Node) cell.append(value);
  else cell.textContent = value || "—";
  row.append(cell);
  return cell;
}

function actionButton(label, action, id, extra = {}) {
  const button = make("button", "crm-button crm-button-quiet", label);
  button.type = "button";
  button.dataset.action = action;
  if (id) button.dataset.id = id;
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null) button.dataset[key] = value;
  });
  return button;
}

function addField(form, labelText, name, type = "text", value = "", required = false, className = "") {
  const label = make("label", `crm-field${className ? ` ${className}` : ""}`, labelText);
  const input = make(type === "textarea" ? "textarea" : "input");
  input.name = name;
  if (type !== "textarea") input.type = type;
  input.value = value || "";
  input.required = required;
  if (type === "tel") input.autocomplete = "tel";
  if (type === "email") input.autocomplete = "email";
  label.append(input);
  form.append(label);
  return input;
}

function addSelect(form, labelText, name, options, value = "", required = false, className = "") {
  const label = make("label", `crm-field${className ? ` ${className}` : ""}`, labelText);
  const select = make("select");
  select.name = name;
  select.required = required;
  options.forEach(([text, optionValue]) => {
    const option = new Option(text, optionValue);
    select.add(option);
  });
  select.value = value || "";
  label.append(select);
  form.append(label);
  return select;
}

function addFormMessage(form) {
  const paragraph = make("p", "crm-message");
  paragraph.setAttribute("role", "alert");
  form.append(paragraph);
  return paragraph;
}

function addFormActions(form, submitLabel) {
  const actions = make("div", "crm-form-actions");
  const cancel = make("button", "crm-button crm-button-quiet", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const submit = make("button", "crm-button crm-button-primary", submitLabel);
  submit.type = "submit";
  actions.append(cancel, submit);
  form.append(actions);
  return submit;
}

function openDialog(title, description, form) {
  dialogContent.replaceChildren();
  const heading = make("h2", "", title);
  const intro = make("p", "", description);
  dialogContent.append(heading, intro, form);
  dialog.showModal();
}

function switchTab(name) {
  document.querySelectorAll(".crm-nav [data-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === name);
  });
  document.querySelectorAll(".crm-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === name);
  });
}

function findCustomer(id) {
  return state.customers.find((customer) => customer.id === id);
}

function openCustomerDialog(customer = null) {
  const form = make("form", "crm-dialog-form");
  const name = addField(form, "Customer name", "name", "text", customer?.name, true);
  name.maxLength = 100;
  const phone = addField(form, "Phone number", "phone", "tel", customer?.phone, true);
  phone.maxLength = 32;
  const email = addField(form, "Email (optional)", "email", "email", customer?.email);
  email.maxLength = 254;
  addSelect(form, "Customer type", "customerType", [
    ["New", "new"], ["Existing", "existing"]
  ], customer?.customerType || "new", true);
  const bikeOptions = [["Select bike model", ""], ...state.models.map((model) => [model, model]), ["Other", "Other"]];
  const selectedBike = state.models.includes(customer?.interestedBike) ? customer.interestedBike : "";
  const bike = addSelect(form, "Interested bike (optional)", "interestedBike", bikeOptions, selectedBike);
  const otherBike = addField(form, "Other bike model", "otherBike", "text",
    customer?.interestedBike && !selectedBike ? customer.interestedBike : "");
  otherBike.maxLength = 100;
  otherBike.closest("label").hidden = Boolean(selectedBike) || !customer?.interestedBike;
  bike.addEventListener("change", () => {
    otherBike.closest("label").hidden = bike.value !== "Other";
  });

  if (state.role === "owner") {
    addSelect(form, "Assigned staff member", "assignedStaffUid", [
      ["Unassigned", ""],
      ...state.staff.filter((member) => member.active).map((member) => [member.displayName, member.uid])
    ], customer?.assignedStaffUid || "");
  }
  const formMessage = addFormMessage(form);
  const submit = addFormActions(form, customer ? "Save changes" : "Create customer");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    formMessage.textContent = "";
    const data = new FormData(form);
    const interest = data.get("interestedBike") === "Other"
      ? String(data.get("otherBike")).trim()
      : String(data.get("interestedBike") || "");
    try {
      if (customer) {
        const changes = {
          name: String(data.get("name")),
          phone: String(data.get("phone")),
          email: String(data.get("email")),
          interestedBike: interest,
          customerType: String(data.get("customerType"))
        };
        if (state.role === "owner") changes.assignedStaffUid = String(data.get("assignedStaffUid") || "");
        const result = await callable("crmUpdateCustomer")({ customerId: customer.id, changes });
        if (result.data?.duplicate) {
          formMessage.textContent = "That phone belongs to another customer. The existing record was not changed.";
          return;
        }
      } else {
        const result = await callable("crmCreateCustomer")({
          name: String(data.get("name")),
          phone: String(data.get("phone")),
          email: String(data.get("email")),
          interestedBike: interest,
          customerType: String(data.get("customerType"))
        });
        if (result.data?.duplicate) {
          dialog.close();
          showToast("That phone number already exists. The existing customer record was kept.");
          await loadData();
          switchTab("customers");
          document.getElementById("crm-search").value = String(data.get("phone"));
          renderCustomers();
          return;
        }
      }
      dialog.close();
      showToast(customer ? "Customer details saved." : "Customer added.");
      await loadData();
    } catch (error) {
      formMessage.textContent = error.message || "Could not save this customer.";
    } finally {
      submit.disabled = false;
    }
  });
  openDialog(customer ? "Edit customer" : "Add customer", "Customer details are stored privately in the CRM.", form);
}

function openContactDialog(customer, defaults = {}) {
  const form = make("form", "crm-dialog-form");
  addSelect(form, "Call status", "callStatus", [
    ["Choose status", ""], ...["Answered", "Not Answered", "Switched Off", "Busy", "Wrong Number"].map((item) => [item, item])
  ], defaults.callStatus || "", true);
  const interest = addSelect(form, "Interest status", "interestStatus", [
    ["Choose status", ""],
    ...["Very Interested", "Interested", "Need More Time", "Not Interested", "Already Purchased"].map((item) => [item, item])
  ], defaults.interestStatus || "", true);
  addField(form, "Next follow-up", "nextFollowUpDate", "date", "", false, "crm-date-input");
  const note = addField(form, "Call notes (optional)", "notes", "textarea", "");
  note.maxLength = 2000;
  note.closest("label").classList.add("wide");
  const formMessage = addFormMessage(form);
  const submit = addFormActions(form, "Save contact");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    if (data.get("interestStatus") === "Already Purchased") {
      formMessage.textContent = "Use Mark as Purchased to record the purchase date and offline purchase details.";
      return;
    }
    submit.disabled = true;
    formMessage.textContent = "";
    try {
      await callable("crmLogContact")({
        customerId: customer.id,
        callStatus: data.get("callStatus"),
        interestStatus: data.get("interestStatus"),
        notes: data.get("notes"),
        nextFollowUpDate: data.get("nextFollowUpDate") || null
      });
      dialog.close();
      showToast("Contact history saved.");
      await loadData();
    } catch (error) {
      formMessage.textContent = error.message || "Could not save contact history.";
    } finally {
      submit.disabled = false;
    }
  });
  openDialog(`Log contact · ${customer.name}`, "The server records the staff member and timestamp automatically.", form);
}

async function openContactHistory(customer) {
  const entries = await getDocs(query(
    collection(crmDb, "crmCustomers", customer.id, "contactHistory"),
    orderBy("createdAt", "desc"),
    limit(200)
  ));
  const list = make("div", "crm-compact-list");
  entries.docs.forEach((snapshot) => {
    const item = snapshot.data();
    const row = make("article", "crm-history-entry");
    const heading = make("div", "crm-history-heading");
    heading.append(
      make("strong", "", `${item.interestStatus || "Contact"} · ${item.callStatus || "—"}`),
      make("small", "", dateText(item.createdAt, true))
    );
    row.append(heading);
    row.append(make("small", "crm-history-staff", `Staff: ${item.actorName || "Showroom team"}`));
    if (item.notes) row.append(make("p", "crm-history-notes", item.notes));
    if (item.nextFollowUpAt) row.append(make("small", "crm-history-followup", `Follow-up: ${dateText(item.nextFollowUpAt)}`));
    list.append(row);
  });
  if (!entries.size) list.append(make("p", "crm-empty", "No contact history has been recorded."));
  const form = make("div", "crm-dialog-content");
  form.append(list);
  const close = make("button", "crm-button crm-button-primary", "Done");
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  form.append(close);
  openDialog(`Contact history · ${customer.name}`, "The original contact record is preserved after status changes.", form);
}

function openPurchaseDialog(customer, purchase = null) {
  const form = make("form", "crm-dialog-form");
  const modelOptions = [
    ["Choose model", ""],
    ...state.models.map((model) => [model, model]),
    ["Other", "Other"]
  ];
  const modelSelection = purchase?.bikeModel && state.models.includes(purchase.bikeModel)
    ? purchase.bikeModel
    : purchase?.bikeModel ? "Other" : "";
  const model = addSelect(form, "Purchased bike model", "bikeModel", modelOptions, modelSelection, true);
  const otherModel = addField(form, "Other model name", "otherModel", "text",
    modelSelection === "Other" ? purchase.bikeModel : "");
  otherModel.maxLength = 100;
  otherModel.closest("label").hidden = modelSelection !== "Other";
  model.addEventListener("change", () => {
    otherModel.closest("label").hidden = model.value !== "Other";
  });
  addSelect(form, "Battery type", "batteryType", [
    ["Not applicable", "Not Applicable"], ["Lithium", "Lithium"], ["Lead Acid", "Lead Acid"], ["Other", "Other"]
  ], purchase?.batteryType || "Not Applicable", true);
  addSelect(form, "Purchase status", "purchaseStatus", [
    ["Completed", "completed"], ["Pending delivery", "pending_delivery"]
  ], purchase?.purchaseStatus || "completed", true);
  addSelect(form, "Payment status", "paymentStatus", [
    ["Unpaid", "unpaid"], ["Partially paid", "partial"], ["Paid", "paid"]
  ], purchase?.paymentStatus || "unpaid", true);
  addSelect(form, "Delivery status", "deliveryStatus", [
    ["Pending", "pending"], ["Ready", "ready"], ["Delivered", "delivered"]
  ], purchase?.deliveryStatus || "pending", true);
  const warranty = addField(form, "Warranty details (optional)", "warrantyDetails", "textarea", purchase?.warrantyDetails || "");
  warranty.maxLength = 1000;
  warranty.closest("label").classList.add("wide");
  const formMessage = addFormMessage(form);
  const submit = addFormActions(form, purchase ? "Save purchase" : "Mark as purchased");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const selectedModel = String(data.get("bikeModel"));
    const bikeModel = selectedModel === "Other" ? String(data.get("otherModel")).trim() : selectedModel;
    submit.disabled = true;
    formMessage.textContent = "";
    try {
      if (purchase) {
        await callable("crmUpdatePurchase")({
          purchaseId: purchase.id,
          changes: {
            bikeModel,
            batteryType: data.get("batteryType"),
            purchaseStatus: data.get("purchaseStatus"),
            paymentStatus: data.get("paymentStatus"),
            deliveryStatus: data.get("deliveryStatus"),
            warrantyDetails: data.get("warrantyDetails")
          }
        });
      } else {
        await callable("crmMarkPurchased")({
          customerId: customer.id,
          requestId: crypto.randomUUID(),
          bikeModel: selectedModel,
          otherModel: data.get("otherModel"),
          batteryType: data.get("batteryType"),
          purchaseStatus: data.get("purchaseStatus"),
          paymentStatus: data.get("paymentStatus"),
          deliveryStatus: data.get("deliveryStatus"),
          warrantyDetails: data.get("warrantyDetails")
        });
      }
      dialog.close();
      showToast(purchase ? "Purchase details saved." : "Customer marked as purchased.");
      await loadData();
    } catch (error) {
      formMessage.textContent = error.message || "Could not save purchase details.";
    } finally {
      submit.disabled = false;
    }
  });
  openDialog(
    purchase ? "Edit offline purchase" : `Mark purchased · ${customer.name}`,
    "Purchase date and staff attribution are recorded by the server. No payment is processed here.",
    form
  );
}

const STAFF_PERMISSION_LABELS = {
  "customers:view": "View all customers",
  "customers:create": "Add customers",
  "customers:edit": "Edit customer details",
  "contacts:log": "Record calls and follow-ups",
  "leads:resolve": "Resolve registration matches",
  "purchases:view": "View offline purchases",
  "purchases:create": "Record offline purchases",
  "purchases:edit": "Edit offline purchases",
  "reminders:view": "View reminders"
};

function openStaffDialog(member = null) {
  const form = make("form", "crm-dialog-form");
  const name = addField(form, "Staff name", "displayName", "text", member?.displayName || "", true, "wide");
  name.maxLength = 100;
  const email = addField(form, "Staff email", "email", "email", member?.email || "", true, "wide");
  email.maxLength = 254;
  if (member) {
    email.readOnly = true;
    email.classList.add("is-readonly");
  }
  const permissionsField = make("fieldset", "crm-field wide");
  const legend = make("legend", "", "Permissions");
  const checks = make("div", "crm-check-list");
  Object.entries(STAFF_PERMISSION_LABELS).forEach(([permission, labelText]) => {
    const label = make("label");
    const input = make("input");
    input.type = "checkbox";
    input.name = "permissions";
    input.value = permission;
    input.checked = member ? member.permissions.includes(permission) : true;
    label.append(input, document.createTextNode(labelText));
    checks.append(label);
  });
  permissionsField.append(legend, checks);
  form.append(permissionsField);
  const formMessage = addFormMessage(form);
  const submit = addFormActions(form, member ? "Save permissions" : "Create staff account");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const permissions = data.getAll("permissions").map(String);
    submit.disabled = true;
    formMessage.textContent = "";
    try {
      if (member) {
        await callable("crmUpdateStaff")({
          uid: member.uid,
          displayName: data.get("displayName"),
          permissions
        });
      } else {
        const result = await callable("crmCreateStaff")({
          email: data.get("email"),
          displayName: data.get("displayName"),
          permissions
        });
        let setupEmailFailed = false;
        if (result.data?.createdAuthUser) {
          try {
            await sendPasswordResetEmail(crmAuth, result.data.email);
          } catch {
            setupEmailFailed = true;
          }
        }
        dialog.close();
        showToast(setupEmailFailed
          ? "Staff access was created, but the setup email failed. Use Reset access to retry."
          : "Staff account created and password setup email sent.");
        await loadData();
        return;
      }
      dialog.close();
      showToast("Staff permissions updated.");
      await loadData();
    } catch (error) {
      formMessage.textContent = error.message || "Could not save staff access.";
    } finally {
      submit.disabled = false;
    }
  });
  openDialog(member ? "Manage staff permissions" : "Add staff", "Staff cannot grant access, change roles or delete CRM records.", form);
}

function makeCustomerActions(customer, includeArchive = false) {
  const actions = make("div", "crm-table-actions");
  const phone = make("a", "crm-button crm-button-quiet", "Call");
  phone.href = `tel:${customer.phone}`;
  actions.append(phone);
  actions.append(actionButton("History", "view-history", customer.id));
  if (!customer.isArchived && can("customers:edit")) {
    actions.append(actionButton("Edit", "edit-customer", customer.id));
  }
  if (!customer.isArchived && can("contacts:log")) {
    actions.append(actionButton("Log follow-up", "contact-customer", customer.id));
  }
  if (!customer.isArchived && can("purchases:create")) {
    actions.append(actionButton("Mark purchased", "purchase-customer", customer.id));
  }
  if (includeArchive && state.role === "owner") {
    actions.append(actionButton(customer.isArchived ? "Restore" : "Archive",
      customer.isArchived ? "restore-customer" : "archive-customer", customer.id));
  }
  return actions;
}

function renderCustomers() {
  const rows = document.getElementById("crm-customer-rows");
  if (!rows) return;
  rows.replaceChildren();
  const search = (document.getElementById("crm-search")?.value || "").trim().toLowerCase();
  const status = document.getElementById("crm-status-filter")?.value || "";
  const bike = document.getElementById("crm-bike-filter")?.value || "";
  const followUpDate = document.getElementById("crm-follow-up-filter")?.value || "";
  const showArchived = state.role === "owner" && document.getElementById("crm-show-archived")?.checked;
  const customers = state.customers.filter((customer) => {
    if (showArchived ? !customer.isArchived : customer.isArchived || customer.deletedAt) return false;
    if (status && customer.status !== status) return false;
    if (bike && customer.interestedBike !== bike) return false;
    if (followUpDate && (!customer.nextFollowUpAt ||
        indiaDateKey(dateValue(customer.nextFollowUpAt)) !== followUpDate)) return false;
    if (search && !`${customer.name} ${customer.phone} ${customer.email}`.toLowerCase().includes(search)) return false;
    return true;
  });
  customers.forEach((customer) => {
    const row = make("tr");
    appendCell(row, customerSummary(customer));
    const phone = make("a", "", customer.phone);
    phone.href = `tel:${customer.phone}`;
    appendCell(row, phone);
    const pill = make("span", `crm-pill ${customer.status}`, statusLabel(customer.status));
    appendCell(row, pill);
    appendCell(row, customer.interestedBike);
    appendCell(row, staffLabel(customer.assignedStaffUid));
    appendCell(row, dateText(customer.nextFollowUpAt));
    appendCell(row, makeCustomerActions(customer, true));
    rows.append(row);
  });
  const empty = document.getElementById("crm-customer-empty");
  if (empty) empty.hidden = customers.length > 0;
}

function renderPurchased() {
  const rows = document.getElementById("crm-purchased-rows");
  if (!rows) return;
  rows.replaceChildren();
  const showArchived = state.role === "owner" && document.getElementById("crm-show-archived")?.checked;
  const purchases = state.purchases.filter((purchase) => showArchived
    ? purchase.isArchived
    : !purchase.isArchived)
    .sort((a, b) => (dateValue(b.purchaseDate)?.getTime() || 0) - (dateValue(a.purchaseDate)?.getTime() || 0));
  purchases.forEach((purchase) => {
    const customer = findCustomer(purchase.customerId);
    const row = make("tr");
    appendCell(row, customer?.name || purchase.customerName);
    const phone = make("a", "", customer?.phone || purchase.customerPhone);
    if (phone.textContent) phone.href = `tel:${phone.textContent}`;
    appendCell(row, phone);
    appendCell(row, dateText(purchase.purchaseDate));
    appendCell(row, purchase.bikeModel);
    appendCell(row, purchase.markedByName || staffLabel(purchase.markedByUid));
    const actions = make("div", "crm-table-actions");
    if (!purchase.isArchived && can("purchases:edit")) actions.append(actionButton("Edit", "edit-purchase", purchase.id));
    if (state.role === "owner") {
      actions.append(actionButton(purchase.isArchived ? "Restore" : "Archive",
        purchase.isArchived ? "restore-purchase" : "archive-purchase", purchase.id));
    }
    appendCell(row, actions);
    rows.append(row);
  });
}

function renderPurchases() {
  const rows = document.getElementById("crm-purchase-rows");
  if (!rows) return;
  rows.replaceChildren();
  const showArchived = state.role === "owner" && document.getElementById("crm-show-archived")?.checked;
  state.purchases.filter((purchase) => showArchived
    ? purchase.isArchived
    : !purchase.isArchived)
    .sort((a, b) => (dateValue(b.purchaseDate)?.getTime() || 0) - (dateValue(a.purchaseDate)?.getTime() || 0))
    .forEach((purchase) => {
      const row = make("tr");
      appendCell(row, purchase.customerName);
      appendCell(row, purchase.bikeModel);
      appendCell(row, dateText(purchase.purchaseDate));
      appendCell(row, purchase.paymentStatus);
      appendCell(row, purchase.deliveryStatus);
      appendCell(row, purchase.markedByName || staffLabel(purchase.markedByUid));
      const actions = make("div", "crm-table-actions");
      if (!purchase.isArchived && can("purchases:edit")) {
        actions.append(actionButton("Edit", "edit-purchase", purchase.id));
      }
      if (state.role === "owner") {
        actions.append(actionButton(purchase.isArchived ? "Restore" : "Archive",
          purchase.isArchived ? "restore-purchase" : "archive-purchase", purchase.id));
      }
      appendCell(row, actions);
      rows.append(row);
    });
  if (!rows.childElementCount) {
    const row = make("tr");
    appendCell(row, "No offline purchases found.");
    rows.append(row);
  }
}

function renderNotInterested() {
  const rows = document.getElementById("crm-not-interested-rows");
  if (!rows) return;
  rows.replaceChildren();
  state.customers.filter((customer) => customer.status === "not_interested" && !customer.isArchived)
    .forEach((customer) => {
      const row = make("tr");
      appendCell(row, customer.name);
      const phone = make("a", "", customer.phone);
      phone.href = `tel:${customer.phone}`;
      appendCell(row, phone);
      appendCell(row, customer.interestedBike);
      appendCell(row, staffLabel(customer.assignedStaffUid));
      appendCell(row, dateText(customer.updatedAt));
      const actions = make("div", "crm-table-actions");
      if (can("contacts:log")) actions.append(actionButton("Reactivate / log contact", "contact-customer", customer.id));
      if (state.role === "owner") actions.append(actionButton("Archive", "archive-customer", customer.id));
      appendCell(row, actions);
      rows.append(row);
    });
}

function followUpGroup(title, customers, className = "") {
  const section = make("section", `crm-follow-group ${className}`);
  const heading = make("h2", "", `${title} · ${customers.length}`);
  section.append(heading);
  const list = make("div", "crm-compact-list");
  customers.forEach((customer) => {
    const row = make("div", "crm-compact-row");
    const details = make("div");
    details.append(make("strong", "", customer.name), make("small", "", `${customer.phone} · ${customer.callStatus || "No call logged"}`));
    const actions = make("div", "crm-table-actions");
    if (can("contacts:log")) actions.append(actionButton("Log contact", "contact-customer", customer.id));
    row.append(details, actions);
    list.append(row);
  });
  if (!customers.length) list.append(make("p", "crm-empty", "No customers in this group."));
  section.append(list);
  return section;
}

function renderFollowUps() {
  const root = document.getElementById("crm-follow-up-groups");
  if (!root) return;
  root.replaceChildren();
  const today = indiaDateKey();
  const customers = state.customers.filter((customer) =>
    !customer.isArchived && customer.nextFollowUpAt && customer.status !== "purchased"
  );
  const grouped = { overdue: [], today: [], upcoming: [] };
  customers.forEach((customer) => {
    const date = dateValue(customer.nextFollowUpAt);
    if (!date) return;
    const key = indiaDateKey(date);
    if (key < today) grouped.overdue.push(customer);
    else if (key === today) grouped.today.push(customer);
    else grouped.upcoming.push(customer);
  });
  root.append(
    followUpGroup("Overdue", grouped.overdue, "overdue"),
    followUpGroup("Today", grouped.today),
    followUpGroup("Upcoming", grouped.upcoming.sort((a, b) =>
      dateValue(a.nextFollowUpAt) - dateValue(b.nextFollowUpAt)
    ))
  );
  const priority = document.getElementById("crm-priority-list");
  if (priority) {
    priority.replaceChildren();
    [...grouped.overdue, ...grouped.today].slice(0, 8).forEach((customer) => {
      const row = make("div", "crm-compact-row");
      row.append(make("strong", "", customer.name), make("small", "", `${dateText(customer.nextFollowUpAt)} · ${customer.phone}`));
      priority.append(row);
    });
    if (!priority.childElementCount) priority.append(make("p", "crm-empty", "No follow-ups due today."));
  }
  const completed = document.getElementById("crm-completed-followups");
  if (completed) {
    completed.replaceChildren();
    state.completedFollowUps.forEach((entry) => {
      const row = make("div", "crm-compact-row");
      row.append(
        make("strong", "", `${entry.customerName || "Customer"} · ${entry.interestStatus || "Contact"}`),
        make("small", "", `${entry.actorName || "Showroom team"} · ${dateText(entry.createdAt, true)} · ${entry.callStatus || "—"}`)
      );
      completed.append(row);
    });
    if (!completed.childElementCount) completed.append(make("p", "crm-empty", "No completed follow-ups yet."));
  }
}

function renderIntakes() {
  const rows = document.getElementById("crm-intake-rows");
  if (!rows) return;
  rows.replaceChildren();
  const pending = state.intakes.filter((item) => item.status === "needs_review");
  pending.forEach((intake) => {
    const row = make("tr");
    appendCell(row, intake.name);
    const phoneCell = make("td");
    phoneCell.append(document.createTextNode(intake.phone || ""));
    if (!intake.phoneHash) {
      const correctedPhone = make("input");
      correctedPhone.type = "tel";
      correctedPhone.placeholder = "Correct phone";
      correctedPhone.setAttribute("aria-label", "Correct phone number for registration");
      phoneCell.append(correctedPhone);
    }
    row.append(phoneCell);
    appendCell(row, intake.email);
    appendCell(row, intake.reason === "phone_match_requires_review" ? "Phone match; verify before linking" : "Phone needs correction");
    const select = make("select");
    select.className = "crm-field";
    select.setAttribute("aria-label", "Customer to link");
    select.add(new Option("Select customer", ""));
    state.customers.filter((customer) => !customer.isArchived && !customer.deletedAt).forEach((customer) => {
      const option = new Option(`${customer.name} · ${customer.phone}`, customer.id);
      if (customer.id === intake.matchedCustomerId) option.selected = true;
      select.add(option);
    });
    const cell = make("td");
    cell.append(select);
    row.append(cell);
    const resolve = actionButton("Confirm match", "resolve-intake", intake.id);
    resolve.disabled = select.options.length === 1;
    const actions = make("div", "crm-table-actions");
    actions.append(resolve);
    appendCell(row, actions);
    rows.append(row);
  });
  const empty = document.getElementById("crm-intake-empty");
  if (empty) empty.hidden = pending.length > 0;
}

function renderStaff() {
  const rows = document.getElementById("crm-staff-rows");
  if (!rows) return;
  rows.replaceChildren();
  state.staff.forEach((member) => {
    const row = make("tr");
    appendCell(row, member.displayName);
    appendCell(row, member.active ? "Active" : "Inactive");
    appendCell(row, member.permissions.map((item) => STAFF_PERMISSION_LABELS[item] || item).join(", "));
    appendCell(row, String(member.assignedLeadCount));
    const actions = make("div", "crm-table-actions");
    actions.append(actionButton("Permissions", "edit-staff", member.uid));
    actions.append(actionButton(member.active ? "Deactivate" : "Activate", "toggle-staff", member.uid, {
      active: String(!member.active)
    }));
    actions.append(actionButton("Reset access", "reset-staff", member.uid));
    appendCell(row, actions);
    rows.append(row);
  });
}

function renderAudit() {
  [document.getElementById("crm-audit-list"), document.getElementById("crm-recent-audit")]
    .filter(Boolean)
    .forEach((root) => {
      root.replaceChildren();
      state.audit.slice(0, 20).forEach((item) => {
        const row = make("div", "crm-compact-row");
        row.append(make("strong", "", item.action.replaceAll("_", " ")),
          make("small", "", `${item.actorRole} · ${dateText(item.createdAt, true)}`));
        root.append(row);
      });
      if (!root.childElementCount) root.append(make("p", "crm-empty", "No activity recorded yet."));
    });
  const sales = document.getElementById("crm-sales-by-model");
  if (sales) {
    sales.replaceChildren();
    const counts = new Map();
    state.purchases.filter((item) => !item.isArchived).forEach((item) => {
      counts.set(item.bikeModel, (counts.get(item.bikeModel) || 0) + 1);
    });
    state.onlineOrders.filter((order) => order.paymentStatus === "captured").forEach((order) => {
      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        const model = item.model || item.name || "Unspecified model";
        counts.set(model, (counts.get(model) || 0) + (Number.isSafeInteger(item.quantity) ? item.quantity : 0));
      });
    });
    [...counts].sort((a, b) => b[1] - a[1]).forEach(([model, count]) => {
      const row = make("div", "crm-compact-row");
      row.append(make("strong", "", model), make("small", "", `${count} sold`));
      sales.append(row);
    });
    if (!sales.childElementCount) sales.append(make("p", "crm-empty", "No offline purchases recorded."));
  }
  const staffActivity = document.getElementById("crm-staff-activity");
  if (staffActivity) {
    staffActivity.replaceChildren();
    state.staff.forEach((member) => {
      const row = make("div", "crm-compact-row");
      row.append(make("strong", "", member.displayName),
        make("small", "", `${member.contactCount} contacts · ${member.assignedLeadCount} assigned leads${member.lastContactAt ? ` · Last: ${dateText(member.lastContactAt)}` : ""}`));
      staffActivity.append(row);
    });
    if (!staffActivity.childElementCount) staffActivity.append(make("p", "crm-empty", "No staff activity recorded."));
  }
}

function renderOnlineOrders() {
  const rows = document.getElementById("crm-online-order-rows");
  if (!rows) return;
  rows.replaceChildren();
  state.onlineOrders.forEach((order) => {
    const row = make("tr");
    appendCell(row, order.id);
    appendCell(row, order.customer?.name || order.customer?.email || order.userId);
    appendCell(row, dateText(order.createdAt));
    appendCell(row, `${order.paymentStatus || "—"} / ${order.orderStatus || "—"}`);
    appendCell(row, Number.isSafeInteger(order.totalAmount) ? `₹${order.totalAmount.toLocaleString("en-IN")}` : "—");
    rows.append(row);
  });
  if (!rows.childElementCount) {
    const row = make("tr");
    appendCell(row, "No website orders found.");
    rows.append(row);
  }
}

function renderStats() {
  const root = document.getElementById("crm-stats");
  if (!root) return;
  const today = indiaDateKey();
  const active = state.customers.filter((customer) =>
    !customer.isArchived && ["new", "active"].includes(customer.status)
  );
  const due = active.filter((customer) => customer.nextFollowUpAt &&
    indiaDateKey(dateValue(customer.nextFollowUpAt)) === today).length;
  const overdue = active.filter((customer) => customer.nextFollowUpAt &&
    indiaDateKey(dateValue(customer.nextFollowUpAt)) < today).length;
  const offlineSales = state.purchases.filter((item) => !item.isArchived).length;
  const onlineSales = state.onlineOrders
    .filter((order) => order.paymentStatus === "captured")
    .reduce((total, order) => total + (Array.isArray(order.items)
      ? order.items.reduce((sum, item) => sum + (Number.isSafeInteger(item.quantity) ? item.quantity : 0), 0)
      : 0), 0);
  const cards = [
    ["Total customers", state.customers.filter((item) => !item.isArchived).length],
    ["New leads", state.customers.filter((item) => item.status === "new" && !item.isArchived).length],
    ["Active leads", active.length],
    ["Today's follow-ups", due],
    ["Overdue follow-ups", overdue],
    ["Purchased customers", state.customers.filter((item) => item.status === "purchased" && !item.isArchived).length],
    ["Not interested", state.customers.filter((item) => item.status === "not_interested" && !item.isArchived).length],
    [state.role === "owner" ? "Bikes sold · all channels" : "Offline purchases",
      state.role === "owner" ? offlineSales + onlineSales : offlineSales]
  ];
  root.replaceChildren();
  cards.forEach(([label, count]) => {
    const card = make("div", "crm-stat");
    card.append(make("span", "", label), make("strong", "", String(count)));
    root.append(card);
  });
}

function renderAll() {
  renderStats();
  renderCustomers();
  renderPurchased();
  renderPurchases();
  renderNotInterested();
  renderFollowUps();
  renderIntakes();
  renderStaff();
  renderAudit();
  renderOnlineOrders();
  const name = document.getElementById("crm-user-name");
  if (name) name.textContent = state.session?.displayName || (state.role === "owner" ? "Owner" : "Staff");
  const bikeFilter = document.getElementById("crm-bike-filter");
  if (bikeFilter) {
    const selected = bikeFilter.value;
    bikeFilter.replaceChildren(new Option("All bike interests", ""));
    [...new Set(state.customers.map((item) => item.interestedBike).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
      .forEach((bike) => bikeFilter.add(new Option(bike, bike)));
    bikeFilter.value = selected;
  }
}

async function loadData() {
  message.textContent = "Loading CRM records…";
  try {
    const [customers, purchases, intakes, models, staff, completed] = await Promise.all([
      can("customers:view")
        ? getDocs(query(collection(crmDb, "crmCustomers"), orderBy("updatedAt", "desc")))
        : Promise.resolve({ docs: [], size: 0 }),
      can("purchases:view")
        ? getDocs(query(collection(crmDb, "crmPurchases"), orderBy("purchaseDate", "desc")))
        : Promise.resolve({ docs: [], size: 0 }),
      can("leads:resolve")
        ? getDocs(query(collection(crmDb, "crmLeadIntakes"), where("status", "==", "needs_review")))
        : Promise.resolve({ docs: [], size: 0 }),
      can("purchases:view") ? callable("crmGetBikeModels")() : Promise.resolve({ data: { models: [] } }),
      can("customers:view") ? callable("crmListStaff")() : Promise.resolve({ data: { staff: [] } }),
      can("customers:view")
        ? getDocs(query(collectionGroup(crmDb, "contactHistory"), orderBy("createdAt", "desc"), limit(100)))
        : Promise.resolve({ docs: [] })
    ]);
    state.customers = customers.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    state.purchases = purchases.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    state.intakes = intakes.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    state.completedFollowUps = completed.docs.map((snapshot) => ({
      id: snapshot.id,
      customerName: state.customers.find((customer) => customer.id === snapshot.ref.parent.parent?.id)?.name || "",
      ...snapshot.data()
    }));
    state.models = Array.isArray(models.data?.models) ? models.data.models : [];
    state.staff = staff.data?.staff || [];
    if (state.role === "owner") {
      const [audit, orders] = await Promise.all([
        getDocs(query(collection(crmDb, "crmAuditEvents"), orderBy("createdAt", "desc"), limit(50))),
        getDocs(query(collection(crmDb, "orders"), orderBy("createdAt", "desc")))
      ]);
      state.audit = audit.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
      state.onlineOrders = orders.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
    }
    message.textContent = "";
    renderAll();
  } catch (error) {
    message.textContent = "CRM records could not be loaded. Your access may have changed; sign in again or contact the Owner.";
    console.error("Could not load CRM data", { code: error?.code || error?.name || "unknown" });
  }
}

function openStaffInvite() {
  const button = document.getElementById("crm-add-staff");
  button?.addEventListener("click", () => openStaffDialog());
}

document.querySelectorAll(".crm-nav [data-tab]").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));
});
document.querySelectorAll("[data-open-tab]").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.openTab));
});
document.getElementById("crm-search")?.addEventListener("input", renderCustomers);
document.getElementById("crm-status-filter")?.addEventListener("change", renderCustomers);
document.getElementById("crm-bike-filter")?.addEventListener("change", renderCustomers);
document.getElementById("crm-follow-up-filter")?.addEventListener("change", renderCustomers);
document.getElementById("crm-show-archived")?.addEventListener("change", () => {
  renderCustomers();
  renderPurchased();
});
const followUpFilter = document.getElementById("crm-follow-up-filter");
if (followUpFilter) followUpFilter.min = indiaDateKey();
document.getElementById("crm-refresh")?.addEventListener("click", loadData);
document.getElementById("crm-add-customer")?.addEventListener("click", () => openCustomerDialog());
openStaffInvite();

document.getElementById("crm-logout")?.addEventListener("click", async () => {
  await signOut(crmAuth);
  window.location.replace(loginUrl);
});

document.body.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled) return;
  const id = target.dataset.id;
  const customer = findCustomer(id);
  try {
    switch (target.dataset.action) {
      case "edit-customer":
        if (customer) openCustomerDialog(customer);
        break;
      case "contact-customer":
        if (customer) openContactDialog(customer, { interestStatus: customer.status === "not_interested" ? "Interested" : "" });
        break;
      case "view-history":
        if (customer) await openContactHistory(customer);
        break;
      case "purchase-customer":
        if (customer) openPurchaseDialog(customer);
        break;
      case "archive-customer":
        if (window.confirm("Archive this customer from active CRM lists? History is retained.")) {
          await callable("crmArchiveRecord")({ entityType: "customer", entityId: id });
          showToast("Customer archived; records and history were retained.");
          await loadData();
        }
        break;
      case "restore-customer":
        await callable("crmArchiveRecord")({ entityType: "customer", entityId: id, archive: false });
        showToast("Customer restored.");
        await loadData();
        break;
      case "edit-purchase": {
        const purchase = state.purchases.find((item) => item.id === id);
        const linkedCustomer = purchase && findCustomer(purchase.customerId);
        if (purchase) openPurchaseDialog(linkedCustomer || { id: purchase.customerId, name: purchase.customerName }, purchase);
        break;
      }
      case "archive-purchase":
        if (window.confirm("Archive this purchase from active reports? The record remains in the audit history.")) {
          await callable("crmArchiveRecord")({ entityType: "purchase", entityId: id });
          showToast("Purchase archived.");
          await loadData();
        }
        break;
      case "restore-purchase":
        await callable("crmArchiveRecord")({ entityType: "purchase", entityId: id, archive: false });
        showToast("Purchase restored.");
        await loadData();
        break;
      case "resolve-intake": {
        const row = target.closest("tr");
        const customerId = row.querySelector("select").value;
        if (!customerId) break;
        const confirmedPhone = row.querySelector('input[type="tel"]')?.value;
        await callable("crmResolveLeadIntake")({ intakeId: id, customerId, confirmedPhone });
        showToast("Website registration linked after staff confirmation.");
        await loadData();
        break;
      }
      case "edit-staff": {
        const member = state.staff.find((item) => item.uid === id);
        if (member) openStaffDialog(member);
        break;
      }
      case "toggle-staff":
        await callable("crmUpdateStaff")({ uid: id, active: target.dataset.active === "true" });
        showToast(target.dataset.active === "true"
          ? "Staff access activated. They must sign in again."
          : "Staff access deactivated immediately.");
        await loadData();
        break;
      case "reset-staff": {
        const result = await callable("crmResetStaffAccess")({ uid: id });
        await loadData();
        try {
          await sendPasswordResetEmail(crmAuth, result.data.email);
        } catch {
          showToast("Access was paused, but the reset email failed. Retry Reset access to send it again.", true);
          break;
        }
        showToast("Access paused and password reset email sent. Reactivate staff after confirming the reset.");
        break;
      }
      default:
        break;
    }
  } catch (error) {
    showToast(error.message || "That CRM action could not be completed.", true);
  }
});

onAuthStateChanged(crmAuth, async (user) => {
  if (!user) {
    window.location.replace(loginUrl);
    return;
  }
  try {
    const response = await callable("crmGetSession")();
    if (response.data?.role !== expectedRole) {
      await signOut(crmAuth);
      window.location.replace(loginUrl);
      return;
    }
    state.role = response.data.role;
    state.session = response.data;
    document.querySelectorAll("[data-owner-only]").forEach((element) => {
      element.hidden = state.role !== "owner";
    });
    const requiredByTab = {
      customers: "customers:view",
      leads: "customers:view",
      purchased: "customers:view",
      "not-interested": "customers:view",
      "follow-ups": "customers:view",
      purchases: "purchases:view",
      staff: "owner",
      reports: "owner"
    };
    document.querySelectorAll(".crm-nav [data-tab]").forEach((button) => {
      const permission = requiredByTab[button.dataset.tab];
      button.hidden = permission === "owner"
        ? state.role !== "owner"
        : permission ? !can(permission) : false;
      if (button.dataset.tab === "leads" && !can("leads:resolve")) button.hidden = true;
      if (button.dataset.tab === "follow-ups" && !can("reminders:view")) button.hidden = true;
    });
    const addCustomerButton = document.getElementById("crm-add-customer");
    if (addCustomerButton) addCustomerButton.hidden = !can("customers:create");
    const addStaffButton = document.getElementById("crm-add-staff");
    if (addStaffButton) addStaffButton.hidden = state.role !== "owner";
    await loadData();
  } catch (error) {
    await signOut(crmAuth);
    window.location.replace(loginUrl);
  }
});
