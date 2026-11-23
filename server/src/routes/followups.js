import { Router } from "express";
import { writeActivityLog } from "../database/activityLog.js";
import { getDatabasePool, withDatabaseTransaction } from "../database/pool.js";
import { createRequirePrincipal, requireAnyPermission, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

const FOLLOWUP_STATUSES = new Set(["pending", "completed", "cancelled"]);
const FOLLOWUP_SELECT = `SELECT f.id, f.customer_id, f.enquiry_id, f.assigned_staff_user_id,
                                f.due_at, f.status, f.notes, f.created_by_user_id,
                                f.completed_by_user_id, f.completed_at,
                                f.cancelled_by_user_id, f.cancelled_at,
                                f.created_at, f.updated_at, c.name AS customer_name,
                                e.bike_model_snapshot
                         FROM follow_ups AS f
                         JOIN customers AS c ON c.id = f.customer_id
                         LEFT JOIN enquiries AS e ON e.id = f.enquiry_id`;

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

function parseDueAt(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace("T", " ");
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

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return `${String(value).replace(" ", "T")}Z`;
}

function followupDto(row) {
  return {
    id: String(row.id),
    customerId: String(row.customer_id),
    customerName: row.customer_name,
    enquiryId: row.enquiry_id === null ? null : String(row.enquiry_id),
    bikeModel: row.bike_model_snapshot,
    assignedStaffUserId: row.assigned_staff_user_id === null
      ? null
      : String(row.assigned_staff_user_id),
    dueAt: isoDate(row.due_at),
    status: row.status,
    notes: row.notes,
    createdByUserId: row.created_by_user_id === null
      ? null
      : String(row.created_by_user_id),
    completedByUserId: row.completed_by_user_id === null
      ? null
      : String(row.completed_by_user_id),
    completedAt: isoDate(row.completed_at),
    cancelledByUserId: row.cancelled_by_user_id === null
      ? null
      : String(row.cancelled_by_user_id),
    cancelledAt: isoDate(row.cancelled_at),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at)
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

async function assertCustomerScope(connection, customerId, principal) {
  const staffFilter = isStaff(principal) ? " AND assigned_staff_user_id = ?" : "";
  const parameters = isStaff(principal)
    ? [customerId, principal.id]
    : [customerId];
  const [rows] = await connection.execute(
    `SELECT id FROM customers
     WHERE id = ? AND is_archived = FALSE${staffFilter}
     FOR UPDATE`,
    parameters
  );
  return rows.length > 0;
}

export function createFollowupRouter({
  getPool = getDatabasePool,
  withTransaction = withDatabaseTransaction,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal
} = {}) {
  const router = Router();
  router.use(
    "/crm/follow-ups",
    verifyToken,
    createRequirePrincipal({ getPool, principalResolver })
  );

  router.get(
    "/crm/follow-ups",
    requireAnyPermission("crm.followups.read.assigned", "crm.followups.read.all"),
    async (request, response, next) => {
      const pagination = parsePagination(request.query);
      if (!pagination) {
        sendError(response, 400, "INVALID_PAGINATION", "Page and pageSize are invalid.");
        return;
      }
      if (request.query.status !== undefined &&
        !FOLLOWUP_STATUSES.has(request.query.status)) {
        sendError(response, 400, "INVALID_FOLLOWUP_STATUS", "Follow-up status is invalid.");
        return;
      }
      const filters = ["1 = 1"];
      const parameters = [];
      if (isStaff(request.principal)) {
        filters.push("f.assigned_staff_user_id = ?");
        parameters.push(request.principal.id);
      }
      if (request.query.status !== undefined) {
        filters.push("f.status = ?");
        parameters.push(request.query.status);
      }
      const where = filters.join(" AND ");
      try {
        const pool = getPool();
        const [[countRows], [rows]] = await Promise.all([
          pool.execute(`SELECT COUNT(*) AS total FROM follow_ups AS f WHERE ${where}`, parameters),
          pool.execute(
            `${FOLLOWUP_SELECT} WHERE ${where}
             ORDER BY f.due_at, f.id LIMIT ? OFFSET ?`,
            [...parameters, pagination.pageSize, pagination.offset]
          )
        ]);
        response.status(200).json({
          data: {
            followUps: rows.map(followupDto),
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

  router.post(
    "/crm/follow-ups",
    requireAnyPermission("crm.followups.create.assigned", "crm.followups.create.all"),
    async (request, response, next) => {
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) =>
          !["customerId", "enquiryId", "assignedStaffUserId", "dueAt", "notes"].includes(key)
        )) {
        sendError(response, 400, "INVALID_FOLLOWUP", "Follow-up fields are invalid.");
        return;
      }
      const customerId = parseId(String(body.customerId ?? ""));
      const enquiryId = body.enquiryId === undefined || body.enquiryId === null
        ? null
        : parseId(String(body.enquiryId));
      const dueAt = parseDueAt(body.dueAt);
      if (!customerId || (body.enquiryId != null && !enquiryId) || !dueAt) {
        sendError(response, 400, "INVALID_FOLLOWUP", "Customer, enquiry, or due date is invalid.");
        return;
      }
      if (body.notes !== undefined &&
        (body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 10000))) {
        sendError(response, 400, "INVALID_FOLLOWUP", "Follow-up notes are invalid.");
        return;
      }

      const canAssignAll = request.principal.permissions.includes("crm.followups.create.all");
      if (isStaff(request.principal) && Object.hasOwn(body, "assignedStaffUserId")) {
        sendError(response, 403, "FORBIDDEN", "Staff follow-ups are assigned to the acting staff member.");
        return;
      }
      let assignedStaffId;
      if (isStaff(request.principal)) {
        assignedStaffId = String(request.principal.id);
      } else {
        assignedStaffId = body.assignedStaffUserId === undefined ||
          body.assignedStaffUserId === null
          ? null
          : parseId(String(body.assignedStaffUserId));
        if (!canAssignAll || !assignedStaffId) {
          sendError(response, 400, "INVALID_STAFF_ASSIGNMENT", "An active staff member must be assigned.");
          return;
        }
      }

      try {
        const followupId = await withTransaction(async (connection) => {
          if (!await assertCustomerScope(connection, customerId, request.principal)) return false;
          if (!await assertActiveStaff(connection, assignedStaffId)) return null;
          if (enquiryId !== null) {
            const enquiryScope = isStaff(request.principal)
              ? " AND assigned_staff_user_id = ?"
              : "";
            const enquiryParameters = isStaff(request.principal)
              ? [enquiryId, customerId, request.principal.id]
              : [enquiryId, customerId];
            const [enquiries] = await connection.execute(
              `SELECT id FROM enquiries
               WHERE id = ? AND customer_id = ?${enquiryScope}
               FOR UPDATE`,
              enquiryParameters
            );
            if (!enquiries[0]) return false;
          }
          const [insert] = await connection.execute(
            `INSERT INTO follow_ups (
               customer_id, enquiry_id, assigned_staff_user_id, due_at, status, notes,
               origin, created_by_user_id, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'pending', ?, 'new', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
            [customerId, enquiryId, assignedStaffId, dueAt, body.notes ?? null, request.principal.id]
          );
          await connection.execute(
            `INSERT INTO follow_up_history (
               follow_up_id, change_type, new_due_at, new_assigned_staff_user_id,
               new_status, changed_by_user_id, changed_at
             ) VALUES (?, 'created', ?, ?, 'pending', ?, UTC_TIMESTAMP(6))`,
            [insert.insertId, dueAt, assignedStaffId, request.principal.id]
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "followup.created",
            entityType: "follow_up",
            entityId: insert.insertId,
            details: { customerId, enquiryId }
          });
          return insert.insertId;
        });
        if (followupId === false) {
          sendError(response, 404, "CUSTOMER_OR_ENQUIRY_NOT_FOUND", "Customer or enquiry is not available.");
          return;
        }
        if (followupId === null) {
          sendError(response, 400, "INVALID_STAFF_ASSIGNMENT", "The selected staff member is not active.");
          return;
        }
        response.status(201).json({ data: { id: String(followupId) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/crm/follow-ups/:followupId",
    requireAnyPermission("crm.followups.read.assigned", "crm.followups.read.all"),
    async (request, response, next) => {
      const followupId = parseId(request.params.followupId);
      if (!followupId) {
        sendError(response, 400, "INVALID_FOLLOWUP_ID", "Follow-up ID is invalid.");
        return;
      }
      const scope = isStaff(request.principal) ? " AND f.assigned_staff_user_id = ?" : "";
      const parameters = isStaff(request.principal)
        ? [followupId, request.principal.id]
        : [followupId];
      try {
        const [rows] = await getPool().execute(
          `${FOLLOWUP_SELECT} WHERE f.id = ?${scope} LIMIT 1`,
          parameters
        );
        if (!rows[0]) {
          sendError(response, 404, "FOLLOWUP_NOT_FOUND", "Follow-up not found.");
          return;
        }
        response.status(200).json({ data: { followUp: followupDto(rows[0]) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/crm/follow-ups/:followupId",
    requireAnyPermission("crm.followups.update.assigned", "crm.followups.update.all"),
    async (request, response, next) => {
      const followupId = parseId(request.params.followupId);
      const body = request.body;
      if (!followupId) {
        sendError(response, 400, "INVALID_FOLLOWUP_ID", "Follow-up ID is invalid.");
        return;
      }
      try {
        const updated = await withTransaction(async (connection) => {
          const scope = isStaff(request.principal)
            ? " AND assigned_staff_user_id = ?"
            : "";
          const selectParameters = isStaff(request.principal)
            ? [followupId, request.principal.id]
            : [followupId];
          const [rows] = await connection.execute(
            `SELECT id, due_at, assigned_staff_user_id, status
             FROM follow_ups WHERE id = ?${scope} FOR UPDATE`,
            selectParameters
          );
          const followup = rows[0];
          if (!followup) return false;
          if (followup.status !== "pending") return "terminal";

          if (!body || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).length === 0 ||
            Object.keys(body).some((key) => !["dueAt", "assignedStaffUserId", "status"].includes(key))) {
            return "invalid_followup";
          }

          const dueAt = Object.hasOwn(body, "dueAt") ? parseDueAt(body.dueAt) : undefined;
          if (Object.hasOwn(body, "dueAt") && !dueAt) {
            return "invalid_due_at";
          }
          if (Object.hasOwn(body, "status") && !FOLLOWUP_STATUSES.has(body.status)) {
            return "invalid_status";
          }

          let assignedStaffId;
          if (Object.hasOwn(body, "assignedStaffUserId")) {
            if (!request.principal.permissions.includes("crm.followups.update.all")) {
              return "forbidden_reassign";
            }
            assignedStaffId = body.assignedStaffUserId === null
              ? null
              : parseId(String(body.assignedStaffUserId));
            if (!assignedStaffId) {
              return "invalid_staff_assignment";
            }
          }

          if (Object.hasOwn(body, "status") && body.status === "cancelled" &&
            !request.principal.permissions.includes("crm.followups.cancel")) {
            return "forbidden_cancel";
          }
          if (assignedStaffId !== undefined && assignedStaffId !== null &&
            !await assertActiveStaff(connection, assignedStaffId)) return null;

          const historyChanges = [];
          const updates = [];
          if (dueAt !== undefined) {
            const oldDueAt = isoDate(followup.due_at);
            const oldSqlDueAt = oldDueAt?.slice(0, 23).replace("T", " ") ?? null;
            if (oldSqlDueAt !== dueAt) {
              updates.push(["due_at", dueAt]);
              historyChanges.push([
                "rescheduled", oldSqlDueAt, dueAt,
                followup.assigned_staff_user_id, followup.assigned_staff_user_id,
                followup.status, followup.status
              ]);
            }
          }
          if (assignedStaffId !== undefined &&
            String(followup.assigned_staff_user_id) !== String(assignedStaffId)) {
            updates.push(["assigned_staff_user_id", assignedStaffId]);
            historyChanges.push([
              "reassigned", null, null, followup.assigned_staff_user_id,
              assignedStaffId, followup.status, followup.status
            ]);
          }
          if (body.status !== undefined && body.status !== followup.status) {
            updates.push(["status", body.status]);
            if (body.status === "completed") {
              updates.push(["completed_by_user_id", request.principal.id]);
              updates.push(["completed_at", "UTC_TIMESTAMP(6)"]);
            } else if (body.status === "cancelled") {
              updates.push(["cancelled_by_user_id", request.principal.id]);
              updates.push(["cancelled_at", "UTC_TIMESTAMP(6)"]);
            }
            historyChanges.push([
              "status_changed", null, null, null, null, followup.status, body.status
            ]);
          }

          if (updates.length > 0) {
            const setParts = updates.map(([column, value]) =>
              value === "UTC_TIMESTAMP(6)" ? `${column} = UTC_TIMESTAMP(6)` : `${column} = ?`
            );
            const values = updates
              .filter(([, value]) => value !== "UTC_TIMESTAMP(6)")
              .map(([, value]) => value);
            await connection.execute(
              `UPDATE follow_ups SET ${setParts.join(", ")}, updated_at = UTC_TIMESTAMP(6)
               WHERE id = ?`,
              [...values, followupId]
            );
          }
          for (const [type, oldDue, newDue, oldStaff, newStaff, oldStatus, newStatus] of historyChanges) {
            await connection.execute(
              `INSERT INTO follow_up_history (
                 follow_up_id, change_type, old_due_at, new_due_at,
                 old_assigned_staff_user_id, new_assigned_staff_user_id,
                 old_status, new_status, changed_by_user_id, changed_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
              [followupId, type, oldDue, newDue, oldStaff, newStaff, oldStatus, newStatus, request.principal.id]
            );
          }
          if (historyChanges.length > 0) {
            await writeActivityLog(connection, {
              actor: request.principal,
              action: "followup.updated",
              entityType: "follow_up",
              entityId: followupId,
              details: { changeTypes: historyChanges.map(([type]) => type) }
            });
          }
          return true;
        });
        if (updated === "terminal") {
          sendError(response, 409, "FOLLOWUP_TERMINAL", "Completed or cancelled follow-ups cannot be changed.");
          return;
        }
        if (updated === "invalid_followup") {
          sendError(response, 400, "INVALID_FOLLOWUP", "Follow-up update fields are invalid.");
          return;
        }
        if (updated === "forbidden_cancel") {
          sendError(response, 403, "FORBIDDEN", "You cannot cancel follow-ups.");
          return;
        }
        if (updated === "forbidden_reassign") {
          sendError(response, 403, "FORBIDDEN", "Staff cannot reassign follow-ups.");
          return;
        }
        if (updated === "invalid_due_at") {
          sendError(response, 400, "INVALID_FOLLOWUP", "Due date is invalid.");
          return;
        }
        if (updated === "invalid_status") {
          sendError(response, 400, "INVALID_FOLLOWUP_STATUS", "Follow-up status is invalid.");
          return;
        }
        if (updated === "invalid_staff_assignment") {
          sendError(response, 400, "INVALID_STAFF_ASSIGNMENT", "Follow-ups must remain assigned to active staff.");
          return;
        }
        if (updated === null) {
          sendError(response, 400, "INVALID_STAFF_ASSIGNMENT", "The selected staff member is not active.");
          return;
        }
        if (!updated) {
          sendError(response, 404, "FOLLOWUP_NOT_FOUND", "Follow-up not found.");
          return;
        }
        response.status(200).json({ data: { id: followupId } });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
