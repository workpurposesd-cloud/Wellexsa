import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

const CRM_PERMISSIONS = new Set([
  "customers:view",
  "customers:create",
  "customers:edit",
  "contacts:log",
  "leads:resolve",
  "purchases:view",
  "purchases:create",
  "purchases:edit",
  "reminders:view"
]);
const STAFF_DEFAULT_PERMISSIONS = [...CRM_PERMISSIONS];
const CALL_STATUSES = new Set(["Answered", "Not Answered", "Switched Off", "Busy", "Wrong Number"]);
const INTEREST_STATUSES = new Set([
  "Very Interested", "Interested", "Need More Time", "Not Interested", "Already Purchased"
]);
const PURCHASE_STATUSES = new Set(["completed", "pending_delivery"]);
const PAYMENT_STATUSES = new Set(["unpaid", "partial", "paid"]);
const DELIVERY_STATUSES = new Set(["pending", "ready", "delivered"]);
const BATTERY_TYPES = new Set(["Lithium", "Lead Acid", "Other", "Not Applicable"]);

function db() {
  return getFirestore();
}

function text(value, field, maxLength, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new HttpsError("invalid-argument", `${field} is required.`);
    return "";
  }
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }
  const result = value.trim();
  if ((required && !result) || result.length > maxLength) {
    throw new HttpsError("invalid-argument", `${field} is invalid.`);
  }
  return result;
}

function normalizePhone(value) {
  if (typeof value !== "string") throw new HttpsError("invalid-argument", "Phone number is invalid.");
  const raw = value.trim();
  if (!/^\+?[0-9\s().-]+$/.test(raw)) {
    throw new HttpsError("invalid-argument", "Phone number is invalid.");
  }
  let digits = raw.replace(/\D/g, "");
  if (/^\+?91/.test(raw) && digits.length === 12) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `+91${digits}`;
  if (raw.startsWith("+") && digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  throw new HttpsError("invalid-argument", "Enter a valid phone number.");
}

function phoneHash(phone) {
  return createHash("sha256").update(phone).digest("hex");
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validDocumentId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

function normalizePermissions(value, defaults = []) {
  if (value === undefined) return defaults;
  if (!Array.isArray(value) || value.some((permission) =>
    typeof permission !== "string" || !CRM_PERMISSIONS.has(permission))) {
    throw new HttpsError("invalid-argument", "Staff permissions are invalid.");
  }
  return [...new Set(value)];
}

async function requireCrmUser(request, permission = null) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to the CRM.");
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError("permission-denied", "Verify the account email before using CRM access.");
  }
  const snapshot = await db().collection("crmAccess").doc(request.auth.uid).get();
  const access = snapshot.exists ? snapshot.data() : null;
  if (!access || access.active !== true || !["owner", "staff"].includes(access.role)) {
    throw new HttpsError("permission-denied", "This account does not have active CRM access.");
  }
  if (access.role === "staff" && (!Array.isArray(access.permissions) ||
      access.permissions.some((item) => !CRM_PERMISSIONS.has(item)))) {
    throw new HttpsError("permission-denied", "The CRM access record is invalid.");
  }
  const authTime = request.auth.token.auth_time;
  if (!Number.isSafeInteger(authTime) || !Number.isSafeInteger(access.minimumAuthTime) ||
      authTime < access.minimumAuthTime) {
    throw new HttpsError("permission-denied", "Sign out and sign in again to activate this CRM session.");
  }
  if (permission && access.role !== "owner" && (!Array.isArray(access.permissions) ||
      !access.permissions.includes(permission))) {
    throw new HttpsError("permission-denied", "This CRM permission is not assigned to your account.");
  }
  return {
    uid: request.auth.uid,
    role: access.role,
    displayName: access.displayName || request.auth.token.name || "",
    email: access.email || request.auth.token.email || "",
    permissions: access.role === "owner" ? [...CRM_PERMISSIONS] : access.permissions
  };
}

function requireOwner(user) {
  if (user.role !== "owner") {
    throw new HttpsError("permission-denied", "Owner access is required.");
  }
}

