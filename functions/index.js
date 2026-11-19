import { createHmac, timingSafeEqual } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import Razorpay from "razorpay";
export {
  crmArchiveRecord,
  crmCreateCustomer,
  crmCreateStaff,
  crmGetBikeModels,
  crmGetSession,
  crmLogContact,
  crmListStaff,
  crmMarkPurchased,
  crmOnWebsiteProfileCreated,
  crmResolveLeadIntake,
  crmResetStaffAccess,
  crmSubmitBikeEnquiry,
  crmUpdateCustomer,
  crmUpdatePurchase,
  crmUpdateStaff
} from "./crm.js";

initializeApp();
const db = getFirestore();
const keyIdParam = defineString("RAZORPAY_KEY_ID", { default: "" });
const modeParam = defineString("RAZORPAY_MODE", { default: "test" });
const firebaseWebApiKey = defineString("FIREBASE_WEB_API_KEY");
const keySecret = defineSecret("RAZORPAY_KEY_SECRET");
const webhookSecret = defineSecret("RAZORPAY_WEBHOOK_SECRET");
const fulfillmentStatuses = new Set(["pending", "processing", "ready_for_delivery", "delivered", "cancelled", "refunded"]);
const adminLoginFailureMessage = "Administrator username or password is incorrect.";
const adminFeaturesEnabled = false;

function hasAdminAccess(request) {
  const claims = request.auth?.token;
  return adminFeaturesEnabled && claims?.admin === true && claims.mustChangePassword !== true;
}

export const adminSignInWithUsername = onCall(
  { region: "us-central1", maxInstances: 10 },
  async (request) => {
    if (!adminFeaturesEnabled) {
      throw new HttpsError("unavailable", "Administrator access is temporarily unavailable.");
    }
    const username = request.data?.username;
    const password = request.data?.password;
    if (typeof username !== "string" || typeof password !== "string" ||
        !/^[a-zA-Z0-9._-]{3,32}$/.test(username) || password.length < 1 || password.length > 128) {
      throw new HttpsError("unauthenticated", adminLoginFailureMessage);
    }

    try {
      const normalizedUsername = username.normalize("NFKC").trim().toLowerCase();
      const mapping = await db.collection("adminUsernames").doc(normalizedUsername).get();
      if (!mapping.exists || typeof mapping.data().uid !== "string") {
        throw new HttpsError("unauthenticated", adminLoginFailureMessage);
      }

      const user = await getAuth().getUser(mapping.data().uid);
      if (user.disabled || user.customClaims?.admin !== true || !user.email) {
        throw new HttpsError("unauthenticated", adminLoginFailureMessage);
      }

      const apiKey = firebaseWebApiKey.value();
      if (!apiKey) {
        throw new HttpsError("failed-precondition", "Administrator sign-in is not configured.");
      }
      const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: user.email, password, returnSecureToken: true }),
          signal: AbortSignal.timeout(10000)
        }
      );
      if (!response.ok) {
        let identityErrorCode = "unknown";
        let identityErrorMessage = "No Firebase error message provided";
        try {
          const errorResponse = await response.json();
          identityErrorCode = errorResponse.error?.message || identityErrorCode;
          identityErrorMessage = errorResponse.error?.message || identityErrorMessage;
        } catch {
          // Keep the callable response generic if Firebase returned a non-JSON error.
        }
        console.error("Admin Identity Toolkit sign-in failed", {
          status: response.status,
          code: identityErrorCode,
          message: identityErrorMessage
        });
        if (["INVALID_PASSWORD", "EMAIL_NOT_FOUND", "INVALID_LOGIN_CREDENTIALS", "USER_DISABLED"].includes(identityErrorCode)) {
          throw new HttpsError("unauthenticated", adminLoginFailureMessage);
        }
        if (["API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "PROJECT_NOT_FOUND", "CONFIGURATION_NOT_FOUND", "OPERATION_NOT_ALLOWED"].includes(identityErrorCode)) {
          throw new HttpsError("failed-precondition", "Administrator sign-in is not configured.");
        }
        if (identityErrorCode === "TOO_MANY_ATTEMPTS_TRY_LATER") {
          throw new HttpsError("resource-exhausted", "Too many sign-in attempts. Try again later.");
        }
        throw new HttpsError("unavailable", "Administrator sign-in could not reach Firebase Authentication.");
      }
      const identity = await response.json();
      if (identity.localId !== user.uid) {
        throw new HttpsError("unauthenticated", adminLoginFailureMessage);
      }

      const claims = { ...user.customClaims, admin: true };
      const customToken = await getAuth().createCustomToken(user.uid, claims);
      return { token: customToken };
    } catch (error) {
      const errorMessage = typeof error?.message === "string" ? error.message : "No error message provided";
      console.error("Admin username sign-in failed", {
        code: error?.code || error?.name || "unknown",
        message: errorMessage
          .split(password).join("[redacted]")
          .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Administrator sign-in could not be completed.");
    }
  }
);

