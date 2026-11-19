import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  browserSessionPersistence,
  initializeAuth
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";

const crmApp = initializeApp(firebaseConfig, "wellexsa-crm");

export const crmAuth = initializeAuth(crmApp, { persistence: browserSessionPersistence });
export const crmDb = getFirestore(crmApp);
export const crmFunctions = getFunctions(crmApp, "us-central1");
