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
  whatsapp.innerHTML = '<svg class="whatsapp-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.099-.198.05-.372-.025-.521-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.064 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.693.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.29.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982 1-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.437-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.892 6.993c-.003 5.45-4.437 9.885-9.89 9.885m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.158 11.892c0 2.096.547 4.143 1.588 5.946L0 24l6.335-1.662a11.882 11.882 0 0 0 5.71 1.455h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.412z"/></svg><span>WhatsApp Us</span>';
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
      const message = typeof error?.message === "string" ? error.message.trim() : "";
      const isInternalError = error?.code === "functions/internal" || message.toLowerCase() === "internal";
      status.textContent = isInternalError
        ? "We couldn't send your enquiry. Please try again or contact the showroom."
        : message || "Your enquiry could not be saved. Please try again.";
      status.classList.add("is-error");
      console.error("Bike enquiry submission failed", error);
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
