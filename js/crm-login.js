import {
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { crmAuth, crmFunctions } from "./crm-config.js";

const form = document.getElementById("crm-login-form");
const message = document.getElementById("crm-login-message");
const role = document.body.dataset.crmLoginRole;
const sessionCall = httpsCallable(crmFunctions, "crmGetSession");

function showMessage(value) {
  message.textContent = value;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  showMessage("");
  let signedIn = false;
  try {
    const data = new FormData(form);
    const credential = await signInWithEmailAndPassword(
      crmAuth,
      String(data.get("email")).trim().toLowerCase(),
      String(data.get("password"))
    );
    signedIn = true;
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user);
      await signOut(crmAuth);
      signedIn = false;
      showMessage("Verify your email using the link we sent, then sign in again.");
      return;
    }
    const response = await sessionCall();
    if (response.data?.role !== role) {
      await signOut(crmAuth);
      throw new Error("This account is not authorized for this CRM workspace.");
    }
    window.location.replace(role === "owner" ? "owner.html" : "staff.html");
  } catch (error) {
    if (signedIn) await signOut(crmAuth);
    showMessage(error.message === "This account is not authorized for this CRM workspace."
      ? error.message
      : "Sign-in failed or CRM access is not active. Check your details or contact the Owner.");
  } finally {
    submit.disabled = false;
  }
});