export const completeAdminPasswordChange = onCall({ region: "us-central1" }, async (request) => {
  if (!adminFeaturesEnabled || !request.auth || request.auth.token.admin !== true ||
      request.auth.token.mustChangePassword !== true) {
    throw new HttpsError("permission-denied", "A required administrator password change is not pending.");
  }
  const newPassword = request.data?.newPassword;
  if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128) {
    throw new HttpsError("invalid-argument", "Choose a new password with at least 12 characters.");
  }
  const user = await getAuth().getUser(request.auth.uid);
  if (user.customClaims?.admin !== true || user.customClaims?.mustChangePassword !== true) {
    throw new HttpsError("permission-denied", "Administrator password change could not be verified.");
  }
  await getAuth().updateUser(user.uid, { password: newPassword });
  await getAuth().setCustomUserClaims(user.uid, {
    ...user.customClaims,
    admin: true,
    mustChangePassword: false
  });
  return { changed: true };
});

function validCustomerDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

let adminCustomerDirectoryCache = null;
let adminCustomerDirectoryCacheExpiresAt = 0;

async function loadAdminCustomerDirectory(forceRefresh) {
  if (!forceRefresh && adminCustomerDirectoryCache &&
      Date.now() < adminCustomerDirectoryCacheExpiresAt) {
    return adminCustomerDirectoryCache;
  }

  const auth = getAuth();
  const authUsers = [];
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    authUsers.push(...result.users.filter((user) => user.customClaims?.admin !== true));
    pageToken = result.pageToken;
  } while (pageToken);

  const profileByUid = new Map();
  for (let start = 0; start < authUsers.length; start += 100) {
    const batch = authUsers.slice(start, start + 100);
    const profiles = await db.getAll(...batch.map((user) => db.collection("users").doc(user.uid)));
    profiles.forEach((profile, index) => {
      profileByUid.set(batch[index].uid, profile.exists ? profile.data() : {});
    });
  }

  adminCustomerDirectoryCache = authUsers.map((user) => {
    const profile = profileByUid.get(user.uid) || {};
    return {
      uid: user.uid,
      name: typeof profile.name === "string" && profile.name.trim()
        ? profile.name.trim()
        : typeof user.displayName === "string" ? user.displayName.trim() : "",
      email: user.email || (typeof profile.email === "string" ? profile.email.trim() : ""),
      mobile: typeof profile.mobile === "string" && profile.mobile.trim()
        ? profile.mobile.trim()
        : user.phoneNumber || "",
      registeredAt: user.metadata.creationTime || "",
      lastLoginAt: user.metadata.lastSignInTime || "",
      status: user.disabled ? "disabled" : "active"
    };
  });
  adminCustomerDirectoryCache.sort((first, second) =>
    (Date.parse(second.registeredAt) || 0) - (Date.parse(first.registeredAt) || 0)
  );
  adminCustomerDirectoryCacheExpiresAt = Date.now() + 30 * 1000;
  return adminCustomerDirectoryCache;
}

