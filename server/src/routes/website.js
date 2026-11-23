import { Router } from "express";
import { writeActivityLog } from "../database/activityLog.js";
import { getDatabasePool, withDatabaseTransaction } from "../database/pool.js";
import { createRequirePrincipal, requireAnyPermission, resolvePrincipal } from "../middleware/authorize.js";
import { verifyFirebaseToken } from "../middleware/verifyFirebaseToken.js";

const SLIDE_STATUSES = new Set(["draft", "published"]);
const SETTING_KEY_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const PUBLIC_SLIDE_SELECT = `SELECT s.id, s.title, s.description, s.button_text,
                                    s.button_url, s.display_order, m.public_url
                             FROM homepage_slides AS s
                             JOIN media_assets AS m ON m.id = s.media_asset_id`;

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

function safeButtonUrl(value) {
  return value === null ||
    (typeof value === "string" &&
      value.length <= 2048 &&
      /^(?:https:\/\/[^\s\\]+|\/(?!\/)[^\s\\]*|#[^\s\\]*|[A-Za-z0-9._~-]+(?:\/[^\s\\]*)?)$/.test(value));
}

function validateSlideBody(body, { patch = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).length === 0) return null;
  const allowed = new Set([
    "title", "description", "buttonText", "buttonUrl",
    "mediaAssetId", "displayOrder", "enabled", "status"
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  const fields = {};
  if (Object.hasOwn(body, "title")) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 160) return null;
    fields.title = body.title.trim();
  } else if (!patch) return null;
  if (Object.hasOwn(body, "description")) {
    if (body.description !== null &&
      (typeof body.description !== "string" || body.description.length > 1000)) return null;
    fields.description = body.description;
  }
  if (Object.hasOwn(body, "buttonText")) {
    if (body.buttonText !== null &&
      (typeof body.buttonText !== "string" || body.buttonText.length > 100)) return null;
    fields.button_text = body.buttonText;
  }
  if (Object.hasOwn(body, "buttonUrl")) {
    if (!safeButtonUrl(body.buttonUrl)) return null;
    fields.button_url = body.buttonUrl;
  }
  if (Object.hasOwn(body, "mediaAssetId")) {
    if (body.mediaAssetId !== null && parseId(String(body.mediaAssetId)) === null) return null;
    fields.media_asset_id = body.mediaAssetId === null ? null : String(body.mediaAssetId);
  }
  if (Object.hasOwn(body, "displayOrder")) {
    if (!Number.isInteger(body.displayOrder) || body.displayOrder < 0 ||
      body.displayOrder > 2147483647) return null;
    fields.display_order = body.displayOrder;
  }
  if (Object.hasOwn(body, "enabled")) {
    if (typeof body.enabled !== "boolean") return null;
    fields.enabled = body.enabled;
  }
  if (Object.hasOwn(body, "status")) {
    if (!SLIDE_STATUSES.has(body.status)) return null;
    fields.status = body.status;
  } else if (!patch) {
    fields.status = "draft";
  }
  return fields;
}

function slideDto(row, includeAdmin = false) {
  const slide = {
    id: String(row.id),
    title: row.title,
    description: row.description,
    buttonText: row.button_text,
    buttonUrl: row.button_url,
    imageUrl: row.public_url,
    displayOrder: row.display_order
  };
  if (includeAdmin) {
    slide.status = row.status;
    slide.enabled = Boolean(row.enabled);
  }
  return slide;
}

function serializeJson(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 65536) return null;
  return serialized;
}

