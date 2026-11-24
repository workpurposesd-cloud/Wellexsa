import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { shouldConnectAuthEmulator } from "../js/firebase-emulator-config.js";

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

test("Firebase config enables Auth Emulator only through explicit local opt-in", async () => {
  const firebaseConfig = await readFile(new URL("../js/firebase-config.js", import.meta.url), "utf8");

  assert.match(firebaseConfig, /WELLEXSA_USE_AUTH_EMULATOR\s*===\s*true/);
  assert.match(firebaseConfig, /meta\[name="wellexsa-auth-emulator"\]/);
  assert.match(firebaseConfig, /connectAuthEmulator\(auth,\s*"http:\/\/127\.0\.0\.1:9099"/);
  assert.match(firebaseConfig, /\["localhost",\s*"127\.0\.0\.1"\]/);
});

test("normal Firebase config does not enable emulator by default", async () => {
  const firebaseConfig = await readFile(new URL("../js/firebase-config.js", import.meta.url), "utf8");

  assert.match(firebaseConfig, /shouldConnectAuthEmulator/);
  assert.match(firebaseConfig, /explicitOptIn:\s*emulatorOptIn/);
  assert.match(firebaseConfig, /hostname:\s*emulatorHostname/);
});

test("firebase.json starts only the Auth Emulator on port 9099", async () => {
  const firebaseJson = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));

  assert.deepEqual(firebaseJson.emulators?.auth, { port: 9099 });
  assert.equal(firebaseJson.emulators?.functions, undefined);
  assert.equal(firebaseJson.emulators?.firestore, undefined);
  assert.equal(firebaseJson.emulators?.hosting, undefined);
  assert.equal(firebaseJson.emulators?.storage, undefined);
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