export const listAdminCustomers = onCall(
  { region: "us-central1", maxInstances: 5 },
  async (request) => {
    if (!hasAdminAccess(request)) {
      throw new HttpsError("permission-denied", "Administrator access is required.");
    }

    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new HttpsError("invalid-argument", "Customer filters or pagination are invalid.");
    }
    const page = data.page === undefined ? 1 : data.page;
    const pageSize = data.pageSize === undefined ? 25 : data.pageSize;
    const search = data.search === undefined ? "" : data.search;
    const dateFrom = data.dateFrom === undefined ? "" : data.dateFrom;
    const dateTo = data.dateTo === undefined ? "" : data.dateTo;
    const status = data.status === undefined ? "" : data.status;
    const refresh = data.refresh === undefined ? false : data.refresh;
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
        ![10, 25, 50, 100].includes(pageSize) ||
        typeof search !== "string" || search.length > 200 ||
        typeof dateFrom !== "string" || (dateFrom !== "" && !validCustomerDate(dateFrom)) ||
        typeof dateTo !== "string" || (dateTo !== "" && !validCustomerDate(dateTo)) ||
        (dateFrom && dateTo && dateFrom > dateTo) ||
        !["", "active", "disabled"].includes(status) ||
        typeof refresh !== "boolean") {
      throw new HttpsError("invalid-argument", "Customer filters or pagination are invalid.");
    }

    try {
      const customers = await loadAdminCustomerDirectory(refresh);
      const now = Date.now();
      const newRegistrations = customers.filter((customer) => {
        const registeredAt = Date.parse(customer.registeredAt);
        return Number.isFinite(registeredAt) && registeredAt >= now - 30 * 24 * 60 * 60 * 1000;
      }).length;
      const recentLogins = customers
        .filter((customer) => customer.lastLoginAt)
        .sort((first, second) => Date.parse(second.lastLoginAt) - Date.parse(first.lastLoginAt))
        .slice(0, 5);
      const term = search.trim().toLowerCase();
      const filtered = customers.filter((customer) => {
        const registeredAt = Date.parse(customer.registeredAt);
        const matchesSearch = !term ||
          [customer.name, customer.email, customer.mobile].some((value) => value.toLowerCase().includes(term));
        const matchesStart = !dateFrom || registeredAt >= Date.parse(`${dateFrom}T00:00:00.000Z`);
        const matchesEnd = !dateTo || registeredAt <= Date.parse(`${dateTo}T23:59:59.999Z`);
        return matchesSearch && matchesStart && matchesEnd && (!status || customer.status === status);
      });

      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      const currentPage = Math.min(page, totalPages);
      const start = (currentPage - 1) * pageSize;
      return {
        customers: filtered.slice(start, start + pageSize),
        totalCustomers: customers.length,
        newRegistrations,
        recentLogins,
        filteredCount: filtered.length,
        page: currentPage,
        pageSize,
        totalPages
      };
    } catch (error) {
      console.error("Could not retrieve admin customer records", {
        code: error?.code || error?.name || "unknown",
        message: typeof error?.message === "string" ? error.message : "No error message provided"
      });
      throw new HttpsError("internal", "Customer records could not be loaded.");
    }
  }
);

function razorpay() {
  const keyId = keyIdParam.value();
  const secret = keySecret.value();
  const mode = modeParam.value();
  if (!keyId || !secret || !["test", "live"].includes(mode)) {
    throw new HttpsError("failed-precondition", "Razorpay credentials and payment mode are not configured.");
  }
  if ((mode === "test" && !keyId.startsWith("rzp_test_")) ||
      (mode === "live" && !keyId.startsWith("rzp_live_"))) {
    throw new HttpsError("failed-precondition", "Razorpay key does not match the configured payment mode.");
  }
  return new Razorpay({ key_id: keyId, key_secret: secret });
}

function validateShipping(shipping) {
  const required = ["name", "phone", "address", "city", "state", "postalCode"];
  if (!shipping || required.some((key) => typeof shipping[key] !== "string" || !shipping[key].trim())) {
    throw new HttpsError("invalid-argument", "Complete all delivery details before payment.");
  }
  const phoneDigits = shipping.phone.replace(/\D/g, "");
  if (shipping.name.length > 100 || shipping.phone.length > 30 ||
      shipping.address.length > 240 || shipping.city.length > 100 ||
      shipping.state.length > 100 || !/^\+?[0-9 ()-]{10,18}$/.test(shipping.phone) ||
      phoneDigits.length < 10 || phoneDigits.length > 15 || !/^\d{6}$/.test(shipping.postalCode)) {
    throw new HttpsError("invalid-argument", "Some delivery details are invalid.");
  }
}