function addAudit(transaction, actor, action, entityType, entityId, details = {}) {
  const ref = db().collection("crmAuditEvents").doc();
  transaction.create(ref, {
    actorUid: actor.uid,
    actorRole: actor.role,
    action,
    entityType,
    entityId,
    details,
    createdAt: FieldValue.serverTimestamp()
  });
}

function indiaDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function todayInIndia() {
  return indiaDateKey(new Date());
}

function followUpTimestamp(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < todayInIndia()) {
    throw new HttpsError("invalid-argument", "Choose today or a future follow-up date.");
  }
  const date = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime()) || indiaDateKey(date) !== value) {
    throw new HttpsError("invalid-argument", "Follow-up date is invalid.");
  }
  return Timestamp.fromDate(date);
}

async function leastAssignedActiveStaff() {
  const snapshot = await db().collection("crmAccess")
    .where("role", "==", "staff")
    .where("active", "==", true)
    .get();
  return snapshot.docs
    .filter((doc) => Array.isArray(doc.data().permissions) &&
      doc.data().permissions.includes("customers:view"))
    .sort((first, second) =>
      (first.data().assignedLeadCount || 0) - (second.data().assignedLeadCount || 0) ||
      first.id.localeCompare(second.id)
    )[0]?.id || null;
}

async function assignStaff(transaction, uid) {
  if (!uid) return null;
  const ref = db().collection("crmAccess").doc(uid);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists || snapshot.data().role !== "staff" || snapshot.data().active !== true) return null;
  transaction.update(ref, { assignedLeadCount: FieldValue.increment(1) });
  return uid;
}

function cleanCustomerInput(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Customer details are invalid.");
  }
  const name = text(data.name, "Customer name", 100, true);
  const phone = normalizePhone(data.phone);
  const email = text(data.email, "Email", 254);
  if (!validEmail(email)) throw new HttpsError("invalid-argument", "Email address is invalid.");
  const interestedBike = text(data.interestedBike, "Interested bike", 100);
  const customerType = data.customerType || "new";
  if (!["new", "existing"].includes(customerType)) {
    throw new HttpsError("invalid-argument", "Customer type is invalid.");
  }
  return { name, phone, email, interestedBike, customerType };
}

function searchableName(name) {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

async function writeWebsiteLead(uid, profile) {
  const userRef = db().collection("crmWebUserIndex").doc(uid);
  const intakeRef = db().collection("crmLeadIntakes").doc(uid);
  let phone;
  try {
    phone = normalizePhone(profile.mobile);
  } catch {
    await db().runTransaction(async (transaction) => {
      if ((await transaction.get(userRef)).exists) return;
      transaction.create(intakeRef, {
        sourceUid: uid,
        name: typeof profile.name === "string" ? profile.name.slice(0, 100) : "",
        email: typeof profile.email === "string" ? profile.email.slice(0, 254) : "",
        phone: typeof profile.mobile === "string" ? profile.mobile.slice(0, 32) : "",
        status: "needs_review",
        reason: "invalid_phone",
        createdAt: FieldValue.serverTimestamp()
      });
      transaction.create(userRef, { intakeId: uid, status: "needs_review" });
    });
    return;
  }

  const hash = phoneHash(phone);
  const indexRef = db().collection("crmPhoneIndex").doc(hash);
  const existingCustomerRef = db().collection("crmCustomers");
  const assigneeUid = await leastAssignedActiveStaff();
  await db().runTransaction(async (transaction) => {
    if ((await transaction.get(userRef)).exists) return;
    const index = await transaction.get(indexRef);
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
      transaction.create(userRef, { intakeId: uid, status: "needs_review" });
      return;
    }

    const customerRef = existingCustomerRef.doc();
    const assignedStaffUid = await assignStaff(transaction, assigneeUid);
    transaction.create(customerRef, {
      name: typeof profile.name === "string" ? profile.name.slice(0, 100) : "",
      phone,
      phoneHash: hash,
      email: typeof profile.email === "string" ? profile.email.slice(0, 254) : "",
      customerType: "new",
      source: "website",
      sourceUid: uid,
      status: "new",
      interestStatus: "Need More Time",
      callStatus: "",
      interestedBike: "",
      assignedStaffUid,
      nextFollowUpAt: null,
      deletedAt: null,
      isArchived: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      normalizedName: searchableName(typeof profile.name === "string" ? profile.name : "")
    });
    transaction.create(indexRef, { customerId: customerRef.id, createdAt: FieldValue.serverTimestamp() });
    transaction.create(userRef, { customerId: customerRef.id, status: "linked" });
    addAudit(transaction, { uid: "system", role: "system" }, "website_lead_created", "customer", customerRef.id);
  });
}

