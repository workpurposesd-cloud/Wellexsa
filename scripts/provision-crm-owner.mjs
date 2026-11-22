import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const expectedProjectId = "wellexsa";

if (!projectId) {
  console.error("Set GOOGLE_CLOUD_PROJECT to the Firebase project ID before provisioning.");
  process.exit(1);
}
if (projectId !== expectedProjectId) {
  console.error(`Refusing to provision CRM Owner outside project "${expectedProjectId}". No account changes were made.`);
  process.exit(1);
}
if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
  console.error("Run this script in an interactive terminal so the password can be entered without echo.");
  process.exit(1);
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    let value = "";
    const decoder = new StringDecoder("utf8");
    const finish = (error) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of decoder.write(chunk)) {
        if (character === "\u0003") {
          finish(new Error("Provisioning cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
        } else {
          value += character;
        }
      }
    };
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function fail(message) {
  throw new Error(message);
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const db = getFirestore();

let createdAuthUser = false;
let ownerAccessProvisioned = false;
let owner;
let enteredPassword = "";

try {
  const prompt = createInterface({ input: stdin, output: stdout });
  let email;
  try {
    email = (await prompt.question("Owner email: ")).trim().toLowerCase();
  } finally {
    prompt.close();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Enter a valid email address.");

  let existingUser = null;
  try {
    existingUser = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
  if (existingUser?.disabled) {
    fail("This Firebase account is disabled. Enable it through an authorized administrative process before provisioning.");
  }

  const existingAccess = existingUser
    ? await db.collection("crmAccess").doc(existingUser.uid).get()
    : null;
  const existingOwners = await db.collection("crmAccess")
    .where("role", "==", "owner")
    .get();
  const otherOwner = existingOwners.docs.find((document) =>
    document.id !== existingUser?.uid && document.data().active === true);
  if (otherOwner) {
    fail("Another active CRM Owner already exists. Use that Owner workspace to manage access.");
  }

  const confirmation = existingUser
    ? existingAccess?.data()?.role === "owner"
      ? `UPDATE OWNER ${email}`
      : `PROMOTE ${email}`
    : `CREATE OWNER ${email}`;
  if (existingUser) {
    if (existingAccess?.data()?.role === "staff") {
      console.log("This account currently has CRM Staff access and will be promoted to Owner.");
    } else {
      console.log("This Firebase account will receive CRM Owner access.");
    }
    console.log("The existing account password will remain unchanged.");
  }
  const confirmationPrompt = createInterface({ input: stdin, output: stdout });
  let typedConfirmation;
  try {
    typedConfirmation = await confirmationPrompt.question(`Type "${confirmation}" to continue: `);
  } finally {
    confirmationPrompt.close();
  }
  if (typedConfirmation !== confirmation) fail("Confirmation did not match; no account changes were made.");

  if (existingUser) {
    owner = existingUser;
  } else {
    enteredPassword = await readHidden("New Owner password (minimum 12 characters): ");
    const passwordConfirmation = await readHidden("Re-enter password: ");
    if (enteredPassword.length < 12) fail("Choose a password with at least 12 characters.");
    if (enteredPassword !== passwordConfirmation) fail("Passwords did not match; no account changes were made.");

    owner = await auth.createUser({
      email,
      password: enteredPassword,
      displayName: "Showroom Owner",
      emailVerified: false,
      disabled: false
    });
    createdAuthUser = true;
  }

  const accessRef = db.collection("crmAccess").doc(owner.uid);
  const auditRef = db.collection("crmAuditEvents").doc();

  await db.runTransaction(async (transaction) => {
    const activeOwnerQuery = db.collection("crmAccess")
      .where("role", "==", "owner");
    const activeOwners = await transaction.get(activeOwnerQuery);
    if (activeOwners.docs.some((document) =>
      document.id !== owner.uid && document.data().active === true)) {
      fail("Another active CRM Owner was provisioned concurrently. No access record was changed.");
    }
    const currentAccess = await transaction.get(accessRef);
    const now = Math.floor(Date.now() / 1000);
    transaction.set(accessRef, {
      role: "owner",
      active: true,
      displayName: owner.displayName || "Showroom Owner",
      email: owner.email || email,
      permissions: [],
      minimumAuthTime: now + 2,
      createdAt: currentAccess.exists
        ? currentAccess.data().createdAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: "trusted_operator"
    });
    transaction.create(auditRef, {
      actorUid: "trusted_operator",
      actorRole: "system",
      action: "owner_provisioned",
      entityType: "owner",
      entityId: owner.uid,
      createdAt: FieldValue.serverTimestamp()
    });
  });
  ownerAccessProvisioned = true;
  enteredPassword = "";

  console.log(`CRM Owner access provisioned for ${owner.email || email} (UID ${owner.uid}).`);
  if (!owner.emailVerified) {
    console.log("Email verification is required. Sign in once at the Owner page to receive a Firebase verification email, then verify before continuing.");
  } else {
    console.log("The Firebase account email is already verified.");
  }
  console.log("Sign out of any existing CRM session, then sign in again after two seconds.");
} catch (error) {
  if (createdAuthUser && !ownerAccessProvisioned && owner) {
    try {
      await auth.deleteUser(owner.uid);
    } catch (cleanupError) {
      console.error("Could not remove the incomplete Auth account", {
        code: cleanupError?.code || cleanupError?.name || "unknown"
      });
    }
  }
  let message = typeof error?.message === "string" ? error.message : "Unexpected provisioning failure.";
  if (enteredPassword) message = message.split(enteredPassword).join("[redacted]");
  console.error("CRM Owner provisioning failed:", message);
  if (error?.code) console.error("Firebase error code:", error.code);
  process.exitCode = 1;
}