function getBatteryRangeOptions(bike) {
  const specifications = bike.specifications;
  if (!specifications || typeof specifications !== "object" || Array.isArray(specifications)) return [];

  return [
    ["Lithium Battery", "Lithium Battery Warranty", "Lithium Battery Range Options"],
    ["GEL Battery", "GEL Battery Warranty", "GEL Battery Range"]
  ].flatMap(([batteryType, warrantyKey, rangesKey]) => {
    const warranty = specifications[warrantyKey];
    const ranges = specifications[rangesKey];
    if (typeof warranty !== "string" || typeof ranges !== "string") return [];
    return ranges.split(",").map((range) => range.trim()).filter(Boolean).map((range) => ({
      batteryType,
      range,
      warranty
    }));
  });
}

async function getPricedItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 8) {
    throw new HttpsError("invalid-argument", "Choose between 1 and 8 cart items.");
  }
  const seen = new Set();
  const snapshots = new Map();
  const quantitiesByBike = new Map();
  const result = [];
  for (const item of items) {
    const hasBatteryOption = item?.batteryOption !== undefined && item.batteryOption !== null;
    if (!item || typeof item.bikeId !== "string" || !Number.isInteger(item.quantity) ||
        item.quantity < 1 || item.quantity > 100000 ||
        (hasBatteryOption && (typeof item.batteryOption !== "object" || Array.isArray(item.batteryOption) ||
          typeof item.batteryOption.batteryType !== "string" || typeof item.batteryOption.range !== "string"))) {
      throw new HttpsError("invalid-argument", "Cart contents are invalid.");
    }
    const batteryOptionKey = hasBatteryOption
      ? `${item.batteryOption.batteryType}\u0000${item.batteryOption.range}`
      : "";
    const lineKey = `${item.bikeId}\u0000${batteryOptionKey}`;
    if (seen.has(lineKey)) throw new HttpsError("invalid-argument", "Cart contents are invalid.");
    seen.add(lineKey);

    let snapshot = snapshots.get(item.bikeId);
    if (!snapshot) {
      snapshot = await db.collection("bikes").doc(item.bikeId).get();
      snapshots.set(item.bikeId, snapshot);
    }
    if (!snapshot.exists) throw new HttpsError("failed-precondition", "A scooter in your cart is no longer available.");
    const bike = snapshot.data();
    if (bike.status !== "published" || !Number.isInteger(bike.stockQuantity) || bike.stockQuantity < 0) {
      throw new HttpsError("failed-precondition", `${bike.name} does not have enough available stock.`);
    }
    if (!Number.isInteger(bike.price) || bike.price <= 0) {
      throw new HttpsError("failed-precondition", "A scooter price is not configured correctly.");
    }
    const availableOptions = getBatteryRangeOptions(bike);
    const selectedOption = hasBatteryOption
      ? availableOptions.find((option) =>
        option.batteryType === item.batteryOption.batteryType && option.range === item.batteryOption.range
      )
      : null;
    if ((availableOptions.length > 0 && !selectedOption) || (availableOptions.length === 0 && hasBatteryOption)) {
      throw new HttpsError("invalid-argument", `Choose an available battery and range for ${bike.name}.`);
    }
    quantitiesByBike.set(item.bikeId, (quantitiesByBike.get(item.bikeId) || 0) + item.quantity);
    const lineTotal = bike.price * item.quantity;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new HttpsError("invalid-argument", "Order total is outside the supported payment range.");
    }
    result.push({
      bikeId: snapshot.id,
      name: bike.name,
      brand: bike.brand || "",
      model: bike.model || "",
      imageUrl: bike.imageUrls?.[0] || "",
      quantity: item.quantity,
      unitPrice: bike.price,
      lineTotal,
      ...(selectedOption ? {
        batteryOption: {
          batteryType: selectedOption.batteryType,
          range: selectedOption.range,
          warranty: selectedOption.warranty
        }
      } : {})
    });
  }
  for (const [bikeId, quantity] of quantitiesByBike) {
    const bike = snapshots.get(bikeId).data();
    if (bike.stockQuantity < quantity) {
      throw new HttpsError("failed-precondition", `${bike.name} does not have enough available stock.`);
    }
  }
  const totalAmount = result.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0 || totalAmount > 10000000) {
    throw new HttpsError("invalid-argument", "Order total is outside the supported payment range.");
  }
  return { items: result, totalAmount };
}