export const crmGetSession = onCall({ region: "us-central1" }, async (request) => {
  const user = await requireCrmUser(request);
  return {
    role: user.role,
    displayName: user.displayName,
    email: user.email,
    permissions: user.permissions
  };
});

export const crmListStaff = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request, "customers:view");
  const snapshot = await db().collection("crmAccess").where("role", "==", "staff").get();
  return {
    staff: snapshot.docs
      .filter((doc) => actor.role === "owner" || doc.data().active === true)
      .map((doc) => {
        const staff = doc.data();
        return {
          uid: doc.id,
          email: actor.role === "owner" ? staff.email || "" : "",
          displayName: staff.displayName || "",
          active: staff.active === true,
          permissions: actor.role === "owner" && Array.isArray(staff.permissions) ? staff.permissions : [],
          assignedLeadCount: actor.role === "owner" && Number.isSafeInteger(staff.assignedLeadCount)
            ? staff.assignedLeadCount
            : 0,
          contactCount: actor.role === "owner" && Number.isSafeInteger(staff.contactCount)
            ? staff.contactCount
            : 0,
          lastContactAt: actor.role === "owner" ? staff.lastContactAt || null : null
        };
      })
  };
});

export const crmCreateCustomer = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request, "customers:create");
  const input = cleanCustomerInput(request.data);
  const hash = phoneHash(input.phone);
  const indexRef = db().collection("crmPhoneIndex").doc(hash);
  const assigneeUid = actor.role === "staff" ? actor.uid : await leastAssignedActiveStaff();
  const customerRef = db().collection("crmCustomers").doc();
  const result = await db().runTransaction(async (transaction) => {
    const index = await transaction.get(indexRef);
    if (index.exists) return { duplicate: true, customerId: index.data().customerId };
    const assignedStaffUid = await assignStaff(transaction, assigneeUid);
    transaction.create(customerRef, {
      ...input,
      phoneHash: hash,
      source: "showroom",
      sourceUid: null,
      status: "new",
      interestStatus: "Need More Time",
      callStatus: "",
      assignedStaffUid,
      nextFollowUpAt: null,
      deletedAt: null,
      isArchived: false,
      normalizedName: searchableName(input.name),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(indexRef, {
      customerId: customerRef.id,
      createdAt: FieldValue.serverTimestamp()
    });
    addAudit(transaction, actor, "customer_created", "customer", customerRef.id, { source: "showroom" });
    return { duplicate: false, customerId: customerRef.id };
  });
  return result;
});