export function createWebsiteRouter({
  getPool = getDatabasePool,
  withTransaction = withDatabaseTransaction,
  verifyToken = verifyFirebaseToken,
  principalResolver = resolvePrincipal
} = {}) {
  const router = Router();
  router.use(
    "/crm",
    verifyToken,
    createRequirePrincipal({ getPool, principalResolver })
  );

  router.get("/website/slides", async (_request, response, next) => {
    try {
      const [rows] = await getPool().execute(
        `${PUBLIC_SLIDE_SELECT}
         WHERE s.status = 'published' AND s.enabled = TRUE
           AND m.access_level = 'public' AND m.status = 'active'
         ORDER BY s.display_order, s.id`
      );
      response.status(200).json({ data: { slides: rows.map((row) => slideDto(row)) } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/website/settings", async (_request, response, next) => {
    try {
      const [rows] = await getPool().execute(
        `SELECT setting_key, setting_value
         FROM website_settings WHERE visibility = 'public'
         ORDER BY setting_key`
      );
      response.status(200).json({
        data: { settings: Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value])) }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/crm/homepage-slides",
    requireAnyPermission("homepage_slides.manage"),
    async (_request, response, next) => {
      try {
        const [rows] = await getPool().execute(
          `SELECT s.id, s.title, s.description, s.button_text, s.button_url,
                  s.display_order, s.enabled, s.status, m.public_url
           FROM homepage_slides AS s
           LEFT JOIN media_assets AS m
             ON m.id = s.media_asset_id AND m.access_level = 'public' AND m.status = 'active'
           ORDER BY s.display_order, s.id`
        );
        response.status(200).json({
          data: { slides: rows.map((row) => slideDto(row, true)) }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    "/crm/homepage-slides",
    requireAnyPermission("homepage_slides.manage"),
    async (request, response, next) => {
      const fields = validateSlideBody(request.body);
      if (!fields ||
        (fields.status === "published" && !fields.media_asset_id)) {
        sendError(response, 400, "INVALID_SLIDE", "Slide fields are invalid or a published slide has no media.");
        return;
      }
      try {
        const id = await withTransaction(async (connection) => {
          if (fields.media_asset_id !== undefined &&
            !await assertPublicMedia(connection, fields.media_asset_id)) return null;
          const columns = Object.keys(fields);
          const [result] = await connection.execute(
            `INSERT INTO homepage_slides (
               ${columns.join(", ")}, created_at, updated_at
             ) VALUES (
               ${columns.map(() => "?").join(", ")}, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
             )`,
            columns.map((column) => fields[column])
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "homepage_slide.created",
            entityType: "homepage_slide",
            entityId: result.insertId,
            details: { fields: Object.keys(fields) }
          });
          return result.insertId;
        });
        if (id === null) {
          sendError(response, 400, "INVALID_MEDIA_ASSET", "Slide media must be active and public.");
          return;
        }
        response.status(201).json({ data: { id: String(id) } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    "/crm/homepage-slides/:slideId",
    requireAnyPermission("homepage_slides.manage"),
    async (request, response, next) => {
      const slideId = parseId(request.params.slideId);
      const fields = validateSlideBody(request.body, { patch: true });
      if (!slideId) {
        sendError(response, 400, "INVALID_SLIDE_ID", "Slide ID is invalid.");
        return;
      }
      if (!fields) {
        sendError(response, 400, "INVALID_SLIDE", "Slide fields are invalid.");
        return;
      }
      try {
        const updated = await withTransaction(async (connection) => {
          const [existing] = await connection.execute(
            "SELECT id, media_asset_id, status FROM homepage_slides WHERE id = ? FOR UPDATE",
            [slideId]
          );
          if (!existing[0]) return false;
          const mediaAssetId = Object.hasOwn(fields, "media_asset_id")
            ? fields.media_asset_id
            : existing[0].media_asset_id;
          const status = fields.status ?? existing[0].status;
          if (status === "published" &&
            (!mediaAssetId || !await assertPublicMedia(connection, mediaAssetId))) return null;
          const columns = Object.keys(fields);
          await connection.execute(
            `UPDATE homepage_slides SET ${columns.map((column) => `${column} = ?`).join(", ")},
             updated_at = UTC_TIMESTAMP(6)
             WHERE id = ?`,
            [...columns.map((column) => fields[column]), slideId]
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "homepage_slide.updated",
            entityType: "homepage_slide",
            entityId: slideId,
            details: { fields: Object.keys(fields) }
          });
          return true;
        });
        if (updated === null) {
          sendError(response, 400, "INVALID_MEDIA_ASSET", "Published slides require active public media.");
          return;
        }
        if (!updated) {
          sendError(response, 404, "SLIDE_NOT_FOUND", "Homepage slide not found.");
          return;
        }
        response.status(200).json({ data: { id: slideId } });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    "/crm/website-settings",
    requireAnyPermission("website_settings.manage"),
    async (_request, response, next) => {
      try {
        const [rows] = await getPool().execute(
          `SELECT setting_key, setting_value, visibility, updated_by_user_id, updated_at
           FROM website_settings ORDER BY setting_key`
        );
        response.status(200).json({
          data: {
            settings: rows.map((row) => ({
              key: row.setting_key,
              value: row.setting_value,
              visibility: row.visibility,
              updatedByUserId: row.updated_by_user_id === null
                ? null
                : String(row.updated_by_user_id),
              updatedAt: row.updated_at
            }))
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  router.put(
    "/crm/website-settings/:settingKey",
    requireAnyPermission("website_settings.manage"),
    async (request, response, next) => {
      const settingKey = request.params.settingKey;
      const body = request.body;
      if (!SETTING_KEY_PATTERN.test(settingKey) || !body ||
        typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["value", "visibility"].includes(key)) ||
        !Object.hasOwn(body, "value") ||
        (body.visibility !== undefined && !["public", "private"].includes(body.visibility))) {
        sendError(response, 400, "INVALID_WEBSITE_SETTING", "Website setting is invalid.");
        return;
      }
      const serializedValue = serializeJson(body.value);
      if (serializedValue === null) {
        sendError(response, 400, "INVALID_WEBSITE_SETTING", "Setting value must be valid JSON under 64 KB.");
        return;
      }
      const visibility = body.visibility ?? "private";
      try {
        await withTransaction(async (connection) => {
          await connection.execute(
            `INSERT INTO website_settings (
               setting_key, setting_value, visibility, updated_by_user_id, updated_at
             ) VALUES (?, CAST(? AS JSON), ?, ?, UTC_TIMESTAMP(6))
             ON DUPLICATE KEY UPDATE
               setting_value = VALUES(setting_value),
               visibility = VALUES(visibility),
               updated_by_user_id = VALUES(updated_by_user_id),
               updated_at = UTC_TIMESTAMP(6)`,
            [settingKey, serializedValue, visibility, request.principal.id]
          );
          await writeActivityLog(connection, {
            actor: request.principal,
            action: "website_setting.updated",
            entityType: "website_setting",
            entityId: settingKey,
            details: { visibility }
          });
        });
        response.status(200).json({ data: { key: settingKey, visibility } });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

async function assertPublicMedia(connection, mediaAssetId) {
  const [rows] = await connection.execute(
    `SELECT id FROM media_assets
     WHERE id = ? AND access_level = 'public' AND status = 'active'
     FOR UPDATE`,
    [mediaAssetId]
  );
  return rows.length > 0;
}