export const createPaymentOrder = onCall({ secrets: [keySecret] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in before checkout.");
  const { requestId, shipping } = request.data || {};
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) {
    throw new HttpsError("invalid-argument", "Checkout request identifier is invalid.");
  }
  validateShipping(shipping);
  const priced = await getPricedItems(request.data.items);
  const userRecord = await getAuth().getUser(request.auth.uid);
  const requestRef = db.collection("checkoutRequests").doc(`${request.auth.uid}_${requestId}`);
  const newOrderRef = db.collection("orders").doc();
  const chosenOrderId = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(requestRef);
    if (existing.exists) return existing.data().orderId;
    transaction.create(newOrderRef, {
      userId: request.auth.uid,
      customer: {
        name: shipping.name.trim(),
        email: userRecord.email || "",
        phone: shipping.phone.trim()
      },
      shipping: {
        name: shipping.name.trim(),
        phone: shipping.phone.trim(),
        address: shipping.address.trim(),
        city: shipping.city.trim(),
        state: shipping.state.trim(),
        postalCode: shipping.postalCode.trim()
      },
      items: priced.items,
      totalAmount: priced.totalAmount,
      currency: "INR",
      paymentStatus: "pending",
      orderStatus: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      gatewayOrderCreating: false
    });
    transaction.create(requestRef, {
      orderId: newOrderRef.id,
      createdAt: FieldValue.serverTimestamp()
    });
    return newOrderRef.id;
  });
  const orderRef = db.collection("orders").doc(chosenOrderId);
  const currentOrder = await orderRef.get();
  if (!currentOrder.exists) throw new HttpsError("internal", "Checkout order could not be loaded.");
  const startGatewayOrder = await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(orderRef);
    if (!latest.exists) throw new HttpsError("not-found", "Checkout order could not be loaded.");
    if (latest.data().razorpayOrderId) return latest.data().razorpayOrderId;
      const lockIsFresh = latest.data().gatewayOrderCreating === true &&
        Number(latest.data().gatewayOrderCreatingAt) > Date.now() - 60000;
    if (lockIsFresh) {
      throw new HttpsError("already-exists", "This checkout request is already being prepared.");
    }
    transaction.update(orderRef, {
      gatewayOrderCreating: true,
      gatewayOrderCreatingAt: Date.now(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return "";
  });
  if (startGatewayOrder) {
    return {
      orderId: chosenOrderId,
      gatewayOrderId: startGatewayOrder,
      amount: currentOrder.data().totalAmount * 100,
      keyId: keyIdParam.value()
    };
  }
  try {
    const gateway = razorpay();
    const gatewayOrder = await gateway.orders.create({
      amount: currentOrder.data().totalAmount * 100,
      currency: "INR",
      receipt: chosenOrderId.slice(0, 40),
      notes: { wellexsaOrderId: chosenOrderId, customerUid: request.auth.uid }
    });
    await orderRef.update({
      razorpayOrderId: gatewayOrder.id,
      gatewayOrderCreating: false,
      updatedAt: FieldValue.serverTimestamp()
    });
    return {
      orderId: chosenOrderId,
      gatewayOrderId: gatewayOrder.id,
      amount: gatewayOrder.amount,
      keyId: keyIdParam.value()
    };
  } catch (error) {
    await orderRef.update({
      gatewayOrderCreating: false,
      updatedAt: FieldValue.serverTimestamp()
    }).catch((updateError) => console.error("Could not release Razorpay order creation lock", updateError.message));
    console.error("Razorpay order creation failed", { orderId: chosenOrderId, message: error.message });
    throw new HttpsError("unavailable", "Secure payment could not be started. Please try again.");
  }
});

async function findOrderByGatewayId(gatewayOrderId) {
  const result = await db.collection("orders").where("razorpayOrderId", "==", gatewayOrderId).limit(1).get();
  return result.empty ? null : result.docs[0];
}

