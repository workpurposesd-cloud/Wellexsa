import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  shouldConnectAuthEmulator,
  shouldConnectFirestoreEmulator
} from "../js/firebase-emulator-config.js";
import {
  EMULATOR_HOST,
  PROJECT_ID,
  initializeFirestoreEmulatorApp
} from "../scripts/firestore-emulator-app.js";

test("Firestore seed app uses the explicit emulator project without credentials", () => {
  let initializeCall;
  const app = initializeFirestoreEmulatorApp((options, name) => {
    initializeCall = { options, name };
    return { options };
  }, { FIRESTORE_EMULATOR_HOST: EMULATOR_HOST });

  assert.equal(app.options.projectId, PROJECT_ID);
  assert.deepEqual(initializeCall.options, { projectId: PROJECT_ID });
  assert.equal(Object.hasOwn(initializeCall.options, "credential"), false);
});

test("Firestore seed app refuses a non-exact emulator host before initialization", () => {
  let initialized = false;
  assert.throws(
    () => initializeFirestoreEmulatorApp(() => {
      initialized = true;
    }, { FIRESTORE_EMULATOR_HOST: "localhost:8080" }),
    /FIRESTORE_EMULATOR_HOST must equal 127\.0\.0\.1:8080/
  );
  assert.equal(initialized, false);
});

test("Firestore seed app refuses inherited Google credentials before initialization", () => {
  let initialized = false;
  assert.throws(
    () => initializeFirestoreEmulatorApp(() => {
      initialized = true;
    }, {
      FIRESTORE_EMULATOR_HOST: EMULATOR_HOST,
      GOOGLE_APPLICATION_CREDENTIALS: "configured"
    }),
    /GOOGLE_APPLICATION_CREDENTIALS is set/
  );
  assert.equal(initialized, false);
});

test("Firestore seed app refuses an unexpected initialized project", () => {
  assert.throws(
    () => initializeFirestoreEmulatorApp(
      (options) => ({ options: { ...options, projectId: "unexpected-project" } }),
      { FIRESTORE_EMULATOR_HOST: EMULATOR_HOST }
    ),
    /Unexpected Firebase project/
  );
});

test("Auth Emulator opt-in is disabled by default", () => {
  assert.equal(shouldConnectAuthEmulator({ explicitOptIn: false, hostname: "localhost" }), false);
  assert.equal(shouldConnectAuthEmulator({ explicitOptIn: false, hostname: "127.0.0.1" }), false);
});

test("Auth Emulator opt-in works only on loopback hostnames", () => {
  assert.equal(shouldConnectAuthEmulator({ explicitOptIn: true, hostname: "localhost" }), true);
  assert.equal(shouldConnectAuthEmulator({ explicitOptIn: true, hostname: "127.0.0.1" }), true);
  assert.equal(shouldConnectAuthEmulator({ explicitOptIn: true, hostname: "example.com" }), false);
  assert.equal(shouldConnectAuthEmulator({ explicitOptIn: true, hostname: "" }), false);
});

test("Firestore Emulator opt-in is disabled by default", () => {
  assert.equal(shouldConnectFirestoreEmulator({ hostname: "localhost" }), false);
  assert.equal(shouldConnectFirestoreEmulator({ explicitOptIn: false, hostname: "127.0.0.1" }), false);
});

test("Firestore Emulator requires explicit opt-in on a loopback hostname", () => {
  assert.equal(shouldConnectFirestoreEmulator({ explicitOptIn: true, hostname: "localhost" }), true);
  assert.equal(shouldConnectFirestoreEmulator({ explicitOptIn: true, hostname: "127.0.0.1" }), true);
  assert.equal(shouldConnectFirestoreEmulator({ explicitOptIn: true, hostname: "example.com" }), false);
  assert.equal(shouldConnectFirestoreEmulator({ explicitOptIn: true, hostname: "" }), false);
});

