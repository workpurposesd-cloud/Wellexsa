import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { loadEnv } from "./env.js";

const { firebaseProjectId } = loadEnv();
const initializedApps = getApps();
const existingApp = initializedApps.find((app) => app.options.projectId === firebaseProjectId) ||
  initializedApps.find((app) => app.name === "[DEFAULT]");

if (existingApp?.options.projectId && existingApp.options.projectId !== firebaseProjectId) {
  throw new Error("The initialized Firebase Admin app does not match FIREBASE_PROJECT_ID.");
}
if (initializedApps.length && !existingApp) {
  throw new Error("No initialized Firebase Admin app matches FIREBASE_PROJECT_ID.");
}

const firebaseApp = existingApp || initializeApp({
  credential: applicationDefault(),
  projectId: firebaseProjectId
});

export const firebaseAuth = getAuth(firebaseApp);
