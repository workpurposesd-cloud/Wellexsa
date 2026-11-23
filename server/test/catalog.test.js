import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createCatalogRouter } from "../src/routes/catalog.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startCatalogServer({
  principal = null,
  pool = { async execute() { return [[], []]; } },
  withTransaction = async (operation) => operation(pool)
}) {
  const app = express();
  app.use(express.json());
  app.use(createCatalogRouter({
    getPool: () => pool,
    withTransaction,
    verifyToken: (request, _response, next) => {
      request.auth = { uid: "test-uid" };
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
  permissions: ["catalog.manage"]
};

function bikeRow(overrides = {}) {
  return {
    id: "12",
    name: "E-Urban",
    model: "EU-1",
    price: "125000.00",
    short_description: "City electric bike",
    description: null,
    stock_quantity: 4,
    status: "published",
    created_at: null,
    updated_at: null,
    brand_name: "Wellexsa",
    brand_slug: "wellexsa",
    category_name: "City",
    category_slug: "city",
    ...overrides
  };
}

test("public bike catalogue returns published rows with bound filters", async () => {
  const calls = [];
  const url = await startCatalogServer({
    pool: {
      async execute(sql, parameters = []) {
        calls.push({ sql, parameters });
        return sql.startsWith("SELECT COUNT")
          ? [[{ total: "1" }], []]
          : [[bikeRow()], []];
      }
    }
  });

  const response = await fetch(`${url}/catalog/bikes?category=city&page=1&pageSize=10`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.bikes[0].id, "12");
  assert.equal(body.data.bikes[0].price, "125000.00");
  assert.deepEqual(calls.map(({ parameters }) => parameters), [["city"], ["city", 10, 0]]);
  assert.equal(calls.every(({ sql }) => sql.includes("b.status = 'published'")), true);
});

test("public bike detail only returns published active catalogue entries", async () => {
  let call;
  const url = await startCatalogServer({
    pool: {
      async execute(sql, parameters) {
        call = { sql, parameters };
        return [[bikeRow()], []];
      }
    }
  });

  const response = await fetch(`${url}/catalog/bikes/12`);

  assert.equal(response.status, 200);
  assert.deepEqual(call.parameters, ["12"]);
  assert.match(call.sql, /b\.status = 'published'/);
  assert.match(call.sql, /br\.is_active = TRUE/);
  assert.match(call.sql, /bc\.is_active = TRUE/);
});

test("public brand and category lists expose active taxonomy only", async () => {
  const calls = [];
  const url = await startCatalogServer({
    pool: {
      async execute(sql) {
        calls.push(sql);
        return [[{ id: "2", name: "City", slug: "city" }], []];
      }
    }
  });

  const brandsResponse = await fetch(`${url}/catalog/brands`);
  const categoriesResponse = await fetch(`${url}/catalog/categories`);

  assert.equal(brandsResponse.status, 200);
  assert.equal(categoriesResponse.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((sql) => sql.includes("WHERE is_active = TRUE")), true);
});

test("catalog management is denied without the Owner catalogue permission", async () => {
  let databaseCalls = 0;
  const url = await startCatalogServer({
    principal: { id: "7", role: "staff", permissions: ["catalog.read"] },
    pool: {
      async execute() {
        databaseCalls += 1;
        return [[], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/catalog/bikes`);

  assert.equal(response.status, 403);
  assert.equal(databaseCalls, 0);
});

test("Owner can create a bike using parameterized validated fields", async () => {
  const calls = [];
  const url = await startCatalogServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return [{ insertId: "45" }, []];
      }
    }
  });

  const response = await fetch(`${url}/crm/catalog/bikes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E-Urban",
      price: "125000.00",
      status: "draft",
      stockQuantity: 4
    })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { id: "45" } });
  assert.match(calls[0].sql, /INSERT INTO bikes/);
  assert.deepEqual(calls[0].parameters, ["E-Urban", "125000.00", 4, "draft"]);
  assert.match(calls[1].sql, /INSERT INTO activity_logs/);
});

test("invalid bike values and malformed taxonomy slugs are rejected before SQL", async () => {
  let databaseCalls = 0;
  const url = await startCatalogServer({
    principal: ownerPrincipal,
    pool: {
      async execute() {
        databaseCalls += 1;
        return [{ insertId: "1" }, []];
      }
    }
  });

  const bikeResponse = await fetch(`${url}/crm/catalog/bikes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bike", price: "-1" })
  });
  const categoryResponse = await fetch(`${url}/crm/catalog/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "City", slug: "City / Road" })
  });

  assert.equal(bikeResponse.status, 400);
  assert.equal(categoryResponse.status, 400);
  assert.equal(databaseCalls, 0);
});

test("Owner can create and deactivate a category without deleting references", async () => {
  const calls = [];
  const url = await startCatalogServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        if (sql.startsWith("SELECT")) return [[{ id: "6" }], []];
        if (sql.startsWith("INSERT INTO bike_categories")) return [{ insertId: "6" }, []];
        return [{ affectedRows: 1 }, []];
      }
    }
  });

  const createResponse = await fetch(`${url}/crm/catalog/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "City", slug: "city", description: "Urban riding" })
  });
  const patchResponse = await fetch(`${url}/crm/catalog/categories/6`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: false })
  });

  assert.equal(createResponse.status, 201);
  assert.equal(patchResponse.status, 200);
  assert.deepEqual(calls[0].parameters, ["City", "city", "Urban riding"]);
  assert.deepEqual(calls[3].parameters, [false, "6"]);
  assert.equal(calls[3].sql.startsWith("UPDATE bike_categories"), true);
});

test("Owner can list manageable catalogue entries and update a bike", async () => {
  const poolCalls = [];
  const connectionCalls = [];
  const connection = {
    async execute(sql, parameters) {
      connectionCalls.push({ sql, parameters });
      if (sql.startsWith("SELECT")) return [[{ id: "12" }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const pool = {
    async execute(sql, parameters) {
      poolCalls.push({ sql, parameters });
      return sql.includes("FROM bikes") ? [[bikeRow({ status: "draft" })], []] : [[{
        id: "3",
        name: "Wellexsa",
        slug: "wellexsa",
        is_active: 1
      }], []];
    }
  };
  const url = await startCatalogServer({
    principal: ownerPrincipal,
    pool,
    withTransaction: (operation) => operation(connection)
  });

  const brandsResponse = await fetch(`${url}/crm/catalog/brands`);
  const bikesResponse = await fetch(`${url}/crm/catalog/bikes`);
  const patchResponse = await fetch(`${url}/crm/catalog/bikes/12`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "published", price: "120000.00" })
  });

  assert.equal(brandsResponse.status, 200);
  assert.equal(bikesResponse.status, 200);
  assert.equal(patchResponse.status, 200);
  assert.match(poolCalls[0].sql, /FROM bike_brands/);
  assert.match(poolCalls[1].sql, /FROM bikes/);
  assert.deepEqual(connectionCalls[1].parameters, ["120000.00", "published", "12"]);
  assert.match(connectionCalls[1].sql, /updated_at = UTC_TIMESTAMP\(6\)/);
  assert.match(connectionCalls[2].sql, /INSERT INTO activity_logs/);
});
