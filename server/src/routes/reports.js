import { Router } from "express";
import { getDatabasePool } from "../database/pool.js";
import { createRequirePrincipal, requireAnyPermission, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

function sendError(response, status, code, message) {
  response.status(status).json({ error: { code, message } });
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

export function createReportsRouter({
  getPool = getDatabasePool,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal
} = {}) {
  const router = Router();
  router.use(
    "/crm",
    verifyToken,
    createRequirePrincipal({ getPool, principalResolver })
  );

  router.get(
    "/crm/dashboard",
    requireAnyPermission("reports.read"),
    async (_request, response, next) => {
      try {
        const pool = getPool();
        const [
          [customerRows],
          [enquiryRows],
          [followupRows],
          [salesRows],
          [bikeRows]
        ] = await Promise.all([
          pool.execute(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(status = 'new'), 0) AS new_count,
                    COALESCE(SUM(status = 'purchased'), 0) AS purchased_count
             FROM customers WHERE is_archived = FALSE`
          ),
          pool.execute(
            `SELECT status, COUNT(*) AS total
             FROM enquiries GROUP BY status`
          ),
          pool.execute(
            `SELECT COUNT(*) AS pending_count,
                    COALESCE(SUM(due_at < UTC_TIMESTAMP(6)), 0) AS overdue_count
             FROM follow_ups WHERE status = 'pending'`
          ),
          pool.execute(
            `SELECT COUNT(*) AS sales_count,
                    COALESCE(SUM(subtotal), 0) AS subtotal,
                    COALESCE(SUM(discount_amount), 0) AS discounts,
                    COALESCE(SUM(total_amount), 0) AS total
             FROM sales
             WHERE record_type = 'new_showroom' AND is_archived = FALSE
               AND sale_date >= UTC_DATE()`
          ),
          pool.execute(
            `SELECT status, COUNT(*) AS total
             FROM bikes GROUP BY status`
          )
        ]);
        response.status(200).json({
          data: {
            customers: {
              total: Number(customerRows[0].total),
              new: Number(customerRows[0].new_count),
              purchased: Number(customerRows[0].purchased_count)
            },
            enquiries: Object.fromEntries(enquiryRows.map((row) => [row.status, Number(row.total)])),
            followUps: {
              pending: Number(followupRows[0].pending_count),
              overdue: Number(followupRows[0].overdue_count)
            },
            todaySales: {
              count: Number(salesRows[0].sales_count),
              currency: "INR",
              subtotal: String(salesRows[0].subtotal),
              discounts: String(salesRows[0].discounts),
              total: String(salesRows[0].total)
            },
            bikes: Object.fromEntries(bikeRows.map((row) => [row.status, Number(row.total)]))
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/crm/activity-logs",
    requireAnyPermission("activity_logs.read"),
    async (request, response, next) => {
      const pagination = parsePagination(request.query);
      if (!pagination) {
        sendError(response, 400, "INVALID_PAGINATION", "Page and pageSize are invalid.");
        return;
      }
      const filters = [];
      const parameters = [];
      for (const [field, column, maxLength] of [
        ["action", "action", 100],
        ["entityType", "entity_type", 64],
        ["entityId", "entity_id", 128]
      ]) {
        const value = request.query[field];
        if (value === undefined) continue;
        if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
          sendError(response, 400, "INVALID_ACTIVITY_FILTER", "Activity filter is invalid.");
          return;
        }
        filters.push(`${column} = ?`);
        parameters.push(value);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      try {
        const pool = getPool();
        const [[countRows], [rows]] = await Promise.all([
          pool.execute(`SELECT COUNT(*) AS total FROM activity_logs ${where}`, parameters),
          pool.execute(
            `SELECT id, actor_user_id, actor_role_code, action, entity_type, entity_id, created_at
             FROM activity_logs ${where}
             ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
            [...parameters, pagination.pageSize, pagination.offset]
          )
        ]);
        response.status(200).json({
          data: {
            activityLogs: rows.map((row) => ({
              id: String(row.id),
              actorUserId: row.actor_user_id === null ? null : String(row.actor_user_id),
              actorRole: row.actor_role_code,
              action: row.action,
              entityType: row.entity_type,
              entityId: row.entity_id,
              createdAt: row.created_at
            })),
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

  return router;
}
