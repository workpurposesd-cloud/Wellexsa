import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createReportsRouter } from "../src/routes/reports.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startReportsServer({
  principal,
  pool = { async execute() { return [[], []]; } }
}) {
  const app = express();
  app.use(createReportsRouter({
    getPool: () => pool,
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
  permissions: ["reports.read", "activity_logs.read"]
};

test("Owner dashboard returns aggregate CRM metrics without loading customer PII", async () => {
  const sqlQueries = [];
  const url = await startReportsServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql) {
        sqlQueries.push(sql);
        if (sql.includes("FROM customers")) {
          return [[{ total: "8", new_count: "2", purchased_count: "1" }], []];
        }
        if (sql.includes("FROM enquiries")) {
          return [[{ status: "new", total: "3" }], []];
        }
        if (sql.includes("FROM follow_ups")) {
          return [[{ pending_count: "5", overdue_count: "2" }], []];
        }
        if (sql.includes("FROM sales")) {
          return [[{
            sales_count: "2",
            subtotal: "5000.00",
            discounts: "100.00",
            total: "4900.00"
          }], []];
        }
        return [[{ status: "published", total: "4" }], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/dashboard`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data, {
    customers: { total: 8, new: 2, purchased: 1 },
    enquiries: { new: 3 },
    followUps: { pending: 5, overdue: 2 },
    todaySales: {
      count: 2,
      currency: "INR",
      subtotal: "5000.00",
      discounts: "100.00",
      total: "4900.00"
    },
    bikes: { published: 4 }
  });
  assert.equal(sqlQueries.every((sql) => !/phone_ciphertext|email|lookup_hmac/i.test(sql)), true);
  assert.equal(sqlQueries.some((sql) => sql.includes("record_type = 'new_showroom'")), true);
});

test("Staff without report permission cannot access the dashboard", async () => {
  let queries = 0;
  const url = await startReportsServer({
    principal: { id: "7", role: "staff", permissions: [] },
    pool: {
      async execute() {
        queries += 1;
        return [[], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/dashboard`);

  assert.equal(response.status, 403);
  assert.equal(queries, 0);
});

test("activity feed uses parameterized filters and does not expose details JSON", async () => {
  const calls = [];
  const url = await startReportsServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return sql.includes("COUNT(*)")
          ? [[{ total: "1" }], []]
          : [[{
            id: "40",
            actor_user_id: "1",
            actor_role_code: "owner",
            action: "sale.created",
            entity_type: "sale",
            entity_id: "50",
            created_at: null,
            details: { secret: "not returned" }
          }], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/activity-logs?action=sale.created&entityType=sale`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ parameters }) => parameters), [
    ["sale.created", "sale"],
    ["sale.created", "sale", 25, 0]
  ]);
  assert.equal(calls.some(({ sql }) => sql.includes("details")), false);
  assert.equal(Object.hasOwn(body.data.activityLogs[0], "details"), false);
});
