import { Router } from "express";
import { writeActivityLog } from "../database/activityLog.js";
import { getDatabasePool, withDatabaseTransaction } from "../database/pool.js";
import { createRequirePrincipal, requireAnyPermission, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

const BIKE_STATUSES = new Set(["draft", "published", "archived"]);
const BIKE_FIELDS = Object.freeze({
  name: "name",
  model: "model",
  brandId: "brand_id",
  categoryId: "category_id",
  price: "price",
  shortDescription: "short_description",
  description: "description",
  stockQuantity: "stock_quantity",
  status: "status"
});

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

function parsePage(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 25 : Number(query.pageSize);
  if (
    !Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
    !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
  ) return null;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function validSlug(value) {
  return typeof value === "string" &&
    value.length <= 120 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function validateTaxonomyBody(body, { category = false, patch = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const allowed = category
    ? new Set(["name", "slug", "description", "isActive"])
    : new Set(["name", "slug", "isActive"]);
  if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowed.has(key))) return null;

  const fields = {};
  if (Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100) return null;
    fields.name = body.name.trim();
  } else if (!patch) return null;
  if (Object.hasOwn(body, "slug")) {
    if (!validSlug(body.slug)) return null;
    fields.slug = body.slug;
  } else if (!patch) return null;
  if (Object.hasOwn(body, "description")) {
    if (body.description !== null &&
      (typeof body.description !== "string" || body.description.length > 20000)) return null;
    fields.description = body.description;
  }
  if (Object.hasOwn(body, "isActive")) {
    if (typeof body.isActive !== "boolean") return null;
    fields.is_active = body.isActive;
  }
  return fields;
}

function validateBikeBody(body, { patch = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Object.keys(body).length === 0 ||
    Object.keys(body).some((key) => !Object.hasOwn(BIKE_FIELDS, key))) return null;
  const fields = {};

  if (Object.hasOwn(body, "name")) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 150) return null;
    fields.name = body.name.trim();
  } else if (!patch) return null;
  if (Object.hasOwn(body, "model")) {
    if (body.model !== null &&
      (typeof body.model !== "string" || !body.model.trim() || body.model.trim().length > 150)) return null;
    fields.model = body.model?.trim() || null;
  }
  for (const key of ["brandId", "categoryId"]) {
    if (!Object.hasOwn(body, key)) continue;
    if (body[key] !== null && parseId(String(body[key])) === null) return null;
    fields[BIKE_FIELDS[key]] = body[key] === null ? null : String(body[key]);
  }
  if (Object.hasOwn(body, "price")) {
    const price = typeof body.price === "number" ? String(body.price) : body.price;
    if (typeof price !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(price)) return null;
    fields.price = price;
  }
  if (Object.hasOwn(body, "shortDescription")) {
    if (body.shortDescription !== null &&
      (typeof body.shortDescription !== "string" || body.shortDescription.length > 500)) return null;
    fields.short_description = body.shortDescription;
  }
  if (Object.hasOwn(body, "description")) {
    if (body.description !== null &&
      (typeof body.description !== "string" || body.description.length > 20000)) return null;
    fields.description = body.description;
  }
  if (Object.hasOwn(body, "stockQuantity")) {
    if (!Number.isInteger(body.stockQuantity) || body.stockQuantity < 0 ||
      body.stockQuantity > 4294967295) return null;
    fields.stock_quantity = body.stockQuantity;
  }
  if (Object.hasOwn(body, "status")) {
    if (!BIKE_STATUSES.has(body.status)) return null;
    fields.status = body.status;
  } else if (!patch) {
    fields.status = "draft";
  }
  return fields;
}