export const crmSubmitBikeEnquiry = onCall(
  { region: "us-central1", maxInstances: 10 },
  async (request) => {
    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some((key) => !["requestId", "name", "mobile", "bikeModel"].includes(key))) {
      throw new HttpsError("invalid-argument", "Enquiry details are invalid.");
    }
    const requestId = data.requestId;
    if (typeof requestId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new HttpsError("invalid-argument", "Enquiry request is invalid.");
    }
    const name = text(data.name, "Customer name", 100, true);
    if (typeof data.mobile !== "string" || !/^[6-9]\d{9}$/.test(data.mobile)) {
      throw new HttpsError("invalid-argument", "Enter a valid 10-digit Indian mobile number.");
    }
    const phone = `+91${data.mobile}`;
    const bikeModel = text(data.bikeModel, "Bike model", 100, true);
    const hash = phoneHash(phone);
    const enquiryRef = db().collection("crmEnquiries").doc(requestId);
    const indexRef = db().collection("crmPhoneIndex").doc(hash);
    const newCustomerRef = db().collection("crmCustomers").doc();
    const assigneeUid = await leastAssignedActiveStaff();

    await db().runTransaction(async (transaction) => {
      if ((await transaction.get(enquiryRef)).exists) return;
      const index = await transaction.get(indexRef);
      let customerRef = newCustomerRef;
      let customerType = "new";
      if (index.exists) {
        if (typeof index.data().customerId !== "string") {
          throw new HttpsError("internal", "The matching customer record could not be verified.");
        }
        customerRef = db().collection("crmCustomers").doc(index.data().customerId);
        const customer = await transaction.get(customerRef);
        if (!customer.exists) {
          throw new HttpsError("internal", "The matching customer record could not be found.");
        }
        customerType = "existing";
      } else {
        const assignedStaffUid = await assignStaff(transaction, assigneeUid);
        transaction.create(customerRef, {
          name,
          phone,
          phoneHash: hash,
          email: "",
          customerType: "new",
          source: "website_enquiry",
          sourceUid: null,
          status: "new",
          interestStatus: "Need More Time",
          callStatus: "",
          interestedBike: bikeModel,
          assignedStaffUid,
          nextFollowUpAt: null,
          deletedAt: null,
          isArchived: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          normalizedName: searchableName(name)
        });
        transaction.create(indexRef, {
          customerId: customerRef.id,
          createdAt: FieldValue.serverTimestamp()
        });
      }

      transaction.create(enquiryRef, {
        customerId: customerRef.id,
        customerName: name,
        mobile: phone,
        customerType,
        bikeModel,
        status: "new",
        createdAt: FieldValue.serverTimestamp()
      });
      addAudit(
        transaction,
        { uid: "system", role: "system" },
        "website_enquiry_received",
        "enquiry",
        requestId,
        { customerId: customerRef.id, bikeModel }
      );
    });

    return { submitted: true };
  }
);

export const crmUpdateCustomer = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request, "customers:edit");
  const { customerId, changes } = request.data || {};
  if (!validDocumentId(customerId) || !changes || typeof changes !== "object" ||
      Array.isArray(changes)) {
    throw new HttpsError("invalid-argument", "Customer changes are invalid.");
  }
  const allowedFields = new Set(["name", "phone", "email", "interestedBike", "customerType", "assignedStaffUid"]);
  if (Object.keys(changes).some((field) => !allowedFields.has(field))) {
    throw new HttpsError("invalid-argument", "Customer changes contain unsupported fields.");
  }
  const customerRef = db().collection("crmCustomers").doc(customerId);
  const updates = {};
  if ("name" in changes) {
    updates.name = text(changes.name, "Customer name", 100, true);
    updates.normalizedName = searchableName(updates.name);
  }
  if ("email" in changes) {
    updates.email = text(changes.email, "Email", 254);
    if (!validEmail(updates.email)) throw new HttpsError("invalid-argument", "Email address is invalid.");
  }
  if ("interestedBike" in changes) updates.interestedBike = text(changes.interestedBike, "Interested bike", 100);
  if ("customerType" in changes) {
    if (!["new", "existing"].includes(changes.customerType)) {
      throw new HttpsError("invalid-argument", "Customer type is invalid.");
    }
    updates.customerType = changes.customerType;
  }
  if ("assignedStaffUid" in changes) {
    requireOwner(actor);
    const assignedStaffUid = text(changes.assignedStaffUid, "Assigned staff", 128);
    if (assignedStaffUid) {
      if (!validDocumentId(assignedStaffUid)) {
        throw new HttpsError("invalid-argument", "Assigned staff member is invalid.");
      }
      const staff = await db().collection("crmAccess").doc(assignedStaffUid).get();
      if (!staff.exists || staff.data().role !== "staff" || staff.data().active !== true) {
        throw new HttpsError("invalid-argument", "Choose an active staff member.");
      }
    }
    updates.assignedStaffUid = assignedStaffUid || null;
  }
  const newPhone = "phone" in changes ? normalizePhone(changes.phone) : null;
  const result = await db().runTransaction(async (transaction) => {
    const customer = await transaction.get(customerRef);
    if (!customer.exists || customer.data().deletedAt) throw new HttpsError("not-found", "Customer was not found.");
    if (newPhone && newPhone !== customer.data().phone) {
      const newIndexRef = db().collection("crmPhoneIndex").doc(phoneHash(newPhone));
      const newIndex = await transaction.get(newIndexRef);
      if (newIndex.exists && newIndex.data().customerId !== customerId) {
        return { duplicate: true, customerId: newIndex.data().customerId };
      }
      const oldIndexRef = db().collection("crmPhoneIndex").doc(customer.data().phoneHash);
      transaction.delete(oldIndexRef);
      transaction.create(newIndexRef, { customerId, createdAt: FieldValue.serverTimestamp() });
      updates.phone = newPhone;
      updates.phoneHash = phoneHash(newPhone);
    }
    updates.updatedAt = FieldValue.serverTimestamp();
    transaction.update(customerRef, updates);
    addAudit(transaction, actor, "customer_updated", "customer", customerId, { fields: Object.keys(updates) });
    return { duplicate: false, customerId };
  });
  return result;
});

