import { cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "cloudflare-public");
const allowedFiles = [
  "_headers",
  "_redirects",
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
  "js/site-nav.js"
];

function assertInside(parent, candidate) {
  const path = relative(parent, candidate);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || resolve(parent, path) !== candidate) {
    throw new Error("A public build path escaped its approved directory.");
  }
}

async function copyAllowedPath(source, destination) {
  const details = await lstat(source);
  if (details.isSymbolicLink()) {
    throw new Error(`Refusing to include a symbolic link in the public build: ${relative(projectRoot, source)}`);
  }
  if (details.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) {
      await copyAllowedPath(join(source, entry), join(destination, entry));
    }
    return;
  }
  if (!details.isFile()) {
    throw new Error(`Unsupported public asset type: ${relative(projectRoot, source)}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

assertInside(projectRoot, outputDirectory);
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const path of allowedFiles) {
  const source = resolve(projectRoot, path);
  const destination = resolve(outputDirectory, path);
  assertInside(projectRoot, source);
  assertInside(outputDirectory, destination);
  await copyAllowedPath(source, destination);
}

await copyAllowedPath(
  resolve(projectRoot, "assets/images"),
  resolve(outputDirectory, "assets/images")
);

console.log(`Built ${allowedFiles.length} approved files and assets in cloudflare-public.`);