async function commitCapturedPayment(orderSnapshot, payment) {
  const orderRef = orderSnapshot.ref;
  const result = await db.runTransaction(async (transaction) => {
    const orderDocument = await transaction.get(orderRef);
    if (!orderDocument.exists) throw new Error("Order no longer exists.");
    const order = orderDocument.data();
    if (order.paymentStatus === "captured") return { paymentStatus: "captured", alreadyProcessed: true };
    if (order.paymentStatus === "stock_conflict" || order.refundRequested === true || order.refundId) {
      const refundLockExpired = Number(order.refundRequestedAt) < Date.now() - 60000;
      if (order.paymentStatus === "stock_conflict" && !order.refundId &&
          (order.refundRequested !== true || refundLockExpired)) {
        transaction.update(orderRef, {
          refundRequested: true,
          refundRequestedAt: Date.now(),
          refundStatus: "pending",
          updatedAt: FieldValue.serverTimestamp()
        });
        return { paymentStatus: "stock_conflict", alreadyProcessed: true, shouldRefund: true };
      }
      return { paymentStatus: order.paymentStatus, alreadyProcessed: true };
    }
    if (order.razorpayOrderId !== payment.order_id ||
        order.totalAmount * 100 !== payment.amount ||
        payment.status !== "captured") {
      throw new Error("Captured payment does not match the order.");
    }

    const quantitiesByBike = new Map();
    for (const item of order.items) {
      quantitiesByBike.set(item.bikeId, (quantitiesByBike.get(item.bikeId) || 0) + item.quantity);
    }
    const bikeSnapshots = [];
    for (const [bikeId, quantity] of quantitiesByBike) {
      const bikeRef = db.collection("bikes").doc(bikeId);
      bikeSnapshots.push({ quantity, ref: bikeRef, snapshot: await transaction.get(bikeRef) });
    }
    const unavailable = bikeSnapshots.some(({ quantity, snapshot }) =>
      !snapshot.exists ||
      snapshot.data().status !== "published" ||
      !Number.isInteger(snapshot.data().stockQuantity) ||
      snapshot.data().stockQuantity < quantity
    );
    if (unavailable) {
      transaction.update(orderRef, {
        paymentStatus: "stock_conflict",
        razorpayPaymentId: payment.id,
        refundRequested: true,
        refundRequestedAt: Date.now(),
        refundStatus: "pending",
        paymentCapturedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });
      return { paymentStatus: "stock_conflict", alreadyProcessed: false, shouldRefund: true };
    }
    for (const { quantity, ref, snapshot } of bikeSnapshots) {
      transaction.update(ref, {
        stockQuantity: snapshot.data().stockQuantity - quantity,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
    transaction.update(orderRef, {
      paymentStatus: "captured",
      orderStatus: "processing",
      razorpayPaymentId: payment.id,
      paymentCapturedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return { paymentStatus: "captured", alreadyProcessed: false };
  });
  if (result.shouldRefund) {
    try {
      const refund = await razorpay().payments.refund(payment.id);
      await orderRef.update({
        refundId: refund.id,
        refundStatus: refund.status || "pending",
        updatedAt: FieldValue.serverTimestamp()
      });
    } catch (error) {
      await orderRef.update({
        refundRequested: false,
        refundStatus: "failed",
        updatedAt: FieldValue.serverTimestamp()
      });
      console.error("Automatic refund for stock conflict failed", {
        orderId: orderSnapshot.id,
        paymentId: payment.id,
        message: error.message
      });
    }
  }
  return result;
}

export const verifyRazorpayPayment = onCall({ secrets: [keySecret] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to verify your payment.");
  const { orderId, razorpay_order_id: gatewayOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = request.data || {};
  if (typeof orderId !== "string" || typeof gatewayOrderId !== "string" ||
      typeof paymentId !== "string" || typeof signature !== "string") {
    throw new HttpsError("invalid-argument", "Payment verification data is incomplete.");
  }
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnapshot = await orderRef.get();
  if (!orderSnapshot.exists || orderSnapshot.data().userId !== request.auth.uid) {
    throw new HttpsError("not-found", "Order was not found.");
  }
  if (orderSnapshot.data().razorpayOrderId !== gatewayOrderId) {
    throw new HttpsError("permission-denied", "Payment order does not match.");
  }
  const expected = createHmac("sha256", keySecret.value()).update(`${gatewayOrderId}|${paymentId}`).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "hex");
  } catch {
    throw new HttpsError("invalid-argument", "Payment signature is invalid.");
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpsError("permission-denied", "Payment signature could not be verified.");
  }
  let payment;
  try {
    payment = await razorpay().payments.fetch(paymentId);
  } catch (error) {
    console.error("Could not fetch Razorpay payment", { orderId, message: error.message });
    throw new HttpsError("unavailable", "Payment status could not be confirmed with Razorpay.");
  }
  if (payment.order_id !== gatewayOrderId || payment.status !== "captured") {
    throw new HttpsError("failed-precondition", "Razorpay has not confirmed a captured payment.");
  }
  try {
    const result = await commitCapturedPayment(orderSnapshot, payment);
    return result;
  } catch (error) {
    console.error("Could not finalize captured payment", { orderId, message: error.message });
    throw new HttpsError("aborted", "Payment is received but order finalization needs support review. Do not retry payment.");
  }
});

export const recordPaymentFailure = onCall({ secrets: [keySecret] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to update this payment.");
  const { orderId, paymentId } = request.data || {};
  if (typeof orderId !== "string" || typeof paymentId !== "string") {
    throw new HttpsError("invalid-argument", "Payment attempt data is incomplete.");
  }
  const orderRef = db.collection("orders").doc(orderId);
  const order = await orderRef.get();
  if (!order.exists || order.data().userId !== request.auth.uid) throw new HttpsError("not-found", "Order was not found.");
  let payment;
  try {
    payment = await razorpay().payments.fetch(paymentId);
  } catch (error) {
    console.error("Could not verify failed payment attempt", { orderId, message: error.message });
    throw new HttpsError("unavailable", "Payment attempt could not be verified.");
  }
  if (payment.order_id !== order.data().razorpayOrderId || payment.status !== "failed") {
    throw new HttpsError("failed-precondition", "Razorpay has not confirmed this payment as failed.");
  }
  await db.runTransaction(async (transaction) => {
    const latest = await transaction.get(orderRef);
    if (latest.exists && latest.data().paymentStatus === "pending") {
      transaction.update(orderRef, {
        paymentStatus: "failed",
        razorpayPaymentId: payment.id,
        updatedAt: FieldValue.serverTimestamp()
      });
    }
  });
  return { paymentStatus: "failed" };
});

export const cancelPendingPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to cancel this checkout.");
  const { orderId } = request.data || {};
  if (typeof orderId !== "string") throw new HttpsError("invalid-argument", "Order ID is invalid.");
  const orderRef = db.collection("orders").doc(orderId);
  const order = await orderRef.get();
  if (!order.exists || order.data().userId !== request.auth.uid) {
    throw new HttpsError("not-found", "Order was not found.");
  }
  return { paymentStatus: order.data().paymentStatus };
});

export const updateOrderStatus = onCall(async (request) => {
  if (!hasAdminAccess(request)) throw new HttpsError("permission-denied", "Administrator access is required.");
  const { orderId, orderStatus } = request.data || {};
  if (typeof orderId !== "string" || !fulfillmentStatuses.has(orderStatus)) {
    throw new HttpsError("invalid-argument", "Order status is invalid.");
  }
  const orderRef = db.collection("orders").doc(orderId);
  await db.runTransaction(async (transaction) => {
    const order = await transaction.get(orderRef);
    if (!order.exists) throw new HttpsError("not-found", "Order was not found.");
    if (order.data().paymentStatus !== "captured" && ["processing", "ready_for_delivery", "delivered"].includes(orderStatus)) {
      throw new HttpsError("failed-precondition", "Only a verified paid order can be processed or delivered.");
    }
    if (orderStatus === "refunded" && order.data().paymentStatus !== "refunded") {
      throw new HttpsError("failed-precondition", "Only a Razorpay-confirmed refund can be marked refunded.");
    }
    transaction.update(orderRef, {
      orderStatus,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { orderStatus };
});

export const requestOrderRefund = onCall({ secrets: [keySecret] }, async (request) => {
  if (!hasAdminAccess(request)) throw new HttpsError("permission-denied", "Administrator access is required.");
  const { orderId } = request.data || {};
  if (typeof orderId !== "string") throw new HttpsError("invalid-argument", "Order ID is invalid.");
  const orderRef = db.collection("orders").doc(orderId);
  const claimed = await db.runTransaction(async (transaction) => {
    const order = await transaction.get(orderRef);
    if (!order.exists) throw new HttpsError("not-found", "Order was not found.");
    if (!["captured", "stock_conflict"].includes(order.data().paymentStatus) || !order.data().razorpayPaymentId) {
      throw new HttpsError("failed-precondition", "Only a verified payment can be refunded.");
    }
    if (order.data().refundId) return false;
    if (order.data().refundRequested === true && Number(order.data().refundRequestedAt) > Date.now() - 60000) {
      throw new HttpsError("already-exists", "A refund request is already in progress.");
    }
    transaction.update(orderRef, {
      refundRequested: true,
      refundRequestedAt: Date.now(),
      refundStatus: "pending",
      updatedAt: FieldValue.serverTimestamp()
    });
    return true;
  });
  if (!claimed) return { refundStatus: "already_requested" };
  try {
    const refund = await razorpay().payments.refund((await orderRef.get()).data().razorpayPaymentId);
    await orderRef.update({
      refundId: refund.id,
      refundStatus: refund.status || "pending",
      orderStatus: "cancelled",
      updatedAt: FieldValue.serverTimestamp()
    });
    return { refundStatus: refund.status || "pending" };
  } catch (error) {
    await orderRef.update({ refundRequested: false, updatedAt: FieldValue.serverTimestamp() });
    console.error("Razorpay refund request failed", { orderId, message: error.message });
    throw new HttpsError("unavailable", "Razorpay refund could not be started.");
  }
});

function normalizeRawBody(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (rawBody instanceof Uint8Array) return Buffer.from(rawBody);
  if (ArrayBuffer.isView(rawBody)) return Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  if (typeof rawBody === "string") return Buffer.from(rawBody);
  return null;
}

function validWebhookSignature(rawBody, signature, secret) {
  const normalizedBody = normalizeRawBody(rawBody);
  if (!normalizedBody || typeof signature !== "string" || !secret) return false;
  const expected = createHmac("sha256", secret).update(normalizedBody).digest();
  const supplied = Buffer.from(signature, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export const razorpayWebhook = onRequest({ secrets: [keySecret, webhookSecret], rawBody: true }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).send("Method not allowed");
    return;
  }
  if (!validWebhookSignature(request.rawBody, request.get("x-razorpay-signature"), webhookSecret.value())) {
    response.status(400).send("Invalid webhook signature");
    return;
  }
  const event = request.body?.event;
  try {
    if (event === "payment.captured") {
      const payment = request.body.payload?.payment?.entity;
      if (!payment?.id || !payment.order_id) {
        response.status(400).send("Missing captured payment data");
        return;
      }
      const order = await findOrderByGatewayId(payment.order_id);
      if (!order) {
        response.status(404).send("Order not found");
        return;
      }
      const result = await commitCapturedPayment(order, payment);
      if (result.paymentStatus === "stock_conflict") {
        console.error("Captured payment requires stock-conflict support review", { orderId: order.id, paymentId: payment.id });
      }
    } else if (event === "payment.failed") {
      const payment = request.body.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        const order = await findOrderByGatewayId(payment.order_id);
        if (order) {
          await db.runTransaction(async (transaction) => {
            const latest = await transaction.get(order.ref);
            if (latest.exists && latest.data().paymentStatus === "pending") {
              transaction.update(order.ref, {
                paymentStatus: "failed",
                razorpayPaymentId: payment.id,
                updatedAt: FieldValue.serverTimestamp()
              });
            }
          });
        }
      }
    } else if (event === "refund.processed") {
      const refund = request.body.payload?.refund?.entity;
      const paymentId = refund?.payment_id;
      if (paymentId) {
        const matches = await db.collection("orders").where("razorpayPaymentId", "==", paymentId).limit(1).get();
        if (!matches.empty) {
          await matches.docs[0].ref.update({
            paymentStatus: "refunded",
            refundId: refund.id,
            refundStatus: "processed",
            orderStatus: "refunded",
            refundedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
          });
        }
      }
    }
    response.status(200).send("ok");
  } catch (error) {
    console.error("Razorpay webhook processing failed", { event, message: error.message });
    response.status(500).send("Webhook processing failed");
  }
});
