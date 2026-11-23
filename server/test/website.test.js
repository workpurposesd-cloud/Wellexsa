import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createWebsiteRouter } from "../src/routes/website.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startWebsiteServer({
  principal = null,
  pool = { async execute() { return [[], []]; } },
  withTransaction = async (operation) => operation(pool)
}) {
  const app = express();
  app.use(express.json());
  app.use(createWebsiteRouter({
    getPool: () => pool,
    withTransaction,
    verifyToken: (request, _response, next) => {
      request.auth = { uid: "owner-uid" };
      next();
    },
    principalResolver: async () => principal
  }));
  app.use((error, _request, response, _next) => {
    response.status(500).json({ error: { code: "TEST_ERROR" } });
  });
  const server = app.listen(0, "127.0.0.1");
  servers.add(server);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

const ownerPrincipal = {
  id: "1",
  role: "owner",
  permissions: ["homepage_slides.manage", "website_settings.manage"]
};

test("public slides are limited to published, enabled slides with active public media", async () => {
  let sql;
  const url = await startWebsiteServer({
    pool: {
      async execute(query) {
        sql = query;
        return [[{
          id: "3",
          title: "Ride forward",
          description: "Electric mobility",
          button_text: "Explore",
          button_url: "/bikes.html",
          display_order: 1,
          public_url: "https://cdn.example/bike.webp"
        }], []];
      }
    }
  });

  const response = await fetch(`${url}/website/slides`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.slides[0].imageUrl, "https://cdn.example/bike.webp");
  assert.match(sql, /s\.status = 'published' AND s\.enabled = TRUE/);
  assert.match(sql, /m\.access_level = 'public' AND m\.status = 'active'/);
});

test("public website settings query excludes private settings", async () => {
  let sql;
  const url = await startWebsiteServer({
    pool: {
      async execute(query) {
        sql = query;
        return [[{ setting_key: "showroom.phone", setting_value: "000" }], []];
      }
    }
  });

  const response = await fetch(`${url}/website/settings`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.settings, { "showroom.phone": "000" });
  assert.match(sql, /visibility = 'public'/);
});

test("slide management requires its Owner permission", async () => {
  let databaseCalls = 0;
  const url = await startWebsiteServer({
    principal: { id: "7", role: "staff", permissions: [] },
    pool: {
      async execute() {
        databaseCalls += 1;
        return [[], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/homepage-slides`);

  assert.equal(response.status, 403);
  assert.equal(databaseCalls, 0);
});

test("published slide creation validates public media in a transaction", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM media_assets")) return [[{ id: "4" }], []];
      if (sql.includes("INSERT INTO homepage_slides")) return [{ insertId: "8" }, []];
      return [{ insertId: "20" }, []];
    }
  };
  const url = await startWebsiteServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/homepage-slides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Ride forward",
      status: "published",
      enabled: true,
      mediaAssetId: "4",
      buttonUrl: "/bikes.html"
    })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { id: "8" } });
  assert.deepEqual(calls[0].parameters, ["4"]);
  assert.match(calls[1].sql, /INSERT INTO homepage_slides/);
  assert.match(calls[2].sql, /INSERT INTO activity_logs/);
});

test("slide validation rejects unsafe URLs and published slides without media", async () => {
  let transactions = 0;
  const url = await startWebsiteServer({
    principal: ownerPrincipal,
    withTransaction: async () => {
      transactions += 1;
    }
  });

  const unsafeUrl = await fetch(`${url}/crm/homepage-slides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Unsafe", buttonUrl: "javascript:alert(1)" })
  });
  const missingMedia = await fetch(`${url}/crm/homepage-slides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "No image", status: "published" })
  });

  assert.equal(unsafeUrl.status, 400);
  assert.equal(missingMedia.status, 400);
  assert.equal(transactions, 0);
});

test("Owner can inspect website content and update an existing slide", async () => {
  const poolCalls = [];
  const transactionCalls = [];
  const connection = {
    async execute(sql, parameters) {
      transactionCalls.push({ sql, parameters });
      if (sql.startsWith("SELECT id, media_asset_id, status")) {
        return [[{ id: "3", media_asset_id: "4", status: "published" }], []];
      }
      if (sql.includes("FROM media_assets")) return [[{ id: "4" }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const pool = {
    async execute(sql) {
      poolCalls.push(sql);
      return sql.includes("FROM homepage_slides")
        ? [[{
          id: "3",
          title: "Ride forward",
          description: null,
          button_text: null,
          button_url: null,
          display_order: 1,
          enabled: 1,
          status: "published",
          public_url: "https://cdn.example/slide.webp"
        }], []]
        : [[{
          setting_key: "showroom.phone",
          setting_value: "000",
          visibility: "private",
          updated_by_user_id: "1",
          updated_at: null
        }], []];
    }
  };
  const url = await startWebsiteServer({
    principal: ownerPrincipal,
    pool,
    withTransaction: (operation) => operation(connection)
  });

  const slidesResponse = await fetch(`${url}/crm/homepage-slides`);
  const settingsResponse = await fetch(`${url}/crm/website-settings`);
  const patchResponse = await fetch(`${url}/crm/homepage-slides/3`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false })
  });

  assert.equal(slidesResponse.status, 200);
  assert.equal((await slidesResponse.json()).data.slides[0].status, "published");
  assert.equal(settingsResponse.status, 200);
  assert.equal((await settingsResponse.json()).data.settings[0].key, "showroom.phone");
  assert.equal(patchResponse.status, 200);
  assert.match(poolCalls[0], /FROM homepage_slides/);
  assert.match(poolCalls[1], /FROM website_settings/);
  assert.deepEqual(transactionCalls[2].parameters, [false, "3"]);
  assert.match(transactionCalls[2].sql, /updated_at = UTC_TIMESTAMP\(6\)/);
  assert.match(transactionCalls[3].sql, /INSERT INTO activity_logs/);
});

test("Owner website setting update is parameterized and audit details omit the value", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startWebsiteServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/website-settings/showroom.phone`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "000", visibility: "private" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].parameters, ["showroom.phone", "\"000\"", "private", "1"]);
  assert.match(calls[0].sql, /CAST\(\? AS JSON\)/);
  assert.deepEqual(JSON.parse(calls[1].parameters[5]), { visibility: "private" });
  assert.equal(calls[1].parameters[5].includes("000"), false);
});
