import { Router } from "express";
import { getDatabasePool } from "../database/pool.js";
import { createRequirePrincipal, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

function isEmptyObject(value) {
  return value === undefined ||
    (value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 0);
}

function userResponse(principal) {
  return {
    uid: principal.uid,
    email: principal.email,
    displayName: principal.displayName,
    role: principal.role,
    permissions: principal.permissions
  };
}

export function createAccountRouter({
  getPool = getDatabasePool,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal
} = {}) {
  const router = Router();
  const authenticate = verifyToken;

  router.post("/auth/sync", authenticate, async (request, response, next) => {
    if (!isEmptyObject(request.body)) {
      response.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Profile sync does not accept client-supplied profile or role fields."
        }
      });
      return;
    }

    const uid = request.auth?.uid;
    if (typeof uid !== "string" || uid.length < 1 || uid.length > 128) {
      response.status(401).json({
        error: {
          code: "UNAUTHENTICATED",
          message: "Authentication required."
        }
      });
      return;
    }

    const email = typeof request.auth.email === "string" &&
      request.auth.email.length <= 254
      ? request.auth.email
      : null;
    const displayName = typeof request.auth.name === "string"
      ? request.auth.name.trim().slice(0, 100)
      : "";

    try {
      const pool = getPool();
      await pool.execute(
        `INSERT INTO users (
           firebase_uid, email, display_name, email_verified_at,
          primary_role_id, last_login_at, created_at, updated_at
         )
         SELECT ?, ?, ?, IF(? = 1, UTC_TIMESTAMP(6), NULL),
               roles.id, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
         FROM roles
         WHERE roles.code = 'customer'
         ON DUPLICATE KEY UPDATE
           email = COALESCE(VALUES(email), email),
           display_name = IF(VALUES(display_name) = '', display_name, VALUES(display_name)),
           email_verified_at = VALUES(email_verified_at),
           last_login_at = UTC_TIMESTAMP(6),
           updated_at = UTC_TIMESTAMP(6)`,
        [uid, email, displayName, request.auth.email_verified === true ? 1 : 0]
      );

      const principal = await principalResolver(pool, request.auth);
      if (!principal) {
        response.status(503).json({
          error: {
            code: "PROFILE_SYNC_UNAVAILABLE",
            message: "The customer role is not initialized. Contact the system owner."
          }
        });
        return;
      }
      response.status(200).json({ data: { user: userResponse(principal) } });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        response.status(409).json({
          error: {
            code: "PROFILE_CONFLICT",
            message: "The authenticated account conflicts with an existing user profile."
          }
        });
        return;
      }
      next(error);
    }
  });

  router.get(
    "/me",
    authenticate,
    createRequirePrincipal({ getPool, principalResolver }),
    (request, response) => {
      response.status(200).json({ data: { user: userResponse(request.principal) } });
    }
  );

  return router;
}
