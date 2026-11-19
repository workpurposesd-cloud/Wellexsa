import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { app, isFirebaseConfigured } from "./firebase-config.js";
import { buildWhatsAppUrl } from "./enquiry-whatsapp.js";

const functions = isFirebaseConfigured ? getFunctions(app, "us-central1") : null;
let dialog;
let selectedBikeModel = "";
let requestId = "";
let submitting = false;

function createDialog() {
  dialog = document.createElement("dialog");
  dialog.className = "enquiry-dialog";
  dialog.setAttribute("aria-labelledby", "enquiry-title");

  const panel = document.createElement("div");
  panel.className = "enquiry-panel";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "enquiry-close";
  close.setAttribute("aria-label", "Close enquiry form");
  close.textContent = "×";
  close.addEventListener("click", () => dialog.close());
  const title = document.createElement("h2");
  title.id = "enquiry-title";
  const bike = document.createElement("p");
  bike.className = "enquiry-bike";
  const form = document.createElement("form");
  form.className = "enquiry-form";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Customer Name";
  const nameInput = document.createElement("input");
  nameInput.name = "name";
  nameInput.type = "text";
  nameInput.required = true;
  nameInput.maxLength = 100;
  nameInput.autocomplete = "name";
  nameInput.addEventListener("input", () => nameInput.setCustomValidity(""));
  nameLabel.append(nameInput);
  const mobileLabel = document.createElement("label");
  mobileLabel.textContent = "Mobile Number";
  const mobileInput = document.createElement("input");
  mobileInput.name = "mobile";
  mobileInput.type = "tel";
  mobileInput.required = true;
  mobileInput.pattern = "[6-9][0-9]{9}";
  mobileInput.minLength = 10;
  mobileInput.maxLength = 10;
  mobileInput.inputMode = "numeric";
  mobileInput.autocomplete = "tel-national";
  mobileInput.title = "Enter a valid 10-digit Indian mobile number.";
  mobileLabel.append(mobileInput);
  const status = document.createElement("p");
  status.className = "enquiry-status";
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "enquiry-actions";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "button button-dark";
  submit.textContent = "Submit Enquiry";
  const whatsapp = document.createElement("a");
  whatsapp.className = "button whatsapp-button";
  whatsapp.textContent = "WhatsApp Us";
  whatsapp.target = "_blank";
  whatsapp.rel = "noopener noreferrer";
  whatsapp.hidden = true;
  actions.append(submit, whatsapp);
  form.append(nameLabel, mobileLabel, status, actions);
  panel.append(close, title, bike, form);
  dialog.append(panel);
  document.body.append(dialog);

  dialog.addEventListener("cancel", (event) => {
    if (submitting) event.preventDefault();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity() || submitting) return;
    if (!functions) {
      status.textContent = "Enquiries are temporarily unavailable. Please try again later.";
      status.classList.add("is-error");
      return;
    }

    submitting = true;
    submit.disabled = true;
    close.disabled = true;
    submit.textContent = "Submitting…";
    status.textContent = "";
    status.classList.remove("is-error");
    const customerName = nameInput.value.trim();
    const mobileNumber = mobileInput.value.trim();
    if (!customerName) {
      nameInput.setCustomValidity("Enter your name.");
      nameInput.reportValidity();
      submitting = false;
      close.disabled = false;
      submit.disabled = false;
      submit.textContent = "Submit Enquiry";
      return;
    }
    nameInput.setCustomValidity("");
    try {
      const response = await httpsCallable(functions, "crmSubmitBikeEnquiry")({
        requestId,
        name: customerName,
        mobile: mobileNumber,
        bikeModel: selectedBikeModel
      });
      if (response.data?.submitted !== true) {
        throw new Error("Your enquiry could not be confirmed. Please try again.");
      }

      whatsapp.href = buildWhatsAppUrl(selectedBikeModel, customerName, mobileNumber);
      form.querySelectorAll("label").forEach((label) => { label.hidden = true; });
      submit.hidden = true;
      status.textContent = "Thank you. Your enquiry has been sent to the showroom.";
      whatsapp.hidden = false;
    } catch (error) {
      status.textContent = error.message || "Your enquiry could not be saved. Please try again.";
      status.classList.add("is-error");
    } finally {
      submitting = false;
      close.disabled = false;
      submit.disabled = false;
      submit.textContent = "Submit Enquiry";
    }
  });
}

export function openEnquiryForm(bike) {
  if (!dialog) createDialog();
  selectedBikeModel = String(bike?.model || bike?.name || "").trim();
  requestId = crypto.randomUUID();
  dialog.querySelector("#enquiry-title").textContent = "Enquire Now";
  dialog.querySelector(".enquiry-bike").textContent = selectedBikeModel;
  const form = dialog.querySelector("form");
  form.reset();
  form.querySelectorAll("label").forEach((label) => { label.hidden = false; });
  const status = form.querySelector(".enquiry-status");
  status.textContent = "";
  status.classList.remove("is-error");
  const submit = form.querySelector('button[type="submit"]');
  submit.hidden = false;
  submit.disabled = false;
  const whatsapp = form.querySelector("a");
  whatsapp.hidden = true;
  whatsapp.removeAttribute("href");
  dialog.showModal();
  form.elements.name.focus();
}
