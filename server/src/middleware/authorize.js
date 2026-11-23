import { getDatabasePool } from "../database/pool.js";

const STAFF_PERMISSION_ALLOWLIST = new Set([
  "crm.customers.read.assigned",
  "crm.customers.create",
  "crm.customers.update.assigned",
  "crm.enquiries.read.assigned",
  "crm.enquiries.update.assigned",
  "crm.contacts.log.assigned",
  "crm.followups.read.assigned",
  "crm.followups.create.assigned",
  "crm.followups.update.assigned",
  "crm.followups.cancel",
  "crm.sales.read.assigned",
  "crm.sales.create",
  "catalog.read"
]);

const CUSTOMER_PERMISSION_ALLOWLIST = new Set([
  "customer.profile.read.self",
  "customer.profile.update.self",
  "customer.history.read.self"
]);

export async function resolvePrincipal(pool, auth) {
  if (!auth || typeof auth.uid !== "string" || !auth.uid) return null;

  const [userRows] = await pool.execute(
    `SELECT u.id, u.firebase_uid, u.email, u.display_name, u.email_verified_at,
            u.account_status, r.code AS role_code
     FROM users AS u
     JOIN roles AS r ON r.id = u.primary_role_id
     WHERE u.firebase_uid = ?
     LIMIT 1`,
    [auth.uid]
  );
  const user = userRows[0];
  if (!user) return null;
  if (user.account_status !== "active") {
    const error = new Error("Account is not active.");
    error.statusCode = 403;
    error.code = "ACCOUNT_INACTIVE";
    throw error;
  }
  if (
    ["owner", "staff"].includes(user.role_code) &&
    user.email_verified_at === null
  ) {
    const error = new Error("Verified email is required for CRM access.");
    error.statusCode = 403;
    error.code = "EMAIL_NOT_VERIFIED";
    throw error;
  }

  const [permissionRows] = await pool.execute(
    `SELECT p.code, up.effect
     FROM permissions AS p
     LEFT JOIN role_permissions AS rp
       ON rp.permission_id = p.id AND rp.role_id = ?
     LEFT JOIN user_permissions AS up
       ON up.permission_id = p.id AND up.user_id = ?
     WHERE rp.role_id IS NOT NULL OR up.user_id IS NOT NULL`,
    [user.id, user.id]
  );
  const permissions = [];
  for (const row of permissionRows) {
    if (row.effect === "deny") continue;
    if (user.role_code === "staff" && !STAFF_PERMISSION_ALLOWLIST.has(row.code)) continue;
    if (user.role_code === "customer" && !CUSTOMER_PERMISSION_ALLOWLIST.has(row.code)) continue;
    if (["owner", "staff", "customer"].includes(user.role_code)) permissions.push(row.code);
  }

  return Object.freeze({
    id: user.id,
    uid: user.firebase_uid,
    email: user.email,
    displayName: user.display_name,
    role: user.role_code,
    permissions: Object.freeze(permissions)
  });
}

export function createRequirePrincipal({
  getPool = getDatabasePool,
  principalResolver = resolvePrincipal
} = {}) {
  return async function requirePrincipal(request, response, next) {
    try {
      const principal = await principalResolver(getPool(), request.auth);
      if (!principal) {
        response.status(403).json({
          error: {
            code: "PROFILE_REQUIRED",
            message: "A server-managed user profile is required."
          }
        });
        return;
      }
      request.principal = principal;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requirePermission(permission) {
  if (typeof permission !== "string" || !permission) {
    throw new TypeError("Permission code must be a non-empty string.");
  }

  return requireAnyPermission(permission);
}

export function requireAnyPermission(...permissions) {
  if (
    permissions.length === 0 ||
    permissions.some((permission) => typeof permission !== "string" || !permission)
  ) {
    throw new TypeError("At least one valid permission code is required.");
  }

  return function checkPermission(request, response, next) {
    if (
      request.principal?.role === "customer" &&
      permissions.some((permission) => permission.startsWith("crm."))
    ) {
      response.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "This operation is not available to customer accounts."
        }
      });
      return;
    }
    if (!permissions.some((permission) => request.principal?.permissions.includes(permission))) {
      response.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "You do not have permission to perform this operation."
        }
      });
      return;
    }
    next();
  };
}