test("Firebase config enables Auth Emulator only through explicit local opt-in", async () => {
  const firebaseConfig = await readFile(new URL("../js/firebase-config.js", import.meta.url), "utf8");

  assert.match(firebaseConfig, /WELLEXSA_USE_AUTH_EMULATOR\s*===\s*true/);
  assert.match(firebaseConfig, /meta\[name="wellexsa-auth-emulator"\]/);
  assert.match(firebaseConfig, /connectAuthEmulator\(auth,\s*"http:\/\/127\.0\.0\.1:9099"/);
  assert.match(firebaseConfig, /shouldConnectAuthEmulator\(\s*\{/);
});

test("normal Firebase config does not enable emulator by default", async () => {
  const firebaseConfig = await readFile(new URL("../js/firebase-config.js", import.meta.url), "utf8");

  assert.match(firebaseConfig, /shouldConnectAuthEmulator/);
  assert.match(firebaseConfig, /explicitOptIn:\s*emulatorOptIn/);
  assert.match(firebaseConfig, /hostname:\s*emulatorHostname/);
});

test("Firebase config connects Firestore Emulator only after local explicit opt-in", async () => {
  const firebaseConfig = await readFile(new URL("../js/firebase-config.js", import.meta.url), "utf8");

  assert.match(firebaseConfig, /WELLEXSA_USE_FIRESTORE_EMULATOR\s*===\s*true/);
  assert.match(firebaseConfig, /meta\[name="wellexsa-firestore-emulator"\]/);
  assert.match(firebaseConfig, /shouldConnectFirestoreEmulator\(\s*\{\s*explicitOptIn:\s*firestoreEmulatorOptIn,\s*hostname:\s*emulatorHostname\s*\}\s*\)/);
  assert.match(firebaseConfig, /initializeApp\(\{\s*\.\.\.firebaseConfig,\s*projectId:\s*"wellexsa-demo"\s*\},\s*"wellexsa-firestore-emulator"\)/);
  assert.match(firebaseConfig, /connectFirestoreEmulator\(db,\s*"127\.0\.0\.1",\s*8080\)/);
});

test("firebase.json configures local Firestore and preserves Auth Emulator port", async () => {
  const firebaseJson = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));

  assert.deepEqual(firebaseJson.emulators?.auth, { port: 9099 });
  assert.deepEqual(firebaseJson.emulators?.firestore, { host: "127.0.0.1", port: 8080 });
  assert.equal(firebaseJson.emulators?.functions, undefined);
  assert.equal(firebaseJson.emulators?.hosting, undefined);
  assert.equal(firebaseJson.emulators?.storage, undefined);
});

test("Firestore Emulator startup uses its dedicated demo project", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(
    packageJson.scripts["emulators:firestore"],
    "firebase emulators:start --only firestore --project wellexsa-demo"
  );
});

test("local backend and integration environment use emulator host with disposable database", async () => {
  const envExample = await readFile(
    new URL("../server/.env.emulator.example", import.meta.url),
    "utf8"
  );
  const databaseConfig = await readFile(
    new URL("../server/src/config/database.js", import.meta.url),
    "utf8"
  );

  assert.match(envExample, /^FIREBASE_AUTH_EMULATOR_HOST=127\.0\.0\.1:9099$/m);
  assert.match(envExample, /^MYSQL_DATABASE=wellexsa_it_20261123_1752$/m);
  assert.doesNotMatch(envExample, /^MYSQL_DATABASE=wellexsa$/m);
  assert.match(databaseConfig, /wellexsa_it_20261123_1752/);
});

test("backend npm scripts isolate normal and emulator environment files", async () => {
  const packageJson = JSON.parse(await readFile(
    new URL("../server/package.json", import.meta.url),
    "utf8"
  ));

  assert.equal(packageJson.scripts.start, "node --env-file=.env src/server.js");
  assert.equal(
    packageJson.scripts["start:emulator"],
    "node --env-file=.env.emulator src/server.js"
  );
  assert.doesNotMatch(packageJson.scripts.start, /\.env\.emulator/);
  assert.doesNotMatch(packageJson.scripts["start:emulator"], /--env-file=\.env(?:\s|$)/);
});
