import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const email = process.argv[2]?.trim().toLowerCase();
const username = process.argv[3]?.trim();
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const normalizedUsername = username?.normalize("NFKC").toLowerCase();

if (!email || !email.includes("@") || !/^[a-zA-Z0-9._-]{3,32}$/.test(username || "") || !projectId) {
  console.error("Usage: set GOOGLE_CLOUD_PROJECT, then run npm run provision-admin -- admin@example.com Username");
  process.exitCode = 1;
} else {
  try {
    const temporaryPassword = await promptSecret("Temporary admin password: ");
    const confirmation = await promptSecret("Confirm temporary password: ");
    if (temporaryPassword !== confirmation) throw new Error("Passwords do not match.");
    if (temporaryPassword.length < 8 || temporaryPassword.length > 128) {
      throw new Error("Use a password between 8 and 128 characters.");
    }

    initializeApp({ credential: applicationDefault(), projectId });
    const auth = getAuth();
    const db = getFirestore();
    const mappingRef = db.collection("adminUsernames").doc(normalizedUsername);
    const existingMapping = await mappingRef.get();
    const existingUser = existingMapping.exists
      ? await auth.getUser(existingMapping.data().uid)
      : await auth.getUserByEmail(email).catch((error) => {
        if (error.code === "auth/user-not-found") return null;
        throw error;
      });

    if (existingMapping.exists && existingUser.email.toLowerCase() !== email) {
      throw new Error("That username is already assigned to another account.");
    }

    const user = existingUser
      ? await auth.updateUser(existingUser.uid, { email, password: temporaryPassword, displayName: username, disabled: false })
      : await auth.createUser({ email, password: temporaryPassword, displayName: username, disabled: false });

    await auth.setCustomUserClaims(user.uid, {
      ...user.customClaims,
      admin: true,
      mustChangePassword: true
    });
    await mappingRef.set({
      uid: user.uid,
      createdAt: existingMapping.exists ? existingMapping.data().createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    console.log(`Administrator ${username} was provisioned for ${email}. Require a password change at first sign-in.`);
  } catch (error) {
    console.error("Could not provision the administrator:", error.message);
    process.exitCode = 1;
  }
}

async function promptSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this setup command in an interactive terminal so the password is not echoed.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Administrator setup cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else if (character >= " ") {
          value += character;
        }
      }
    };
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}
