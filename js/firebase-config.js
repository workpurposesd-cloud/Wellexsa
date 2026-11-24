import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { shouldConnectAuthEmulator } from "./firebase-emulator-config.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: "AIzaSyC26xdAptlwycLU1cN-VgFeF6KFTyDge2U",
  authDomain: "wellexsa.firebaseapp.com",
  projectId: "wellexsa",
  storageBucket: "wellexsa.firebasestorage.app",
  messagingSenderId: "409647733571",
  appId: "1:409647733571:web:869c847154fa9d3741adf6",
  measurementId: "G-H3HX43BFME"
};

const requiredConfigKeys = ["apiKey", "authDomain", "projectId", "storageBucket", "appId"];
export const isFirebaseConfigured = requiredConfigKeys.every((key) => {
  const value = firebaseConfig[key];
  return typeof value === "string" && value.trim().length > 0 && !value.startsWith("YOUR_");
});

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;

const emulatorOptIn = globalThis.WELLEXSA_USE_AUTH_EMULATOR === true ||
  globalThis.document?.querySelector('meta[name="wellexsa-auth-emulator"]')?.content === "true";

const emulatorHostname = globalThis.location?.hostname || "";

if (auth && shouldConnectAuthEmulator({
  explicitOptIn: emulatorOptIn,
  hostname: emulatorHostname
})) {
  const { connectAuthEmulator } = await import(
    "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"
  );
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
