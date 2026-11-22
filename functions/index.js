import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
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
const firebaseWebApiKey = defineString("ADMIN_AUTH_WEB_API_KEY");
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
