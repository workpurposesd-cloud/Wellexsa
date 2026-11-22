import {
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { crmAuth, crmFunctions } from "./crm-config.js";
import { crmLoginErrorMessage, crmRoleMismatchMessage } from "./crm-login-errors.js";

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
      signedIn = false;
      showMessage(crmRoleMismatchMessage(role, response.data?.role));
      return;
    }
    window.location.replace(role === "owner" ? "owner.html" : "staff.html");
  } catch (error) {
    if (signedIn) {
      try {
        await signOut(crmAuth);
      } catch (signOutError) {
        console.error("Could not clear the rejected CRM session", {
          code: signOutError?.code || signOutError?.name || "unknown"
        });
      }
    }
    showMessage(crmLoginErrorMessage(error, role));
  } finally {
    submit.disabled = false;
  }
});
