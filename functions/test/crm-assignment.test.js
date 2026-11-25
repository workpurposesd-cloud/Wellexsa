import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || "demo-wellexsa-crm-scope";
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const functionsEmulatorHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";

if (!projectId.startsWith("demo-") ||
    !authEmulatorHost.startsWith("127.0.0.1:") ||
    !firestoreEmulatorHost.startsWith("127.0.0.1:") ||
    !functionsEmulatorHost.startsWith("127.0.0.1:")) {
  throw new Error("CRM assignment tests must use local Firebase emulators and a demo project.");
}

const app = initializeApp({ projectId }, `crm-assignment-${randomUUID()}`);
const db = getFirestore(app);
const assignment = randomUUID().replace(/-/g, "").slice(0, 20);
const customerId = `assigned-${assignment}`;
const otherCustomerId = `other-${assignment}`;
const enquiryId = `enquiry-${assignment}`;
const otherEnquiryId = `other-enquiry-${assignment}`;
const legacyEnquiryId = `legacy-enquiry-${assignment}`;
const purchaseId = `purchase-${assignment}`;
const otherPurchaseId = `other-purchase-${assignment}`;
const legacyPurchaseId = `legacy-purchase-${assignment}`;
const intakeId = `intake-${assignment}`;
let staff;
let owner;

async function createVerifiedUser(role) {
  const email = `crm-${role}-${randomUUID()}@example.test`;
  const signUpResponse = await fetch(
    `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "Test-password-123!", returnSecureToken: true })
    }
  );
  assert.equal(signUpResponse.status, 200, "Auth Emulator sign-up should succeed.");
  const account = await signUpResponse.json();
  const verifyResponse = await fetch(
    `http://${authEmulatorHost}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idToken: account.idToken,
        emailVerified: true,
        returnSecureToken: true
      })
    }
  );
  assert.equal(verifyResponse.status, 200, "Auth Emulator email verification should succeed.");
  const verified = await verifyResponse.json();
  return { uid: verified.localId, token: verified.idToken };
}

async function firestoreRequest(path, token, options = {}) {
  return fetch(
    `http://${firestoreEmulatorHost}/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers
      }
    }
  );
}

async function callable(name, token, data) {
  return fetch(`http://${functionsEmulatorHost}/${projectId}/us-central1/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      origin: "http://localhost:5500",
      "content-type": "application/json"
    },
    body: JSON.stringify({ data })
  });
}

test.before(async () => {
  [staff, owner] = await Promise.all([
    createVerifiedUser("staff"),
    createVerifiedUser("owner")
  ]);
  const permissions = [
    "customers:view",
    "customers:edit",
    "contacts:log",
    "leads:resolve",
    "purchases:view",
    "purchases:edit"
  ];
  await Promise.all([
    db.collection("crmAccess").doc(staff.uid).set({
      role: "staff",
      active: true,
      permissions,
      minimumAuthTime: 0
    }),
    db.collection("crmAccess").doc(owner.uid).set({
      role: "owner",
      active: true,
      minimumAuthTime: 0
    })
  ]);
  const timestamp = Timestamp.now();
  await Promise.all([
    db.collection("crmCustomers").doc(customerId).set({
      assignedStaffUid: staff.uid,
      updatedAt: timestamp,
      name: "Assigned customer"
    }),
    db.collection("crmCustomers").doc(otherCustomerId).set({
      assignedStaffUid: "another-staff",
      updatedAt: timestamp,
      name: "Other customer"
    }),
    db.collection("crmEnquiries").doc(enquiryId).set({
      customerId,
      assignedStaffUid: staff.uid,
      createdAt: timestamp
    }),
    db.collection("crmEnquiries").doc(otherEnquiryId).set({
      customerId: otherCustomerId,
      assignedStaffUid: "another-staff",
      createdAt: timestamp
    }),
    db.collection("crmEnquiries").doc(legacyEnquiryId).set({
      customerId,
      createdAt: timestamp
    }),
    db.collection("crmPurchases").doc(purchaseId).set({
      customerId,
      assignedStaffUid: staff.uid,
      purchaseDate: timestamp
    }),
    db.collection("crmPurchases").doc(otherPurchaseId).set({
      customerId: otherCustomerId,
      assignedStaffUid: "another-staff",
      purchaseDate: timestamp
    }),
    db.collection("crmPurchases").doc(legacyPurchaseId).set({
      customerId,
      purchaseDate: timestamp
    }),
    db.collection("crmCustomers").doc(customerId)
      .collection("contactHistory").doc("assigned-event").set({ createdAt: timestamp }),
    db.collection("crmCustomers").doc(otherCustomerId)
      .collection("contactHistory").doc("other-event").set({ createdAt: timestamp }),
    db.collection("crmLeadIntakes").doc(intakeId).set({ status: "needs_review" })
  ]);
});

