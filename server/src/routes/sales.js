import { Router } from "express";
import { writeActivityLog } from "../database/activityLog.js";
import { getDatabasePool, withDatabaseTransaction } from "../database/pool.js";
import { createRequirePrincipal, requireAnyPermission, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

const SALE_STATUSES = Object.freeze({
  purchaseStatus: new Set(["completed", "pending_delivery"]),
  paymentStatus: new Set(["unpaid", "partial", "paid"]),
  deliveryStatus: new Set(["pending", "ready", "delivered"])
});
const MAX_SALE_CENTS = 99999999999999n;

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

function parseMoney(value, maxWholeDigits) {
  const text = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : value;
  if (
    typeof text !== "string" ||
    !new RegExp(`^\\d{1,${maxWholeDigits}}(?:\\.\\d{1,2})?$`).test(text)
  ) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function formatMoney(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function parseUtcDate(value) {
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

function validateSaleBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const allowed = new Set([
    "requestId",
    "customerId",
    "saleDate",
    "discountAmount",
    "items",
    "purchaseStatus",
    "paymentStatus",
    "deliveryStatus"
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  if (
    typeof body.requestId !== "string" ||
    body.requestId.length < 16 || body.requestId.length > 64 ||
    !/^[A-Za-z0-9-]+$/.test(body.requestId)
  ) return null;
  const customerId = parseId(String(body.customerId ?? ""));
  if (!customerId) return null;
  const saleDate = body.saleDate === undefined ? null : parseUtcDate(body.saleDate);
  if (body.saleDate !== undefined && !saleDate) return null;
  const discountCents = body.discountAmount === undefined
    ? 0n
    : parseMoney(body.discountAmount, 12);
  if (discountCents === null || discountCents > MAX_SALE_CENTS) return null;
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) return null;

  const items = [];
  let subtotalCents = 0n;
  for (const item of body.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const itemAllowed = new Set([
      "bikeId",
      "productNameSnapshot",
      "modelSnapshot",
      "batteryType",
      "warrantyDetails",
      "quantity",
      "unitPrice"
    ]);
    if (Object.keys(item).some((key) => !itemAllowed.has(key))) return null;
    const bikeId = item.bikeId === undefined || item.bikeId === null
      ? null
      : parseId(String(item.bikeId));
    if (item.bikeId != null && !bikeId) return null;
    if (bikeId !== null && (item.productNameSnapshot !== undefined ||
      item.modelSnapshot !== undefined)) return null;
    if (bikeId === null &&
      (typeof item.productNameSnapshot !== "string" ||
        !item.productNameSnapshot.trim() || item.productNameSnapshot.trim().length > 150)) return null;
    if (item.modelSnapshot !== undefined && item.modelSnapshot !== null &&
      (typeof item.modelSnapshot !== "string" || item.modelSnapshot.length > 150)) return null;
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 4294967295) return null;
    const unitPriceCents = parseMoney(item.unitPrice, 10);
    if (unitPriceCents === null || unitPriceCents < 1n) return null;
    const lineTotalCents = unitPriceCents * BigInt(item.quantity);
    if (lineTotalCents > MAX_SALE_CENTS) return null;
    subtotalCents += lineTotalCents;
    if (subtotalCents > MAX_SALE_CENTS) return null;
    if (item.batteryType !== undefined && item.batteryType !== null &&
      !["Lithium", "Lead Acid", "Other", "Not Applicable"].includes(item.batteryType)) return null;
    if (item.warrantyDetails !== undefined && item.warrantyDetails !== null &&
      (typeof item.warrantyDetails !== "string" || item.warrantyDetails.length > 1000)) return null;
    items.push({
      bikeId,
      productNameSnapshot: item.productNameSnapshot?.trim() ?? null,
      modelSnapshot: item.modelSnapshot ?? null,
      batteryType: item.batteryType ?? null,
      warrantyDetails: item.warrantyDetails ?? null,
      quantity: item.quantity,
      unitPrice: formatMoney(unitPriceCents),
      lineTotal: formatMoney(lineTotalCents)
    });
  }
  if (discountCents > subtotalCents) return null;
  for (const [field, values] of Object.entries(SALE_STATUSES)) {
    if (body[field] !== undefined && body[field] !== null && !values.has(body[field])) return null;
  }
  return {
    requestId: body.requestId,
    customerId,
    saleDate,
    discountAmount: formatMoney(discountCents),
    subtotal: formatMoney(subtotalCents),
    totalAmount: formatMoney(subtotalCents - discountCents),
    items,
    purchaseStatus: body.purchaseStatus ?? null,
    paymentStatus: body.paymentStatus ?? null,
    deliveryStatus: body.deliveryStatus ?? null
  };
}

function saleDto(row) {
  return {
    id: String(row.id),
    customerId: row.customer_id === null ? null : String(row.customer_id),
    customerName: row.customer_name_snapshot,
    recordedByUserId: row.recorded_by_user_id === null
      ? null
      : String(row.recorded_by_user_id),
    saleDate: row.sale_date,
    currency: row.currency,
    subtotal: row.subtotal === null ? null : String(row.subtotal),
    discountAmount: row.discount_amount === null ? null : String(row.discount_amount),
    totalAmount: row.total_amount === null ? null : String(row.total_amount),
    purchaseStatus: row.purchase_status,
    paymentStatus: row.payment_status,
    deliveryStatus: row.delivery_status,
    createdAt: row.created_at,
    items: row.items
  };
}

const SALE_SELECT = `SELECT s.id, s.customer_id, s.customer_name_snapshot,
                            s.recorded_by_user_id, s.sale_date, s.currency,
                            s.subtotal, s.discount_amount, s.total_amount,
                            s.purchase_status, s.payment_status, s.delivery_status,
                            s.created_at
                     FROM sales AS s
                     LEFT JOIN customers AS c ON c.id = s.customer_id`;

async function loadSaleItems(pool, saleId) {
  const [rows] = await pool.execute(
    `SELECT id, bike_id, product_name_snapshot, model_snapshot, battery_type,
            warranty_details, quantity, unit_price, line_total
     FROM sale_items
     WHERE sale_id = ? AND sale_record_type = 'new_showroom'
     ORDER BY id`,
    [saleId]
  );
  return rows.map((row) => ({
    id: String(row.id),
    bikeId: row.bike_id === null ? null : String(row.bike_id),
    productName: row.product_name_snapshot,
    model: row.model_snapshot,
    batteryType: row.battery_type,
    warrantyDetails: row.warranty_details,
    quantity: row.quantity,
    unitPrice: String(row.unit_price),
    lineTotal: String(row.line_total)
  }));
}

export function createSalesRouter({
  getPool = getDatabasePool,
  withTransaction = withDatabaseTransaction,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal
} = {}) {
  const router = Router();
  router.use(
    "/crm/sales",
    verifyToken,
    createRequirePrincipal({ getPool, principalResolver })
  );

  router.post(
    "/crm/sales",
    requireAnyPermission("crm.sales.create"),
    async (request, response, next) => {
      const sale = validateSaleBody(request.body);
      if (!sale) {
        sendError(response, 400, "INVALID_SALE", "Sale details are invalid.");
        return;
      }

      try {
        const result = await withTransaction(async (connection) => {
          const [existing] = await connection.execute(
            `SELECT sr.sale_id, s.subtotal, s.discount_amount, s.total_amount
             FROM sale_requests AS sr
             JOIN sales AS s ON s.id = sr.sale_id
             WHERE sr.requesting_firebase_uid = ? AND sr.request_id = ?
             FOR UPDATE`,
            [request.auth.uid, sale.requestId]
          );
          if (existing[0]) {
            return {
              id: existing[0].sale_id,
              subtotal: String(existing[0].subtotal),
              discountAmount: String(existing[0].discount_amount),
              totalAmount: String(existing[0].total_amount),
              idempotent: true
            };
          }

          const customerScope = request.principal.role === "staff"
            ? " AND assigned_staff_user_id = ?"
            : "";
          const customerParameters = request.principal.role === "staff"
            ? [sale.customerId, request.principal.id]
            : [sale.customerId];
          const [customers] = await connection.execute(
            `SELECT id, name FROM customers
             WHERE id = ? AND is_archived = FALSE${customerScope}
             FOR UPDATE`,
            customerParameters
          );
          const customer = customers[0];
          if (!customer) return false;

          const itemSnapshots = [];
          for (const item of sale.items) {
            if (item.bikeId === null) {
              itemSnapshots.push(item);
              continue;
            }
            const [bikes] = await connection.execute(
              `SELECT name, model FROM bikes
               WHERE id = ? AND status = 'published'
               FOR UPDATE`,
              [item.bikeId]
            );
            if (!bikes[0]) return "bike";
            itemSnapshots.push({
              ...item,
              productNameSnapshot: bikes[0].name,
              modelSnapshot: bikes[0].model
            });
          }

          const saleDateSql = sale.saleDate === null ? "UTC_TIMESTAMP(6)" : "?";
          const saleValues = [
            sale.customerId,
            customer.name,
            request.principal.id,
            ...(sale.saleDate === null ? [] : [sale.saleDate]),
            "INR",
            sale.subtotal,
            sale.discountAmount,
            sale.totalAmount,
            sale.purchaseStatus,
            sale.paymentStatus,
            sale.deliveryStatus
          ];
          const [insert] = await connection.execute(
            `INSERT INTO sales (
               record_type, customer_id, customer_name_snapshot, recorded_by_user_id,
               sale_date, currency, subtotal, discount_amount, total_amount,
               purchase_status, payment_status, delivery_status, created_at, updated_at
             ) VALUES (
               'new_showroom', ?, ?, ?, ${saleDateSql}, ?, ?, ?, ?, ?, ?, ?,
               UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
             )`,
            saleValues
          );

          for (const item of itemSnapshots) {
            await connection.execute(
              `INSERT INTO sale_items (
                 sale_id, sale_record_type, bike_id, product_name_snapshot, model_snapshot,
                 battery_type, warranty_details, quantity, unit_price, line_total, created_at
               ) VALUES (
                 ?, 'new_showroom', ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6)
               )`,
              [
                insert.insertId,
                item.bikeId,
                item.productNameSnapshot,
                item.modelSnapshot,
                item.batteryType,
                item.warrantyDetails,
                item.quantity,
                item.unitPrice,
                item.lineTotal
              ]
            );
          }
          await connection.execute(
            `INSERT INTO sale_history (sale_id, action, actor_user_id, change_summary, created_at)
             VALUES (?, 'created', ?, CAST(? AS JSON), UTC_TIMESTAMP(6))`,
            [
              insert.insertId,
              request.principal.id,
              JSON.stringify({ itemCount: itemSnapshots.length, currency: "INR" })
            ]
          );
          await connection.execute(
            `INSERT INTO sale_requests (
               requesting_user_id, requesting_firebase_uid, request_id, sale_id, created_at
             ) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))`,
            [request.principal.id, request.auth.uid, sale.requestId, insert.insertId]
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "sale.created",
            entityType: "sale",
            entityId: insert.insertId,
            details: { itemCount: itemSnapshots.length, currency: "INR" }
          });
          return {
            id: insert.insertId,
            subtotal: sale.subtotal,
            discountAmount: sale.discountAmount,
            totalAmount: sale.totalAmount,
            idempotent: false
          };
        });
        if (result === false) {
          sendError(response, 404, "CUSTOMER_NOT_FOUND", "Customer not found in your permitted scope.");
          return;
        }
        if (result === "bike") {
          sendError(response, 400, "INVALID_BIKE", "A sale item must reference a published bike.");
          return;
        }
        response.status(result.idempotent ? 200 : 201).json({
          data: {
            id: String(result.id),
            currency: "INR",
            subtotal: result.subtotal,
            discountAmount: result.discountAmount,
            totalAmount: result.totalAmount,
            idempotent: result.idempotent
          }
        });
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
          try {
            const [rows] = await getPool().execute(
              `SELECT sr.sale_id, s.subtotal, s.discount_amount, s.total_amount
               FROM sale_requests AS sr
               JOIN sales AS s ON s.id = sr.sale_id
               WHERE sr.requesting_firebase_uid = ? AND sr.request_id = ?`,
              [request.auth.uid, sale.requestId]
            );
            if (rows[0]) {
              response.status(200).json({
                data: {
                  id: String(rows[0].sale_id),
                  currency: "INR",
                  subtotal: String(rows[0].subtotal),
                  discountAmount: String(rows[0].discount_amount),
                  totalAmount: String(rows[0].total_amount),
                  idempotent: true
                }
              });
              return;
            }
          } catch (lookupError) {
            next(lookupError);
            return;
          }
        }
        next(error);
      }
    }
  );

  router.get(
    "/crm/sales",
    requireAnyPermission("crm.sales.read.assigned", "crm.sales.read.all"),
    async (request, response, next) => {
      const pagination = parsePagination(request.query);
      if (!pagination) {
        sendError(response, 400, "INVALID_PAGINATION", "Page and pageSize are invalid.");
        return;
      }
      const filters = ["s.record_type = 'new_showroom'", "s.is_archived = FALSE"];
      const parameters = [];
      if (request.principal.role === "staff") {
        filters.push("(s.recorded_by_user_id = ? OR c.assigned_staff_user_id = ?)");
        parameters.push(request.principal.id, request.principal.id);
      }
      const where = filters.join(" AND ");
      try {
        const pool = getPool();
        const [[countRows], [rows]] = await Promise.all([
          pool.execute(
            `SELECT COUNT(*) AS total FROM sales AS s
             LEFT JOIN customers AS c ON c.id = s.customer_id WHERE ${where}`,
            parameters
          ),
          pool.execute(
            `${SALE_SELECT} WHERE ${where}
             ORDER BY s.sale_date DESC, s.id DESC LIMIT ? OFFSET ?`,
            [...parameters, pagination.pageSize, pagination.offset]
          )
        ]);
        response.status(200).json({
          data: {
            sales: rows.map((row) => saleDto(row)),
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
    "/crm/sales/:saleId",
    requireAnyPermission("crm.sales.read.assigned", "crm.sales.read.all"),
    async (request, response, next) => {
      const saleId = parseId(request.params.saleId);
      if (!saleId) {
        sendError(response, 400, "INVALID_SALE_ID", "Sale ID is invalid.");
        return;
      }
      const filters = [
        "s.id = ?",
        "s.record_type = 'new_showroom'",
        "s.is_archived = FALSE"
      ];
      const parameters = [saleId];
      if (request.principal.role === "staff") {
        filters.push("(s.recorded_by_user_id = ? OR c.assigned_staff_user_id = ?)");
        parameters.push(request.principal.id, request.principal.id);
      }
      try {
        const pool = getPool();
        const [rows] = await pool.execute(
          `${SALE_SELECT} WHERE ${filters.join(" AND ")} LIMIT 1`,
          parameters
        );
        if (!rows[0]) {
          sendError(response, 404, "SALE_NOT_FOUND", "Sale not found.");
          return;
        }
        rows[0].items = await loadSaleItems(pool, saleId);
        response.status(200).json({ data: { sale: saleDto(rows[0]) } });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
