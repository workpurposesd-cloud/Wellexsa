import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const email = process.argv[2]?.trim().toLowerCase();
const confirmation = process.argv[3];
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;

if (!email || confirmation !== `--confirm-owner=${email}` || !projectId) {
  console.error("Usage: set GOOGLE_CLOUD_PROJECT, then run node scripts/provision-crm-owner.mjs owner@example.com --confirm-owner=owner@example.com");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const db = getFirestore();

try {
  const owner = await auth.getUserByEmail(email);
  if (!owner.emailVerified) {
    throw new Error("Verify the account email in Firebase Authentication before granting CRM Owner access.");
  }

  const existingOwners = await db.collection("crmAccess").where("role", "==", "owner").get();
  const otherOwner = existingOwners.docs.find((doc) => doc.id !== owner.uid && doc.data().active === true);
  if (otherOwner) {
    throw new Error("An active CRM Owner already exists. Use the existing Owner workspace to manage access.");
  }

  await db.collection("crmAccess").doc(owner.uid).set({
    role: "owner",
    active: true,
    displayName: owner.displayName || "Showroom Owner",
    email: owner.email,
    permissions: [],
    minimumAuthTime: Math.floor(Date.now() / 1000) + 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    provisionedBy: "trusted_operator"
  });
  await db.collection("crmAuditEvents").add({
    actorUid: "trusted_operator",
    actorRole: "system",
    action: "owner_provisioned",
    entityType: "owner",
    entityId: owner.uid,
    createdAt: FieldValue.serverTimestamp()
  });
  console.log(`CRM Owner access provisioned for ${owner.email}. Sign in after the next second to establish a fresh session.`);
} catch (error) {
  console.error("CRM Owner provisioning failed:", error.message);
  process.exitCode = 1;
}
