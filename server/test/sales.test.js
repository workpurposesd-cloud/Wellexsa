import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createSalesRouter } from "../src/routes/sales.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startSalesServer({
  principal,
  pool = { async execute() { return [[], []]; } },
  withTransaction = async (operation) => operation(pool),
  uid = "verified-firebase-uid"
}) {
  const app = express();
  app.use(express.json());
  app.use(createSalesRouter({
    getPool: () => pool,
    withTransaction,
    verifyToken: (request, _response, next) => {
      request.auth = { uid };
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
  uid: "verified-firebase-uid",
  role: "owner",
  permissions: ["crm.sales.create", "crm.sales.read.all"]
};

const staffPrincipal = {
  id: "7",
  uid: "verified-firebase-uid",
  role: "staff",
  permissions: ["crm.sales.create", "crm.sales.read.assigned"]
};

const saleRequest = {
  requestId: "sale-request-000001",
  customerId: "9",
  discountAmount: "100.00",
  items: [
    { bikeId: "5", quantity: 2, unitPrice: "1000.25" },
    {
      productNameSnapshot: "Helmet",
      quantity: 1,
      unitPrice: "499.50",
      batteryType: "Not Applicable"
    }
  ]
};

test("offline sale calculates line totals and discount from validated values in a transaction", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM sale_requests")) return [[], []];
      if (sql.includes("FROM customers")) return [[{ id: "9", name: "Rider" }], []];
      if (sql.includes("FROM bikes")) return [[{ name: "E-Urban", model: "EU-1" }], []];
      if (sql.includes("INSERT INTO sales")) return [{ insertId: "71" }, []];
      return [{ insertId: "81", affectedRows: 1 }, []];
    }
  };
  const url = await startSalesServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saleRequest)
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(body.data, {
    id: "71",
    currency: "INR",
    subtotal: "2500.00",
    discountAmount: "100.00",
    totalAmount: "2400.00",
    idempotent: false
  });
  assert.deepEqual(calls[3].parameters, [
    "9", "Rider", "1", "INR", "2500.00", "100.00", "2400.00", null, null, null
  ]);
  assert.deepEqual(calls[4].parameters, [
    "71", "5", "E-Urban", "EU-1", null, null, 2, "1000.25", "2000.50"
  ]);
  assert.deepEqual(calls[5].parameters, [
    "71", null, "Helmet", null, "Not Applicable", null, 1, "499.50", "499.50"
  ]);
  assert.match(calls[6].sql, /INSERT INTO sale_history/);
  assert.deepEqual(calls[7].parameters, ["1", "verified-firebase-uid", saleRequest.requestId, "71"]);
});

test("invalid discounts and client-supplied totals are rejected before database use", async () => {
  let calls = 0;
  const url = await startSalesServer({
    principal: ownerPrincipal,
    withTransaction: async () => {
      calls += 1;
    }
  });

  const response = await fetch(`${url}/crm/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...saleRequest,
      discountAmount: "2500.01",
      totalAmount: "0.00"
    })
  });

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("Staff sale creation locks and scopes the customer to the assigned employee", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM sale_requests")) return [[], []];
      if (sql.includes("FROM customers")) return [[], []];
      throw new Error("No operations should follow a denied customer lookup.");
    }
  };
  const url = await startSalesServer({
    principal: staffPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saleRequest)
  });

  assert.equal(response.status, 404);
  assert.deepEqual(calls[1].parameters, ["9", "7"]);
  assert.match(calls[1].sql, /assigned_staff_user_id = \?/);
});

test("an existing sale request returns its recorded sale without inserting again", async () => {
  let calls = 0;
  const url = await startSalesServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: async (operation) => operation({
      async execute(sql, parameters) {
        calls += 1;
        assert.match(sql, /FROM sale_requests/);
        assert.deepEqual(parameters, ["verified-firebase-uid", saleRequest.requestId]);
        return [[{
          sale_id: "71",
          subtotal: "2500.00",
          discount_amount: "100.00",
          total_amount: "2400.00"
        }], []];
      }
    })
  });

  const response = await fetch(`${url}/crm/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saleRequest)
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.idempotent, true);
  assert.equal(calls, 1);
});

test("sales list is scoped and excludes historical purchase records", async () => {
  const calls = [];
  const url = await startSalesServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return sql.includes("COUNT(*)")
          ? [[{ total: "0" }], []]
          : [[], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/sales`);

  assert.equal(response.status, 200);
  assert.equal(calls.every(({ sql }) => sql.includes("s.record_type = 'new_showroom'")), true);
  assert.deepEqual(calls.map(({ parameters }) => parameters), [["7", "7"], ["7", "7", 25, 0]]);
});

test("sale detail returns related items only for a new showroom sale", async () => {
  const calls = [];
  const url = await startSalesServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        if (sql.includes("FROM sale_items")) {
          return [[{
            id: "81",
            bike_id: "5",
            product_name_snapshot: "E-Urban",
            model_snapshot: "EU-1",
            battery_type: null,
            warranty_details: null,
            quantity: 1,
            unit_price: "125000.00",
            line_total: "125000.00"
          }], []];
        }
        return [[{
          id: "71",
          customer_id: "9",
          customer_name_snapshot: "Rider",
          recorded_by_user_id: "1",
          sale_date: null,
          currency: "INR",
          subtotal: "125000.00",
          discount_amount: "0.00",
          total_amount: "125000.00",
          purchase_status: null,
          payment_status: null,
          delivery_status: null,
          created_at: null
        }], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/sales/71`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.sale.items[0].quantity, 1);
  assert.deepEqual(calls[0].parameters, ["71"]);
  assert.deepEqual(calls[1].parameters, ["71"]);
  assert.match(calls[0].sql, /s\.record_type = 'new_showroom'/);
});