export const crmLogContact = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request, "contacts:log");
  const { customerId, callStatus, interestStatus, notes, nextFollowUpDate } = request.data || {};
  if (!validDocumentId(customerId) || !CALL_STATUSES.has(callStatus) ||
      !INTEREST_STATUSES.has(interestStatus) || interestStatus === "Already Purchased") {
    throw new HttpsError("invalid-argument", "Contact details are invalid. Use Mark as Purchased for completed sales.");
  }
  const cleanNotes = text(notes, "Notes", 2000);
  const followUpAt = followUpTimestamp(nextFollowUpDate);
  const customerRef = db().collection("crmCustomers").doc(customerId);
  const eventRef = customerRef.collection("contactHistory").doc();
  const staffRef = db().collection("crmAccess").doc(actor.uid);
  await db().runTransaction(async (transaction) => {
    const [customer, staff] = await Promise.all([
      transaction.get(customerRef),
      transaction.get(staffRef)
    ]);
    if (!customer.exists || customer.data().deletedAt) throw new HttpsError("not-found", "Customer was not found.");
    if (actor.role === "staff" && (!staff.exists || staff.data().active !== true)) {
      throw new HttpsError("permission-denied", "Staff access is no longer active.");
    }
    const status = interestStatus === "Not Interested" ? "not_interested" : "active";
    transaction.create(eventRef, {
      actorUid: actor.uid,
      actorName: actor.displayName,
      callStatus,
      interestStatus,
      notes: cleanNotes,
      nextFollowUpAt: followUpAt,
      createdAt: FieldValue.serverTimestamp()
    });
    transaction.update(customerRef, {
      callStatus,
      interestStatus,
      status,
      nextFollowUpAt: followUpAt,
      updatedAt: FieldValue.serverTimestamp()
    });
    addAudit(transaction, actor, "contact_logged", "customer", customerId, { callStatus, interestStatus });
  });
  return { saved: true };
});

export const crmMarkPurchased = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request, "purchases:create");
  const {
    customerId, requestId, bikeModel, otherModel, batteryType,
    purchaseStatus, paymentStatus, deliveryStatus, warrantyDetails
  } = request.data || {};
  if (!validDocumentId(customerId) || typeof requestId !== "string" ||
      !/^[a-zA-Z0-9-]{16,64}$/.test(requestId) ||
      !PURCHASE_STATUSES.has(purchaseStatus) || !PAYMENT_STATUSES.has(paymentStatus) ||
      !DELIVERY_STATUSES.has(deliveryStatus) || !BATTERY_TYPES.has(batteryType)) {
    throw new HttpsError("invalid-argument", "Purchase details are invalid.");
  }
  const modelSelection = text(bikeModel, "Bike model", 100, true);
  const resolvedModel = modelSelection === "Other"
    ? text(otherModel, "Other bike model", 100, true)
    : modelSelection;
  const warranty = text(warrantyDetails, "Warranty details", 1000);
  const customerRef = db().collection("crmCustomers").doc(customerId);
  const requestRef = db().collection("crmPurchaseRequests").doc(`${actor.uid}_${requestId}`);
  const purchaseRef = db().collection("crmPurchases").doc();
  const result = await db().runTransaction(async (transaction) => {
    const [existingRequest, customer] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(customerRef)
    ]);
    if (existingRequest.exists) {
      if (existingRequest.data().customerId !== customerId) {
        throw new HttpsError("failed-precondition", "This purchase request ID is already in use.");
      }
      return { purchaseId: existingRequest.data().purchaseId, existing: true };
    }
    if (!customer.exists || customer.data().deletedAt) throw new HttpsError("not-found", "Customer was not found.");
    transaction.create(purchaseRef, {
      customerId,
      customerName: customer.data().name,
      customerPhone: customer.data().phone,
      bikeModel: resolvedModel,
      batteryType,
      purchaseStatus,
      paymentStatus,
      deliveryStatus,
      warrantyDetails: warranty,
      purchaseDate: FieldValue.serverTimestamp(),
      markedByUid: actor.uid,
      markedByName: actor.displayName,
      isArchived: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    transaction.create(requestRef, {
      customerId,
      purchaseId: purchaseRef.id,
      createdAt: FieldValue.serverTimestamp()
    });
    transaction.update(customerRef, {
      status: "purchased",
      purchaseDate: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    addAudit(transaction, actor, "purchase_created", "purchase", purchaseRef.id, { customerId, bikeModel: resolvedModel });
    return { purchaseId: purchaseRef.id, existing: false };
  });
  return result;
});

