import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const outputRoot = new URL("../cloudflare-public/", import.meta.url);
const expectedFiles = [
  "index.html",
  "bike-details.html",
  "signin.html",
  "signup.html",
  "account.html",
  "privacy.html",
  "terms.html",
  "css/style.css",
  "css/admin.css",
  "js/bike-details.js",
  "js/bikes.js",
  "js/enquiry-whatsapp.js",
  "js/enquiry.js",
  "js/firebase-emulator-config.js",
  "js/firebase-config.js",
  "js/homepage.js",
  "js/site-nav.js",
  "_headers",
  "_redirects",
  "assets/images/wellexsa-logo.png"
];
const excludedCrmFiles = [
  "crm/staff-login.html",
  "crm/staff.html",
  "crm/owner-login.html",
  "css/crm.css",
  "js/api.js",
  "js/crm-config.js",
  "js/crm-dashboard.js",
  "js/crm-login-errors.js",
  "js/crm-login.js"
];

async function listFiles(directory, parent = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(new URL(`${entry.name}/`, directory), relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

test("builds a curated public site and excludes private project files", async () => {
  await execFileAsync(process.execPath, ["scripts/build-cloudflare-public.mjs"], {
    cwd: projectRoot
  });
  const files = await listFiles(outputRoot);
  const fileSet = new Set(files);
  for (const path of expectedFiles) assert.ok(fileSet.has(path), `Missing public file: ${path}`);
  for (const path of excludedCrmFiles) {
    assert.equal(fileSet.has(path), false, `CRM-only file was included: ${path}`);
  }
  assert.ok(files.every((path) => !path.startsWith("crm/")), "CRM pages must not be published.");
  assert.ok(files.every((path) => !/^js\/crm-[^/]+\.js$/.test(path)), "CRM JavaScript must not be published.");
  assert.ok(files.every((path) => !/^css\/crm-[^/]+\.css$/.test(path)), "CRM stylesheets must not be published.");

  assert.ok(files.some((path) => path.startsWith("assets/images/")));
  assert.ok(files.every((path) =>
    !/(^|\/)(server|database|functions|tests|node_modules|\.git)(\/|$)/.test(path) &&
    !/(^|\/)\.env(?:\.|$)/i.test(path)
  ));
  assert.equal(fileSet.has("firebase.json"), false);
  assert.equal(fileSet.has("package.json"), false);
  assert.equal(fileSet.has("firestore.rules"), false);
  assert.equal(fileSet.has("storage.rules"), false);
});

test("Firebase Hosting points at the curated public output", async () => {
  const config = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
  assert.equal(config.hosting.public, "cloudflare-public");
});
