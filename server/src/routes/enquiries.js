import { randomUUID } from "node:crypto";
import { Router } from "express";
import { encryptPhone } from "../config/phoneCrypto.js";
import { writeActivityLog } from "../database/activityLog.js";
import { getDatabasePool, withDatabaseTransaction } from "../database/pool.js";
import { createRequirePrincipal, requireAnyPermission, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

const ENQUIRY_STATUSES = new Set(["new", "contacted", "converted", "closed"]);
const ENQUIRY_SELECT = `SELECT e.id, e.request_id, e.record_type, e.customer_id,
                               e.customer_name_snapshot, e.customer_email, e.bike_id,
                               e.bike_model_snapshot, e.assigned_staff_user_id, e.status,
                               e.created_at, e.updated_at
                        FROM enquiries AS e`;

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

function parsePagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 25 : Number(query.pageSize);
  if (
    !Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
  ) return null;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function enquiryDto(row) {
  return {
    id: String(row.id),
    requestId: row.request_id,
    recordType: row.record_type,
    customerId: row.customer_id === null ? null : String(row.customer_id),
    customerName: row.customer_name_snapshot,
    customerEmail: row.customer_email,
    bikeId: row.bike_id === null ? null : String(row.bike_id),
    bikeModel: row.bike_model_snapshot,
    assignedStaffUserId: row.assigned_staff_user_id === null
      ? null
      : String(row.assigned_staff_user_id),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isStaff(principal) {
  return principal.role === "staff";
}

async function assertActiveStaff(connection, staffId) {
  const [rows] = await connection.execute(
    `SELECT sp.user_id
     FROM staff_profiles AS sp
     JOIN users AS u ON u.id = sp.user_id
     JOIN roles AS r ON r.id = u.primary_role_id
     WHERE sp.user_id = ? AND r.code = 'staff'
       AND sp.employment_status = 'active' AND u.account_status = 'active'
     FOR UPDATE`,
    [staffId]
  );
  return rows.length > 0;
}

export function createEnquiryRouter({
  getPool = getDatabasePool,
  withTransaction = withDatabaseTransaction,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal,
  phoneEncryptor = encryptPhone
} = {}) {
  const router = Router();

  router.post("/enquiries", async (request, response, next) => {
    const body = request.body;
    const allowed = new Set(["name", "email", "phone", "bikeId"]);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.has(key)) ||
      typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100 ||
      (body.email !== undefined && body.email !== null &&
        (typeof body.email !== "string" || body.email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) ||
      parseId(String(body.bikeId ?? "")) === null) {
      sendError(response, 400, "INVALID_ENQUIRY", "Enquiry details are invalid.");
      return;
    }

    let phone;
    try {
      phone = phoneEncryptor(body.phone);
    } catch (error) {
      if (error?.code === "INVALID_PHONE") {
        sendError(response, 400, "INVALID_PHONE", "Phone number is invalid.");
        return;
      }
      if (error?.code === "PHONE_CRYPTO_CONFIG") {
        sendError(response, 503, "ENQUIRY_SUBMISSION_UNAVAILABLE", "Enquiry submission is not configured.");
        return;
      }
      next(error);
      return;
    }

    try {
      const pool = getPool();
      const [bikes] = await pool.execute(
        `SELECT id, model, name FROM bikes
         WHERE id = ? AND status = 'published'
         LIMIT 1`,
        [String(body.bikeId)]
      );
      if (!bikes[0]) {
        sendError(response, 400, "INVALID_BIKE", "Select an available bike.");
        return;
      }
      const requestId = randomUUID();
      await pool.execute(
        `INSERT INTO enquiries (
           request_id, record_type, customer_name_snapshot, customer_email,
           phone_ciphertext, encryption_nonce, authentication_tag,
           encryption_key_version, phone_lookup_hmac, lookup_key_version,
           bike_id, bike_model_snapshot, status, created_at, updated_at
         ) VALUES (?, 'public', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new',
                   UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
        [
          requestId,
          body.name.trim(),
          body.email ?? null,
          phone.ciphertext,
          phone.nonce,
          phone.authenticationTag,
          phone.encryptionKeyVersion,
          phone.lookupHmac,
          phone.lookupKeyVersion,
          String(bikes[0].id),
          bikes[0].model || bikes[0].name
        ]
      );
      response.status(201).json({ data: { requestId } });
    } catch (error) {
      next(error);
    }
  });

  router.use(
    "/crm/enquiries",
    verifyToken,
    createRequirePrincipal({ getPool, principalResolver })
  );

  router.get(
    "/crm/enquiries",
    requireAnyPermission("crm.enquiries.read.assigned", "crm.enquiries.read.all"),
    async (request, response, next) => {
      const pagination = parsePagination(request.query);
      if (!pagination) {
        sendError(response, 400, "INVALID_PAGINATION", "Page and pageSize are invalid.");
        return;
      }
      if (request.query.status !== undefined &&
        !ENQUIRY_STATUSES.has(request.query.status)) {
        sendError(response, 400, "INVALID_ENQUIRY_STATUS", "Enquiry status is invalid.");
        return;
      }

      const filters = ["1 = 1"];
      const parameters = [];
      if (isStaff(request.principal)) {
        filters.push("e.assigned_staff_user_id = ?");
        parameters.push(request.principal.id);
      }
      if (request.query.status !== undefined) {
        filters.push("e.status = ?");
        parameters.push(request.query.status);
      }
      const where = filters.join(" AND ");
      try {
        const pool = getPool();
        const [[countRows], [rows]] = await Promise.all([
          pool.execute(`SELECT COUNT(*) AS total FROM enquiries AS e WHERE ${where}`, parameters),
          pool.execute(
            `${ENQUIRY_SELECT} WHERE ${where}
             ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
            [...parameters, pagination.pageSize, pagination.offset]
          )
        ]);
        response.status(200).json({
          data: {
            enquiries: rows.map(enquiryDto),
            pagination: {
              page: pagination.page,
              pageSize: pagination.pageSize,
              total: Number(countRows[0].total)
            }
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/crm/enquiries/:enquiryId/history",
    requireAnyPermission("crm.enquiries.read.assigned", "crm.enquiries.read.all"),
    async (request, response, next) => {
      const enquiryId = parseId(request.params.enquiryId);
      if (!enquiryId) {
        sendError(response, 400, "INVALID_ENQUIRY_ID", "Enquiry ID is invalid.");
        return;
      }
      const scope = isStaff(request.principal)
        ? " AND assigned_staff_user_id = ?"
        : "";
      const parameters = isStaff(request.principal)
        ? [enquiryId, request.principal.id]
        : [enquiryId];
      try {
        const [visible] = await getPool().execute(
          `SELECT id FROM enquiries WHERE id = ?${scope} LIMIT 1`,
          parameters
        );
        if (!visible[0]) {
          sendError(response, 404, "ENQUIRY_NOT_FOUND", "Enquiry not found.");
          return;
        }
        const [rows] = await getPool().execute(
          `SELECT id, from_status, to_status, changed_by_user_id, changed_at
           FROM enquiry_status_history
           WHERE enquiry_id = ? ORDER BY changed_at, id`,
          [enquiryId]
        );
        response.status(200).json({
          data: {
            history: rows.map((row) => ({
              id: String(row.id),
              fromStatus: row.from_status,
              toStatus: row.to_status,
              changedByUserId: row.changed_by_user_id === null
                ? null
                : String(row.changed_by_user_id),
              changedAt: row.changed_at
            }))
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/crm/enquiries/:enquiryId",
    requireAnyPermission("crm.enquiries.read.assigned", "crm.enquiries.read.all"),
    async (request, response, next) => {
      const enquiryId = parseId(request.params.enquiryId);
      if (!enquiryId) {
        sendError(response, 400, "INVALID_ENQUIRY_ID", "Enquiry ID is invalid.");
        return;
      }
      const scope = isStaff(request.principal)
        ? " AND e.assigned_staff_user_id = ?"
        : "";
      const parameters = isStaff(request.principal)
        ? [enquiryId, request.principal.id]
        : [enquiryId];
      try {
        const [rows] = await getPool().execute(
          `${ENQUIRY_SELECT} WHERE e.id = ?${scope} LIMIT 1`,
          parameters
        );
        if (!rows[0]) {
          sendError(response, 404, "ENQUIRY_NOT_FOUND", "Enquiry not found.");
          return;
        }
        response.status(200).json({ data: { enquiry: enquiryDto(rows[0]) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/crm/enquiries/:enquiryId",
    requireAnyPermission("crm.enquiries.update.assigned", "crm.enquiries.update.all"),
    async (request, response, next) => {
      const enquiryId = parseId(request.params.enquiryId);
      if (!enquiryId) {
        sendError(response, 400, "INVALID_ENQUIRY_ID", "Enquiry ID is invalid.");
        return;
      }
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length === 0 ||
        Object.keys(body).some((key) => !["status", "assignedStaffUserId"].includes(key))) {
        sendError(response, 400, "INVALID_ENQUIRY", "Enquiry update fields are invalid.");
        return;
      }
      if (Object.hasOwn(body, "status") && !ENQUIRY_STATUSES.has(body.status)) {
        sendError(response, 400, "INVALID_ENQUIRY_STATUS", "Enquiry status is invalid.");
        return;
      }
      const canAssign = request.principal.permissions.includes("crm.enquiries.assign");
      if (Object.hasOwn(body, "assignedStaffUserId") &&
        (isStaff(request.principal) || !canAssign)) {
        sendError(response, 403, "FORBIDDEN", "You cannot reassign this enquiry.");
        return;
      }
      let assignedStaffId;
      if (Object.hasOwn(body, "assignedStaffUserId")) {
        if (body.assignedStaffUserId !== null &&
          parseId(String(body.assignedStaffUserId)) === null) {
          sendError(response, 400, "INVALID_STAFF_ASSIGNMENT", "Staff assignment is invalid.");
          return;
        }
        assignedStaffId = body.assignedStaffUserId === null
          ? null
          : String(body.assignedStaffUserId);
      }

      try {
        const updated = await withTransaction(async (connection) => {
          const staffScope = isStaff(request.principal)
            ? " AND assigned_staff_user_id = ?"
            : "";
          const selectParameters = isStaff(request.principal)
            ? [enquiryId, request.principal.id]
            : [enquiryId];
          const [rows] = await connection.execute(
            `SELECT id, status FROM enquiries
             WHERE id = ?${staffScope} FOR UPDATE`,
            selectParameters
          );
          const enquiry = rows[0];
          if (!enquiry) return false;

          if (Object.hasOwn(body, "assignedStaffUserId") &&
            assignedStaffId !== null &&
            !await assertActiveStaff(connection, assignedStaffId)) return null;

          if (Object.hasOwn(body, "status") && body.status !== enquiry.status) {
            await connection.execute(
              "UPDATE enquiries SET status = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
              [body.status, enquiryId]
            );
            await connection.execute(
              `INSERT INTO enquiry_status_history
                 (enquiry_id, from_status, to_status, changed_by_user_id)
               VALUES (?, ?, ?, ?)`,
              [enquiryId, enquiry.status, body.status, request.principal.id]
            );
          }
          if (Object.hasOwn(body, "assignedStaffUserId")) {
            await connection.execute(
              `UPDATE enquiries SET assigned_staff_user_id = ?, updated_at = UTC_TIMESTAMP(6)
               WHERE id = ?`,
              [assignedStaffId, enquiryId]
            );
          }
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "enquiry.updated",
            entityType: "enquiry",
            entityId: enquiryId,
            details: {
              status: body.status ?? null,
              assignmentChanged: Object.hasOwn(body, "assignedStaffUserId")
            }
          });
          return true;
        });
        if (updated === null) {
          sendError(response, 400, "INVALID_STAFF_ASSIGNMENT", "The selected staff member is not active.");
          return;
        }
        if (!updated) {
          sendError(response, 404, "ENQUIRY_NOT_FOUND", "Enquiry not found.");
          return;
        }
        response.status(200).json({ data: { id: enquiryId } });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
