import { Router } from "express";
import { writeActivityLog } from "../database/activityLog.js";
import { withDatabaseTransaction, getDatabasePool } from "../database/pool.js";
import { createRequirePrincipal, requireAnyPermission, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

const CUSTOMER_SOURCES = new Set(["showroom", "website", "website_enquiry", "imported"]);
const CUSTOMER_STATUSES = new Set(["new", "active", "not_interested", "purchased"]);
const INTEREST_STATUSES = new Set([
  "Very Interested",
  "Interested",
  "Need More Time",
  "Not Interested",
  "Already Purchased"
]);
const CALL_STATUSES = new Set([
  "Answered",
  "Not Answered",
  "Switched Off",
  "Busy",
  "Wrong Number"
]);
const CUSTOMER_COLUMNS = Object.freeze({
  name: "name",
  email: "email",
  customerType: "customer_type",
  source: "source",
  status: "status",
  interestStatus: "interest_status",
  callStatus: "call_status",
  interestedBike: "interested_bike"
});
const CUSTOMER_SELECT = `SELECT c.id, c.name, c.email, c.customer_type, c.source,
                                c.status, c.interest_status, c.call_status,
                                c.interested_bike, c.assigned_staff_user_id,
                                c.created_at, c.updated_at
                         FROM customers AS c`;

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

function validEmail(value) {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateCustomerBody(body, { creating = false, canAssign = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const allowed = new Set([
    ...Object.keys(CUSTOMER_COLUMNS),
    ...(canAssign ? ["assignedStaffUserId"] : [])
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;

  const fields = {};
  if (creating) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) return null;
    fields.name = body.name.trim();
  }

  for (const [key, column] of Object.entries(CUSTOMER_COLUMNS)) {
    if (!Object.hasOwn(body, key) || (creating && key === "name")) continue;
    const value = body[key];
    if (key === "email") {
      if (value !== null && value !== "" && !validEmail(value)) return null;
      fields[column] = value === "" ? null : value;
      continue;
    }
    if (key === "name") {
      if (typeof value !== "string" || !value.trim() || value.trim().length > 100) return null;
      fields[column] = value.trim();
      continue;
    }
    const maxLength = key === "interestedBike" ? 100 : null;
    if (maxLength !== null && value !== null &&
      (typeof value !== "string" || value.length > maxLength)) return null;
    if (key === "customerType" && value !== null && !["new", "existing"].includes(value)) return null;
    if (key === "source" && value !== null && !CUSTOMER_SOURCES.has(value)) return null;
    if (key === "status" && value !== null && !CUSTOMER_STATUSES.has(value)) return null;
    if (key === "interestStatus" && value !== null && !INTEREST_STATUSES.has(value)) return null;
    if (key === "callStatus" && value !== null && !CALL_STATUSES.has(value)) return null;
    if (
      ["customerType", "source", "status", "interestStatus", "callStatus"].includes(key) &&
      value !== null && typeof value !== "string"
    ) return null;
    fields[column] = value;
  }

  if (!creating && Object.keys(fields).length === 0 &&
    !(canAssign && Object.hasOwn(body, "assignedStaffUserId"))) return null;

  if (Object.hasOwn(body, "assignedStaffUserId")) {
    if (!canAssign) return null;
    const assignedId = body.assignedStaffUserId;
    if (assignedId !== null && parseId(String(assignedId)) === null) return null;
    fields.assigned_staff_user_id = assignedId === null ? null : String(assignedId);
  }

  return fields;
}

function customerDto(row) {
  return {
    id: String(row.id),
    name: row.name,
    email: row.email,
    customerType: row.customer_type,
    source: row.source,
    status: row.status,
    interestStatus: row.interest_status,
    callStatus: row.call_status,
    interestedBike: row.interested_bike,
    assignedStaffUserId: row.assigned_staff_user_id === null
      ? null
      : String(row.assigned_staff_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function staffScope(principal) {
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

export function createCustomerRouter({
  getPool = getDatabasePool,
  withTransaction = withDatabaseTransaction,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal
} = {}) {
  const router = Router();
  const authenticate = verifyToken;
  const requirePrincipal = createRequirePrincipal({ getPool, principalResolver });

  router.use("/crm/customers", authenticate, requirePrincipal);

  router.get(
    "/crm/customers",
    requireAnyPermission("crm.customers.read.assigned", "crm.customers.read.all"),
    async (request, response, next) => {
      const pagination = parsePagination(request.query);
      if (!pagination) {
        sendError(response, 400, "INVALID_PAGINATION", "Page and pageSize are invalid.");
        return;
      }
      const search = request.query.search;
      if (search !== undefined &&
        (typeof search !== "string" || search.trim().length > 100)) {
        sendError(response, 400, "INVALID_SEARCH", "Search must be 100 characters or fewer.");
        return;
      }

      const filters = ["c.is_archived = FALSE"];
      const parameters = [];
      if (staffScope(request.principal)) {
        filters.push("c.assigned_staff_user_id = ?");
        parameters.push(request.principal.id);
      }
      if (search?.trim()) {
        filters.push("(LOCATE(LOWER(?), LOWER(COALESCE(c.name, ''))) > 0 OR " +
          "LOCATE(LOWER(?), LOWER(COALESCE(c.email, ''))) > 0)");
        parameters.push(search.trim(), search.trim());
      }
      const where = filters.join(" AND ");

      try {
        const pool = getPool();
        const [[countRows], [customerRows]] = await Promise.all([
          pool.execute(`SELECT COUNT(*) AS total FROM customers AS c WHERE ${where}`, parameters),
          pool.execute(
            `${CUSTOMER_SELECT}
             WHERE ${where}
             ORDER BY c.created_at DESC, c.id DESC
             LIMIT ? OFFSET ?`,
            [...parameters, pagination.pageSize, pagination.offset]
          )
        ]);
        response.status(200).json({
          data: {
            customers: customerRows.map(customerDto),
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
    "/crm/customers",
    requireAnyPermission("crm.customers.create"),
    async (request, response, next) => {
      const canAssign = request.principal.permissions.includes("crm.customers.assign");
      const fields = validateCustomerBody(request.body, { creating: true, canAssign });
      if (!fields) {
        sendError(response, 400, "INVALID_CUSTOMER", "Customer fields are invalid or not allowed.");
        return;
      }
      if (request.principal.role === "staff") {
        fields.assigned_staff_user_id = String(request.principal.id);
      } else if (!Object.hasOwn(fields, "assigned_staff_user_id")) {
        fields.assigned_staff_user_id = null;
      }
      if (!Object.hasOwn(fields, "customer_type")) fields.customer_type = "new";
      if (!Object.hasOwn(fields, "source")) fields.source = "showroom";
      if (!Object.hasOwn(fields, "status")) fields.status = "new";

      try {
        const result = await withTransaction(async (connection) => {
          if (
            fields.assigned_staff_user_id !== null &&
            !await assertActiveStaff(connection, fields.assigned_staff_user_id)
          ) return null;

          const fieldEntries = Object.entries(fields);
          const columns = [
            "search_name",
            ...fieldEntries.map(([column]) => column),
            "created_at",
            "updated_at"
          ];
          const values = [
            fields.name.toLocaleLowerCase("en-IN"),
            ...fieldEntries.map(([, value]) => value)
          ];
          const placeholders = [
            ...values.map(() => "?"),
            "UTC_TIMESTAMP(6)",
            "UTC_TIMESTAMP(6)"
          ].join(", ");
          const [insert] = await connection.execute(
            `INSERT INTO customers (${columns.join(", ")})
             VALUES (${placeholders})`,
            values
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "customer.created",
            entityType: "customer",
            entityId: insert.insertId,
            details: { source: fields.source }
          });
          return insert.insertId;
        });
        if (result === null) {
          sendError(response, 400, "INVALID_STAFF_ASSIGNMENT", "The selected staff member is not active.");
          return;
        }
        response.status(201).json({ data: { id: String(result) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/crm/customers/:customerId",
    requireAnyPermission("crm.customers.read.assigned", "crm.customers.read.all"),
    async (request, response, next) => {
      const customerId = parseId(request.params.customerId);
      if (!customerId) {
        sendError(response, 400, "INVALID_CUSTOMER_ID", "Customer ID is invalid.");
        return;
      }
      const parameters = [customerId];
      let scope = "";
      if (staffScope(request.principal)) {
        scope = " AND c.assigned_staff_user_id = ?";
        parameters.push(request.principal.id);
      }

      try {
        const [rows] = await getPool().execute(
          `${CUSTOMER_SELECT}
           WHERE c.id = ? AND c.is_archived = FALSE${scope}
           LIMIT 1`,
          parameters
        );
        if (!rows[0]) {
          sendError(response, 404, "CUSTOMER_NOT_FOUND", "Customer not found.");
          return;
        }
        response.status(200).json({ data: { customer: customerDto(rows[0]) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/crm/customers/:customerId",
    requireAnyPermission("crm.customers.update.assigned", "crm.customers.update.all"),
    async (request, response, next) => {
      const customerId = parseId(request.params.customerId);
      if (!customerId) {
        sendError(response, 400, "INVALID_CUSTOMER_ID", "Customer ID is invalid.");
        return;
      }
      const canAssign = request.principal.permissions.includes("crm.customers.assign");
      if (request.principal.role === "staff" &&
        Object.hasOwn(request.body ?? {}, "assignedStaffUserId")) {
        sendError(response, 403, "FORBIDDEN", "Staff cannot reassign customers.");
        return;
      }
      const fields = validateCustomerBody(request.body, { canAssign });
      if (!fields) {
        sendError(response, 400, "INVALID_CUSTOMER", "Customer fields are invalid or not allowed.");
        return;
      }

      const assignments = Object.entries(fields);
      if (Object.hasOwn(fields, "name")) {
        assignments.push(["search_name", fields.name.toLocaleLowerCase("en-IN")]);
      }
      const finalSetClause = assignments.map(([column]) => `${column} = ?`).join(", ");
      const finalValues = assignments.map(([, value]) => value);

      try {
        const updated = await withTransaction(async (connection) => {
          const staffScopeSql = staffScope(request.principal)
            ? " AND assigned_staff_user_id = ?"
            : "";
          const selectParameters = staffScope(request.principal)
            ? [customerId, request.principal.id]
            : [customerId];
          const [existing] = await connection.execute(
            `SELECT id FROM customers
             WHERE id = ? AND is_archived = FALSE${staffScopeSql}
             FOR UPDATE`,
            selectParameters
          );
          if (!existing[0]) return false;
          if (
            Object.hasOwn(fields, "assigned_staff_user_id") &&
            fields.assigned_staff_user_id !== null &&
            !await assertActiveStaff(connection, fields.assigned_staff_user_id)
          ) return null;

          await connection.execute(
            `UPDATE customers SET ${finalSetClause}, updated_at = UTC_TIMESTAMP(6)
             WHERE id = ? AND is_archived = FALSE`,
            [...finalValues, customerId]
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "customer.updated",
            entityType: "customer",
            entityId: customerId,
            details: {
              updatedFields: Object.keys(fields),
              assignmentChanged: Object.hasOwn(fields, "assigned_staff_user_id")
            }
          });
          return true;
        });
        if (updated === null) {
          sendError(response, 400, "INVALID_STAFF_ASSIGNMENT", "The selected staff member is not active.");
          return;
        }
        if (!updated) {
          sendError(response, 404, "CUSTOMER_NOT_FOUND", "Customer not found.");
          return;
        }
        response.status(200).json({ data: { id: customerId } });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