function bikeDto(row) {
  return {
    id: String(row.id),
    name: row.name,
    model: row.model,
    brand: row.brand_name,
    brandSlug: row.brand_slug,
    category: row.category_name,
    categorySlug: row.category_slug,
    price: row.price === null ? null : String(row.price),
    shortDescription: row.short_description,
    description: row.description,
    stockQuantity: row.stock_quantity,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const BIKE_SELECT = `SELECT b.id, b.name, b.model, b.price, b.short_description,
                            b.description, b.stock_quantity, b.status, b.created_at,
                            b.updated_at, br.name AS brand_name, br.slug AS brand_slug,
                            bc.name AS category_name, bc.slug AS category_slug
                     FROM bikes AS b
                     LEFT JOIN bike_brands AS br ON br.id = b.brand_id
                     LEFT JOIN bike_categories AS bc ON bc.id = b.category_id`;

function createTaxonomyRoutes(router, { table, path, category, getPool, withTransaction }) {
  const publicFilter = "is_active = TRUE";
  router.get(path, async (_request, response, next) => {
    try {
      const [rows] = await getPool().execute(
        `SELECT id, name, slug${category ? ", description" : ""}
         FROM ${table} WHERE ${publicFilter} ORDER BY name, id`
      );
      response.status(200).json({ data: { [category ? "categories" : "brands"]: rows } });
    } catch (error) {
      next(error);
    }
  });

  const crmPath = `/crm${path}`;
  router.get(crmPath, requireAnyPermission("catalog.manage"), async (_request, response, next) => {
    try {
      const [rows] = await getPool().execute(
        `SELECT id, name, slug, is_active${category ? ", description" : ""}
         FROM ${table} ORDER BY name, id`
      );
      response.status(200).json({ data: { [category ? "categories" : "brands"]: rows } });
    } catch (error) {
      next(error);
    }
  });

  router.post(crmPath, requireAnyPermission("catalog.manage"), async (request, response, next) => {
    const fields = validateTaxonomyBody(request.body, { category });
    if (!fields) {
      sendError(response, 400, "INVALID_CATALOG_ENTRY", "Catalogue fields are invalid.");
      return;
    }
    try {
      const id = await withTransaction(async (connection) => {
        const columns = [...Object.keys(fields), "created_at", "updated_at"];
        const fieldValues = Object.keys(fields).map((column) => fields[column]);
        const [result] = await connection.execute(
          `INSERT INTO ${table} (${columns.join(", ")})
           VALUES (${[
             ...fieldValues.map(() => "?"),
             "UTC_TIMESTAMP(6)",
             "UTC_TIMESTAMP(6)"
           ].join(", ")})`,
          fieldValues
        );
        await writeActivityLog(connection, {
          actor: request.principal,
          action: "catalog.taxonomy.created",
          entityType: category ? "bike_category" : "bike_brand",
          entityId: result.insertId,
          details: { fields: Object.keys(fields) }
        });
        return result.insertId;
      });
      response.status(201).json({ data: { id: String(id) } });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        sendError(response, 409, "CATALOG_CONFLICT", "The name or slug is already in use.");
        return;
      }
      next(error);
    }
  });

  router.patch(
    `${crmPath}/:entryId`,
    requireAnyPermission("catalog.manage"),
    async (request, response, next) => {
      const entryId = parseId(request.params.entryId);
      const fields = validateTaxonomyBody(request.body, { category, patch: true });
      if (!entryId) {
        sendError(response, 400, "INVALID_CATALOG_ID", "Catalogue ID is invalid.");
        return;
      }
      if (!fields) {
        sendError(response, 400, "INVALID_CATALOG_ENTRY", "Catalogue fields are invalid.");
        return;
      }
      const columns = Object.keys(fields);
      try {
        const updated = await withTransaction(async (connection) => {
          const [existing] = await connection.execute(
            `SELECT id FROM ${table} WHERE id = ? FOR UPDATE`,
            [entryId]
          );
          if (!existing[0]) return false;
          await connection.execute(
            `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(", ")},
             updated_at = UTC_TIMESTAMP(6)
             WHERE id = ?`,
            [...columns.map((column) => fields[column]), entryId]
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "catalog.taxonomy.updated",
            entityType: category ? "bike_category" : "bike_brand",
            entityId: entryId,
            details: { fields: Object.keys(fields) }
          });
          return true;
        });
        if (!updated) {
          sendError(response, 404, "CATALOG_ENTRY_NOT_FOUND", "Catalogue entry not found.");
          return;
        }
        response.status(200).json({ data: { id: entryId } });
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
          sendError(response, 409, "CATALOG_CONFLICT", "The name or slug is already in use.");
          return;
        }
        next(error);
      }
    }
  );
}

