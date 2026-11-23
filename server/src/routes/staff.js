import { Router } from "express";
import { writeActivityLog } from "../database/activityLog.js";
import { getDatabasePool, withDatabaseTransaction } from "../database/pool.js";
import { createRequirePrincipal, requireAnyPermission, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

function sendError(response, status, code, message) {
  response.status(status).json({ error: { code, message } });
}

function parseId(value) {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value)) return null;
  try {
    return BigInt(value) <= 18446744073709551615n ? value : null;
  } catch {
    return null;
  }
}

function staffDto(row) {
  return {
    id: String(row.user_id),
    email: row.email,
    displayName: row.display_name,
    employeeCode: row.employee_code,
    employmentStatus: row.employment_status,
    title: row.title,
    accountStatus: row.account_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const STAFF_SELECT = `SELECT u.id AS user_id, u.email, u.display_name,
                             u.account_status, sp.employee_code, sp.employment_status,
                             sp.title, sp.created_at, sp.updated_at
                      FROM staff_profiles AS sp
                      JOIN users AS u ON u.id = sp.user_id
                      JOIN roles AS r ON r.id = u.primary_role_id
                      WHERE r.code = 'staff'`;

async function lookupFirebaseUserByEmail(email) {
  const { firebaseAuth } = await import("../config/firebaseAdmin.js");
  return firebaseAuth.getUserByEmail(email);
}

export function createStaffRouter({
  getPool = getDatabasePool,
  withTransaction = withDatabaseTransaction,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal,
  getFirebaseUserByEmail = lookupFirebaseUserByEmail
} = {}) {
  const router = Router();
  router.use(
    "/crm/staff",
    verifyToken,
    createRequirePrincipal({ getPool, principalResolver })
  );

  router.get(
    "/crm/staff",
    requireAnyPermission("crm.staff.read"),
    async (_request, response, next) => {
      try {
        const [rows] = await getPool().execute(`${STAFF_SELECT} ORDER BY u.display_name, u.id`);
        response.status(200).json({ data: { staff: rows.map(staffDto) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/crm/staff",
    requireAnyPermission("crm.staff.manage"),
    async (request, response, next) => {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["email", "employeeCode", "title"].includes(key)) ||
        typeof body.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
        body.email.length > 254 ||
        (body.employeeCode !== undefined && body.employeeCode !== null &&
          (typeof body.employeeCode !== "string" || !body.employeeCode.trim() ||
            body.employeeCode.trim().length > 64)) ||
        (body.title !== undefined && body.title !== null &&
          (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 100))) {
        sendError(response, 400, "INVALID_STAFF_PROFILE", "Staff provisioning fields are invalid.");
        return;
      }

      let firebaseUser;
      try {
        firebaseUser = await getFirebaseUserByEmail(body.email.trim().toLowerCase());
      } catch (error) {
        if (error?.code === "auth/user-not-found") {
          sendError(response, 404, "FIREBASE_USER_NOT_FOUND", "A verified Firebase account was not found.");
          return;
        }
        next(error);
        return;
      }
      if (
        typeof firebaseUser?.uid !== "string" || !firebaseUser.uid ||
        firebaseUser.disabled === true ||
        firebaseUser.emailVerified !== true ||
        typeof firebaseUser.email !== "string" ||
        firebaseUser.email.toLowerCase() !== body.email.trim().toLowerCase()
      ) {
        sendError(response, 409, "FIREBASE_ACCOUNT_INELIGIBLE", "The Firebase account must be active and email-verified.");
        return;
      }

      try {
        const result = await withTransaction(async (connection) => {
          const [existingUsers] = await connection.execute(
            `SELECT id FROM users
             WHERE firebase_uid = ? OR email = ?
             FOR UPDATE`,
            [firebaseUser.uid, firebaseUser.email]
          );
          if (existingUsers.length > 0) return { conflict: true };
          const [roles] = await connection.execute(
            "SELECT id FROM roles WHERE code = 'staff' LIMIT 1"
          );
          if (!roles[0]) return { roleMissing: true };
          const displayName = typeof firebaseUser.displayName === "string"
            ? firebaseUser.displayName.trim().slice(0, 100)
            : "";
          const [userInsert] = await connection.execute(
            `INSERT INTO users (
               firebase_uid, email, display_name, email_verified_at,
               primary_role_id, account_status, created_at, updated_at
             ) VALUES (?, ?, ?, UTC_TIMESTAMP(6), ?, 'active',
                       UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
            [firebaseUser.uid, firebaseUser.email, displayName, roles[0].id]
          );
          await connection.execute(
            `INSERT INTO staff_profiles (
               user_id, employee_code, employment_status, title, created_at, updated_at
             ) VALUES (?, ?, 'active', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
            [userInsert.insertId, body.employeeCode?.trim() || null, body.title?.trim() || null]
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "staff.provisioned",
            entityType: "staff",
            entityId: userInsert.insertId,
            details: { emailVerified: true }
          });
          return { id: userInsert.insertId };
        });
        if (result.conflict) {
          sendError(response, 409, "STAFF_PROFILE_EXISTS", "This Firebase account is already mapped to a profile.");
          return;
        }
        if (result.roleMissing) {
          sendError(response, 503, "STAFF_ROLE_UNAVAILABLE", "The Staff role is not initialized.");
          return;
        }
        response.status(201).json({ data: { id: String(result.id) } });
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
          sendError(response, 409, "STAFF_PROFILE_CONFLICT", "The email or employee code is already in use.");
          return;
        }
        next(error);
      }
    }
  );

  router.get(
    "/crm/staff/:userId",
    requireAnyPermission("crm.staff.read"),
    async (request, response, next) => {
      const userId = parseId(request.params.userId);
      if (!userId) {
        sendError(response, 400, "INVALID_STAFF_ID", "Staff ID is invalid.");
        return;
      }
      try {
        const [rows] = await getPool().execute(`${STAFF_SELECT} AND u.id = ? LIMIT 1`, [userId]);
        if (!rows[0]) {
          sendError(response, 404, "STAFF_NOT_FOUND", "Staff profile not found.");
          return;
        }
        response.status(200).json({ data: { staff: staffDto(rows[0]) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/crm/staff/:userId",
    requireAnyPermission("crm.staff.manage"),
    async (request, response, next) => {
      const userId = parseId(request.params.userId);
      const body = request.body;
      if (!userId) {
        sendError(response, 400, "INVALID_STAFF_ID", "Staff ID is invalid.");
        return;
      }
      const allowedKeys = new Set(["employeeCode", "employmentStatus", "title"]);
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length === 0 ||
        Object.keys(body).some((key) => !allowedKeys.has(key))) {
        sendError(response, 400, "INVALID_STAFF_PROFILE", "Staff profile fields are invalid.");
        return;
      }

      const profileFields = [];
      if (Object.hasOwn(body, "employeeCode")) {
        if (body.employeeCode !== null &&
          (typeof body.employeeCode !== "string" || !body.employeeCode.trim() ||
            body.employeeCode.trim().length > 64)) {
          sendError(response, 400, "INVALID_STAFF_PROFILE", "Employee code is invalid.");
          return;
        }
        profileFields.push(["employee_code", body.employeeCode?.trim() || null]);
      }
      if (Object.hasOwn(body, "title")) {
        if (body.title !== null &&
          (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 100)) {
          sendError(response, 400, "INVALID_STAFF_PROFILE", "Staff title is invalid.");
          return;
        }
        profileFields.push(["title", body.title?.trim() || null]);
      }
      const employmentStatus = body.employmentStatus;
      if (employmentStatus !== undefined &&
        !["active", "on_leave", "terminated"].includes(employmentStatus)) {
        sendError(response, 400, "INVALID_STAFF_PROFILE", "Employment status is invalid.");
        return;
      }

      try {
        const updated = await withTransaction(async (connection) => {
          const [existing] = await connection.execute(
            `SELECT sp.user_id
             FROM staff_profiles AS sp
             JOIN users AS u ON u.id = sp.user_id
             JOIN roles AS r ON r.id = u.primary_role_id
             WHERE sp.user_id = ? AND r.code = 'staff'
             FOR UPDATE`,
            [userId]
          );
          if (!existing[0]) return false;

          if (profileFields.length > 0 || employmentStatus !== undefined) {
            const fields = [...profileFields];
            if (employmentStatus !== undefined) fields.push(["employment_status", employmentStatus]);
            const setClause = fields.map(([column]) => `${column} = ?`).join(", ");
            await connection.execute(
              `UPDATE staff_profiles SET ${setClause}, updated_at = UTC_TIMESTAMP(6)
               WHERE user_id = ?`,
              [...fields.map(([, value]) => value), userId]
            );
          }
          if (employmentStatus !== undefined) {
            const accountStatus = {
              active: "active",
              on_leave: "suspended",
              terminated: "disabled"
            }[employmentStatus];
            await connection.execute(
              "UPDATE users SET account_status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
              [accountStatus, userId]
            );
          }
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "staff.updated",
            entityType: "staff",
            entityId: userId,
            details: {
              updatedFields: [
                ...profileFields.map(([column]) => column),
                ...(employmentStatus === undefined ? [] : ["employment_status"])
              ],
              employmentStatus: employmentStatus ?? null
            }
          });
          return true;
        });
        if (!updated) {
          sendError(response, 404, "STAFF_NOT_FOUND", "Staff profile not found.");
          return;
        }
        response.status(200).json({ data: { id: userId } });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