export const crmUpdatePurchase = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request, "purchases:edit");
  const { purchaseId, changes } = request.data || {};
  const allowedFields = new Set([
    "bikeModel", "batteryType", "purchaseStatus", "paymentStatus", "deliveryStatus", "warrantyDetails"
  ]);
  if (!validDocumentId(purchaseId) || !changes || typeof changes !== "object" ||
      Array.isArray(changes) || Object.keys(changes).some((field) => !allowedFields.has(field))) {
    throw new HttpsError("invalid-argument", "Purchase changes are invalid.");
  }
  const updates = {};
  for (const [field, values] of Object.entries({
    batteryType: BATTERY_TYPES,
    purchaseStatus: PURCHASE_STATUSES,
    paymentStatus: PAYMENT_STATUSES,
    deliveryStatus: DELIVERY_STATUSES
  })) {
    if (field in changes) {
      if (!values.has(changes[field])) throw new HttpsError("invalid-argument", `${field} is invalid.`);
      updates[field] = changes[field];
    }
  }
  if ("bikeModel" in changes) updates.bikeModel = text(changes.bikeModel, "Bike model", 100, true);
  if ("warrantyDetails" in changes) updates.warrantyDetails = text(changes.warrantyDetails, "Warranty details", 1000);
  if (!Object.keys(updates).length) throw new HttpsError("invalid-argument", "No purchase changes were provided.");
  const purchaseRef = db().collection("crmPurchases").doc(purchaseId);
  await db().runTransaction(async (transaction) => {
    const purchase = await transaction.get(purchaseRef);
    if (!purchase.exists || purchase.data().isArchived) throw new HttpsError("not-found", "Purchase was not found.");
    updates.updatedAt = FieldValue.serverTimestamp();
    transaction.update(purchaseRef, updates);
    addAudit(transaction, actor, "purchase_updated", "purchase", purchaseId, { fields: Object.keys(updates) });
  });
  return { saved: true };
});

export const crmArchiveRecord = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request);
  requireOwner(actor);
  const { entityType, entityId, archive = true } = request.data || {};
  if (!["customer", "purchase"].includes(entityType) || !validDocumentId(entityId)) {
    throw new HttpsError("invalid-argument", "Record selection is invalid.");
  }
  if (typeof archive !== "boolean") throw new HttpsError("invalid-argument", "Archive setting is invalid.");
  const collectionName = entityType === "customer" ? "crmCustomers" : "crmPurchases";
  const recordRef = db().collection(collectionName).doc(entityId);
  await db().runTransaction(async (transaction) => {
    const record = await transaction.get(recordRef);
    if (!record.exists) throw new HttpsError("not-found", "Record was not found.");
    transaction.update(recordRef, {
      isArchived: archive,
      deletedAt: archive ? FieldValue.serverTimestamp() : null,
      deletedByUid: archive ? actor.uid : null,
      updatedAt: FieldValue.serverTimestamp()
    });
    addAudit(transaction, actor, archive ? `${entityType}_archived` : `${entityType}_restored`, entityType, entityId);
  });
  return { archived: archive };
});

