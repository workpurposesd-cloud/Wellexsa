import { createHash } from "node:crypto";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const applyChanges = process.argv.includes("--apply");
if (!projectId) {
  console.error("Set GOOGLE_CLOUD_PROJECT to the existing Firebase project.");
  process.exit(1);
}
if (applyChanges && process.env.CRM_MIGRATION_CONFIRM_PROJECT !== projectId) {
  console.error("For --apply, set CRM_MIGRATION_CONFIRM_PROJECT to the exact project ID.");
  process.exit(1);
}

function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^\+?[0-9\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (/^\+?91/.test(raw) && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `+91${digits}`;
  if (raw.startsWith("+") && digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

function phoneHash(phone) {
  return createHash("sha256").update(phone).digest("hex");
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const [profiles, existingPhoneIndex, existingUserIndex] = await Promise.all([
  db.collection("users").get(),
  db.collection("crmPhoneIndex").get(),
  db.collection("crmWebUserIndex").get()
]);
const counts = {
  profiles: profiles.size,
  imported: 0,
  queuedForReview: 0,
  invalidPhone: 0,
  alreadyLinked: 0
};

if (!applyChanges) {
  const seenPhones = new Set(existingPhoneIndex.docs.map((doc) => doc.id));
  const linkedUsers = new Set(existingUserIndex.docs.map((doc) => doc.id));
  for (const profileDoc of profiles.docs) {
    if (linkedUsers.has(profileDoc.id)) {
      counts.alreadyLinked += 1;
      continue;
    }
    const profile = profileDoc.data();
    const phone = normalizePhone(profile.mobile);
    if (!phone) {
      counts.invalidPhone += 1;
      continue;
    }
    const hash = phoneHash(phone);
    if (seenPhones.has(hash)) counts.queuedForReview += 1;
    else {
      seenPhones.add(hash);
      counts.imported += 1;
    }
  }
  console.log("CRM profile migration dry run:", counts);
  console.log("No records were written. Review duplicate and invalid phone counts before using --apply.");
  process.exit(0);
}

for (const profileDoc of profiles.docs) {
  const uid = profileDoc.id;
  const profile = profileDoc.data();
  const userLinkRef = db.collection("crmWebUserIndex").doc(uid);
  const phone = normalizePhone(profile.mobile);
  if (!phone) {
    const intakeRef = db.collection("crmLeadIntakes").doc(uid);
    const outcome = await db.runTransaction(async (transaction) => {
      const [link, intake] = await Promise.all([
        transaction.get(userLinkRef),
        transaction.get(intakeRef)
      ]);
      if (link.exists) return "alreadyLinked";
      if (intake.exists) {
        transaction.create(userLinkRef, { intakeId: uid, status: "needs_review" });
        return "queuedForReview";
      }
      transaction.create(intakeRef, {
        sourceUid: uid,
        name: typeof profile.name === "string" ? profile.name.slice(0, 100) : "",
        email: typeof profile.email === "string" ? profile.email.slice(0, 254) : "",
        phone: typeof profile.mobile === "string" ? profile.mobile.slice(0, 32) : "",
        status: "needs_review",
        reason: "invalid_phone",
        createdAt: FieldValue.serverTimestamp()
      });
      transaction.create(userLinkRef, { intakeId: uid, status: "needs_review" });
      return "invalidPhone";
    });
    counts[outcome] += 1;
    continue;
  }

  const hash = phoneHash(phone);
  const indexRef = db.collection("crmPhoneIndex").doc(hash);
  const customerRef = db.collection("crmCustomers").doc();
  const intakeRef = db.collection("crmLeadIntakes").doc(uid);
  const outcome = await db.runTransaction(async (transaction) => {
    const [userLink, existingIntake, index] = await Promise.all([
      transaction.get(userLinkRef),
      transaction.get(intakeRef),
      transaction.get(indexRef)
    ]);
    if (userLink.exists) return "alreadyLinked";
    if (existingIntake.exists) {
      transaction.create(userLinkRef, { intakeId: uid, status: "needs_review" });
      return "queuedForReview";
    }
    if (index.exists) {
      transaction.create(intakeRef, {
        sourceUid: uid,
        name: typeof profile.name === "string" ? profile.name.slice(0, 100) : "",
        email: typeof profile.email === "string" ? profile.email.slice(0, 254) : "",
        phone,
        phoneHash: hash,
        matchedCustomerId: index.data().customerId,
        status: "needs_review",
        reason: "phone_match_requires_review",
        createdAt: FieldValue.serverTimestamp()
      });
      transaction.create(userLinkRef, { intakeId: uid, status: "needs_review" });
      return "queuedForReview";
    }
    transaction.create(customerRef, {
      name: typeof profile.name === "string" ? profile.name.slice(0, 100) : "",
      phone,
      phoneHash: hash,
      email: typeof profile.email === "string" ? profile.email.slice(0, 254) : "",
      customerType: "existing",
      source: "website_existing",
      sourceUid: uid,
      status: "new",
      interestStatus: "Need More Time",
      callStatus: "",
      interestedBike: "",
      assignedStaffUid: null,
      nextFollowUpAt: null,
      deletedAt: null,
      isArchived: false,
      normalizedName: typeof profile.name === "string"
        ? profile.name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
        : "",
      createdAt: profile.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(indexRef, { customerId: customerRef.id, createdAt: FieldValue.serverTimestamp() });
    transaction.create(userLinkRef, { customerId: customerRef.id, status: "linked" });
    return "imported";
  });
  counts[outcome] += 1;
}

await db.collection("crmAuditEvents").add({
  actorUid: "trusted_operator",
  actorRole: "system",
  action: "existing_profiles_migrated",
  entityType: "migration",
  entityId: projectId,
  details: counts,
  createdAt: FieldValue.serverTimestamp()
});
console.log("CRM profile migration completed:", counts);
