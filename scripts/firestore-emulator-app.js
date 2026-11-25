export const EMULATOR_HOST = "127.0.0.1:8080";
export const PROJECT_ID = "wellexsa-demo";
export const APP_NAME = "wellexsa-homepage-emulator-seed";

export function initializeFirestoreEmulatorApp(initializeApp, env = process.env) {
  if (env.FIRESTORE_EMULATOR_HOST !== EMULATOR_HOST) {
    throw new Error(`Refusing to seed: FIRESTORE_EMULATOR_HOST must equal ${EMULATOR_HOST}.`);
  }

  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Refusing to seed while GOOGLE_APPLICATION_CREDENTIALS is set.");
  }

  const app = initializeApp({ projectId: PROJECT_ID }, APP_NAME);
  if (app.options.projectId !== PROJECT_ID) {
    throw new Error("Unexpected Firebase project.");
  }

  return app;
}