export const crmResolveLeadIntake = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request, "leads:resolve");
  if (actor.role === "staff" && !actor.permissions.includes("customers:view")) {
    throw new HttpsError("permission-denied", "Viewing customers is also required to resolve registration matches.");
  }
  const { intakeId, customerId, confirmedPhone } = request.data || {};
  if (!validDocumentId(intakeId) || !validDocumentId(customerId)) {
    throw new HttpsError("invalid-argument", "Lead match is invalid.");
  }
  const intakeRef = db().collection("crmLeadIntakes").doc(intakeId);
  const customerRef = db().collection("crmCustomers").doc(customerId);
  const linkRef = db().collection("crmWebUserIndex").doc(intakeId);
  await db().runTransaction(async (transaction) => {
    const [intake, customer] = await Promise.all([
      transaction.get(intakeRef),
      transaction.get(customerRef)
    ]);
    if (!intake.exists || intake.data().status !== "needs_review") {
      throw new HttpsError("not-found", "Pending lead was not found.");
    }
    let normalizedPhone;
    try {
      normalizedPhone = normalizePhone(confirmedPhone || intake.data().phone);
    } catch {
      throw new HttpsError("failed-precondition", "This lead needs a valid phone number before it can be matched.");
    }
    if (!customer.exists || customer.data().deletedAt) throw new HttpsError("not-found", "Customer was not found.");
    const indexRef = db().collection("crmPhoneIndex").doc(phoneHash(normalizedPhone));
    const index = await transaction.get(indexRef);
    if (!index.exists || index.data().customerId !== customerId) {
      throw new HttpsError("failed-precondition", "The phone number no longer matches this customer.");
    }
    transaction.update(intakeRef, {
      status: "resolved",
      resolvedCustomerId: customerId,
      resolvedByUid: actor.uid,
      resolvedAt: FieldValue.serverTimestamp()
    });
    transaction.set(linkRef, { customerId, status: "linked", updatedAt: FieldValue.serverTimestamp() });
    transaction.update(customerRef, {
      linkedWebsiteUids: FieldValue.arrayUnion(intakeId),
      updatedAt: FieldValue.serverTimestamp()
    });
    addAudit(transaction, actor, "website_lead_linked", "customer", customerId, { intakeId });
  });
  return { linked: true };
});

export const crmCreateStaff = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request);
  requireOwner(actor);
  const email = text(request.data?.email, "Staff email", 254, true).toLowerCase();
  const displayName = text(request.data?.displayName, "Staff name", 100, true);
  if (!validEmail(email)) throw new HttpsError("invalid-argument", "Email address is invalid.");
  const permissions = normalizePermissions(request.data?.permissions, STAFF_DEFAULT_PERMISSIONS);
  const auth = getAuth();
  let user;
  let createdAuthUser = false;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await auth.createUser({ email, displayName, disabled: false });
    createdAuthUser = true;
  }
  const accessRef = db().collection("crmAccess").doc(user.uid);
  const existing = await accessRef.get();
  if (existing.exists && existing.data().role === "owner") {
    throw new HttpsError("already-exists", "An Owner account cannot be changed into Staff.");
  }
  if (!createdAuthUser && existing.exists && existing.data().role === "staff") {
    throw new HttpsError("already-exists", "This account already has CRM Staff access. Manage its permissions instead.");
  }
  if (!createdAuthUser) {
    throw new HttpsError("failed-precondition", "Existing Firebase accounts cannot be promoted. Use a dedicated new staff account.");
  }
  try {
    await accessRef.set({
      role: "staff",
      active: true,
      displayName,
      email,
      permissions,
      minimumAuthTime: Math.floor(Date.now() / 1000) + 1,
      assignedLeadCount: existing.data()?.assignedLeadCount || 0,
      createdAt: existing.data()?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.uid
    });
  } catch (error) {
    if (createdAuthUser) {
      try {
        await auth.deleteUser(user.uid);
      } catch (cleanupError) {
        console.error("Could not remove incomplete staff account", {
          code: cleanupError?.code || cleanupError?.name || "unknown"
        });
      }
    }
    throw error;
  }
  await db().collection("crmAuditEvents").add({
    actorUid: actor.uid,
    actorRole: actor.role,
    action: "staff_created_or_updated",
    entityType: "staff",
    entityId: user.uid,
    createdAt: FieldValue.serverTimestamp()
  });
  return { uid: user.uid, email, createdAuthUser };
});