export function createCatalogRouter({
  getPool = getDatabasePool,
  withTransaction = withDatabaseTransaction,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal
} = {}) {
  const router = Router();
  const requirePrincipal = createRequirePrincipal({ getPool, principalResolver });
  router.use("/crm/catalog", verifyToken, requirePrincipal);
  createTaxonomyRoutes(router, {
    table: "bike_brands",
    path: "/catalog/brands",
    category: false,
    getPool,
    withTransaction
  });
  createTaxonomyRoutes(router, {
    table: "bike_categories",
    path: "/catalog/categories",
    category: true,
    getPool,
    withTransaction
  });

  router.get("/catalog/bikes", async (request, response, next) => {
    const page = parsePage(request.query);
    if (!page) {
      sendError(response, 400, "INVALID_PAGINATION", "Page and pageSize are invalid.");
      return;
    }
    try {
      const filters = ["b.status = 'published'", "(br.id IS NULL OR br.is_active = TRUE)",
        "(bc.id IS NULL OR bc.is_active = TRUE)"];
      const parameters = [];
      if (request.query.brand !== undefined) {
        if (typeof request.query.brand !== "string" || !validSlug(request.query.brand)) {
          sendError(response, 400, "INVALID_BRAND", "Brand slug is invalid.");
          return;
        }
        filters.push("br.slug = ?");
        parameters.push(request.query.brand);
      }
      if (request.query.category !== undefined) {
        if (typeof request.query.category !== "string" || !validSlug(request.query.category)) {
          sendError(response, 400, "INVALID_CATEGORY", "Category slug is invalid.");
          return;
        }
        filters.push("bc.slug = ?");
        parameters.push(request.query.category);
      }
      const where = filters.join(" AND ");
      const [[countRows], [rows]] = await Promise.all([
        getPool().execute(
          `SELECT COUNT(*) AS total
           FROM bikes AS b
           LEFT JOIN bike_brands AS br ON br.id = b.brand_id
           LEFT JOIN bike_categories AS bc ON bc.id = b.category_id
           WHERE ${where}`,
          parameters
        ),
        getPool().execute(
          `${BIKE_SELECT}
           WHERE ${where}
           ORDER BY b.name, b.id
           LIMIT ? OFFSET ?`,
          [...parameters, page.pageSize, page.offset]
        )
      ]);
      response.status(200).json({
        data: {
          bikes: rows.map(bikeDto),
          pagination: { page: page.page, pageSize: page.pageSize, total: Number(countRows[0].total) }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/catalog/bikes/:bikeId", async (request, response, next) => {
    const bikeId = parseId(request.params.bikeId);
    if (!bikeId) {
      sendError(response, 400, "INVALID_BIKE_ID", "Bike ID is invalid.");
      return;
    }
    try {
      const [rows] = await getPool().execute(
        `${BIKE_SELECT}
         WHERE b.id = ? AND b.status = 'published'
           AND (br.id IS NULL OR br.is_active = TRUE)
           AND (bc.id IS NULL OR bc.is_active = TRUE)
         LIMIT 1`,
        [bikeId]
      );
      if (!rows[0]) {
        sendError(response, 404, "BIKE_NOT_FOUND", "Bike not found.");
        return;
      }
      response.status(200).json({ data: { bike: bikeDto(rows[0]) } });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/crm/catalog/bikes",
    requireAnyPermission("catalog.manage"),
    async (_request, response, next) => {
      try {
        const [rows] = await getPool().execute(`${BIKE_SELECT} ORDER BY b.updated_at DESC, b.id DESC`);
        response.status(200).json({ data: { bikes: rows.map(bikeDto) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/crm/catalog/bikes",
    requireAnyPermission("catalog.manage"),
    async (request, response, next) => {
      const fields = validateBikeBody(request.body);
      if (!fields) {
        sendError(response, 400, "INVALID_BIKE", "Bike catalogue fields are invalid.");
        return;
      }
      try {
        const id = await withTransaction(async (connection) => {
          const columns = [...Object.keys(fields), "created_at", "updated_at"];
          const fieldValues = Object.keys(fields).map((column) => fields[column]);
          const [result] = await connection.execute(
            `INSERT INTO bikes (${columns.join(", ")})
             VALUES (${[
               ...fieldValues.map(() => "?"),
               "UTC_TIMESTAMP(6)",
               "UTC_TIMESTAMP(6)"
             ].join(", ")})`,
            fieldValues
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "catalog.bike.created",
            entityType: "bike",
            entityId: result.insertId,
            details: { fields: Object.keys(fields) }
          });
          return result.insertId;
        });
        response.status(201).json({ data: { id: String(id) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/crm/catalog/bikes/:bikeId",
    requireAnyPermission("catalog.manage"),
    async (request, response, next) => {
      const bikeId = parseId(request.params.bikeId);
      const fields = validateBikeBody(request.body, { patch: true });
      if (!bikeId) {
        sendError(response, 400, "INVALID_BIKE_ID", "Bike ID is invalid.");
        return;
      }
      if (!fields) {
        sendError(response, 400, "INVALID_BIKE", "Bike catalogue fields are invalid.");
        return;
      }
      try {
        const updated = await withTransaction(async (connection) => {
          const [existing] = await connection.execute(
            "SELECT id FROM bikes WHERE id = ? FOR UPDATE",
            [bikeId]
          );
          if (!existing[0]) return false;
          const columns = Object.keys(fields);
          await connection.execute(
            `UPDATE bikes SET ${columns.map((column) => `${column} = ?`).join(", ")},
             updated_at = UTC_TIMESTAMP(6)
             WHERE id = ?`,
            [...columns.map((column) => fields[column]), bikeId]
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "catalog.bike.updated",
            entityType: "bike",
            entityId: bikeId,
            details: { fields: Object.keys(fields) }
          });
          return true;
        });
        if (!updated) {
          sendError(response, 404, "BIKE_NOT_FOUND", "Bike not found.");
          return;
        }
        response.status(200).json({ data: { id: bikeId } });
      } catch (error) {
        next(error);
      }
    }
  );
  return router;
}