test.after(async () => {
  await deleteApp(app);
});

test("staff Firestore reads require assignment across CRM collections", async () => {
  const assignedCustomer = await firestoreRequest(`crmCustomers/${customerId}`, staff.token);
  const otherCustomer = await firestoreRequest(`crmCustomers/${otherCustomerId}`, staff.token);
  const assignedEnquiry = await firestoreRequest(`crmEnquiries/${enquiryId}`, staff.token);
  const otherEnquiry = await firestoreRequest(`crmEnquiries/${otherEnquiryId}`, staff.token);
  const assignedPurchase = await firestoreRequest(`crmPurchases/${purchaseId}`, staff.token);
  const otherPurchase = await firestoreRequest(`crmPurchases/${otherPurchaseId}`, staff.token);
  const assignedHistory = await firestoreRequest(
    `crmCustomers/${customerId}/contactHistory/assigned-event`,
    staff.token
  );
  const otherHistory = await firestoreRequest(
    `crmCustomers/${otherCustomerId}/contactHistory/other-event`,
    staff.token
  );
  const restrictedIntake = await firestoreRequest(`crmLeadIntakes/${intakeId}`, staff.token);

  for (const response of [assignedCustomer, assignedEnquiry, assignedPurchase, assignedHistory]) {
    assert.equal(response.status, 200);
  }
  for (const response of [
    otherCustomer,
    otherEnquiry,
    otherPurchase,
    otherHistory,
    restrictedIntake
  ]) {
    assert.equal(response.status, 403);
  }
});

test("staff collection queries must constrain assignedStaffUid", async () => {
  const queryUrl = `http://${firestoreEmulatorHost}/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const assignedQuery = await fetch(queryUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${staff.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "crmCustomers" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "assignedStaffUid" },
            op: "EQUAL",
            value: { stringValue: staff.uid }
          }
        }
      }
    })
  });
  const broadQuery = await fetch(queryUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${staff.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "crmCustomers" }] } })
  });

  assert.equal(assignedQuery.status, 200);
  assert.equal(broadQuery.status, 403);
});

test("staff callable updates are limited to assigned customers", async () => {
  const assignedUpdate = await callable("crmUpdateCustomer", staff.token, {
    customerId,
    changes: { name: "Updated assigned customer" }
  });
  const otherUpdate = await callable("crmUpdateCustomer", staff.token, {
    customerId: otherCustomerId,
    changes: { name: "Unauthorized update" }
  });

  assert.equal(assignedUpdate.status, 200);
  assert.equal(otherUpdate.status, 403);
  assert.match((await otherUpdate.text()).toLowerCase(), /permission/);
});

test("staff can update only assigned enquiry statuses", async () => {
  const assignedUpdate = await callable("crmUpdateEnquiry", staff.token, {
    enquiryId,
    status: "contacted"
  });
  const otherUpdate = await callable("crmUpdateEnquiry", staff.token, {
    enquiryId: otherEnquiryId,
    status: "closed"
  });

  assert.equal(assignedUpdate.status, 200);
  assert.equal(otherUpdate.status, 403);
});

test("Owner can read assigned and unassigned CRM records", async () => {
  const assignedCustomer = await firestoreRequest(`crmCustomers/${customerId}`, owner.token);
  const otherCustomer = await firestoreRequest(`crmCustomers/${otherCustomerId}`, owner.token);
  const pendingIntake = await firestoreRequest(`crmLeadIntakes/${intakeId}`, owner.token);

  assert.equal(assignedCustomer.status, 200);
  assert.equal(otherCustomer.status, 200);
  assert.equal(pendingIntake.status, 200);
});

test("Owner assignment saves propagate scope to existing linked records", async () => {
  const response = await callable("crmUpdateCustomer", owner.token, {
    customerId,
    changes: { assignedStaffUid: staff.uid }
  });
  const enquiry = await db.collection("crmEnquiries").doc(legacyEnquiryId).get();
  const purchase = await db.collection("crmPurchases").doc(legacyPurchaseId).get();

  assert.equal(response.status, 200);
  assert.equal(enquiry.data().assignedStaffUid, staff.uid);
  assert.equal(purchase.data().assignedStaffUid, staff.uid);
});