export const crmUpdateStaff = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request);
  requireOwner(actor);
  const { uid, active, permissions, displayName } = request.data || {};
  if (!validDocumentId(uid) || uid === actor.uid ||
      (active !== undefined && typeof active !== "boolean")) {
    throw new HttpsError("invalid-argument", "Staff changes are invalid.");
  }
  const accessRef = db().collection("crmAccess").doc(uid);
  const snapshot = await accessRef.get();
  if (!snapshot.exists || snapshot.data().role !== "staff") {
    throw new HttpsError("not-found", "Staff member was not found.");
  }
  const updates = { updatedAt: FieldValue.serverTimestamp(), updatedByUid: actor.uid };
  if (active !== undefined) updates.active = active;
  if (active === true && snapshot.data().active !== true) {
    updates.minimumAuthTime = Math.floor(Date.now() / 1000) + 1;
  }
  if (permissions !== undefined) updates.permissions = normalizePermissions(permissions);
  if (displayName !== undefined) updates.displayName = text(displayName, "Staff name", 100, true);
  await accessRef.update(updates);
  if (active === false) await getAuth().revokeRefreshTokens(uid);
  await db().collection("crmAuditEvents").add({
    actorUid: actor.uid,
    actorRole: actor.role,
    action: "staff_access_updated",
    entityType: "staff",
    entityId: uid,
    details: {
      ...(updates.active === undefined ? {} : { active: updates.active }),
      ...(updates.permissions === undefined ? {} : { permissions: updates.permissions })
    },
    createdAt: FieldValue.serverTimestamp()
  });
  return { updated: true };
});

export const crmResetStaffAccess = onCall({ region: "us-central1" }, async (request) => {
  const actor = await requireCrmUser(request);
  requireOwner(actor);
  const uid = request.data?.uid;
  if (!validDocumentId(uid) || uid === actor.uid) {
    throw new HttpsError("invalid-argument", "Staff account is invalid.");
  }
  const access = await db().collection("crmAccess").doc(uid).get();
  if (!access.exists || access.data().role !== "staff") {
    throw new HttpsError("not-found", "Staff member was not found.");
  }
  await access.ref.update({
    active: false,
    minimumAuthTime: Math.floor(Date.now() / 1000) + 1,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actor.uid
  });
  await getAuth().revokeRefreshTokens(uid);
  const user = await getAuth().getUser(uid);
  await db().collection("crmAuditEvents").add({
    actorUid: actor.uid,
    actorRole: actor.role,
    action: "staff_access_reset",
    entityType: "staff",
    entityId: uid,
    createdAt: FieldValue.serverTimestamp()
  });
  return { email: user.email || access.data().email || "" };
});

export const crmGetBikeModels = onCall({ region: "us-central1" }, async (request) => {
  await requireCrmUser(request, "purchases:view");
  const snapshot = await db().collection("bikes").where("status", "==", "published").get();
  const models = new Set();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const name = typeof data.model === "string" && data.model.trim()
      ? data.model.trim()
      : typeof data.name === "string" ? data.name.trim() : "";
    if (name) models.add(name);
  });
  return { models: [...models].sort((a, b) => a.localeCompare(b)) };
});

export const crmOnWebsiteProfileCreated = onDocumentCreated("users/{uid}", async (event) => {
  const profile = event.data?.data();
  const uid = event.params.uid;
  if (!profile || profile.uid !== uid) return;
  try {
    const user = await getAuth().getUser(uid);
    if (user.disabled) return;
    const crmAccess = await db().collection("crmAccess").doc(uid).get();
    if (crmAccess.exists) return;
    const email = typeof user.email === "string" ? user.email : "";
    const safeProfile = {
      name: typeof profile.name === "string" ? profile.name : user.displayName || "",
      email,
      mobile: typeof profile.mobile === "string" ? profile.mobile : ""
    };
    if (safeProfile.email && typeof profile.email === "string" &&
        profile.email.toLowerCase() !== safeProfile.email.toLowerCase()) return;
    await writeWebsiteLead(uid, safeProfile);
  } catch (error) {
    console.error("Could not sync website registration to CRM", {
      code: error?.code || error?.name || "unknown"
    });
    throw error;
  }
});
