import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createCustomerRouter } from "../src/routes/customers.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startCustomerServer({
  principal,
  pool = { async execute() { return [[], []]; } },
  withTransaction = async (operation) => operation(pool)
}) {
  const app = express();
  app.use(express.json());
  app.use(createCustomerRouter({
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

const staffPrincipal = {
  id: "7",
  uid: "staff-uid",
  role: "staff",
  permissions: [
    "crm.customers.read.assigned",
    "crm.customers.create",
    "crm.customers.update.assigned"
  ]
};

const ownerPrincipal = {
  id: "1",
  uid: "owner-uid",
  role: "owner",
  permissions: [
    "crm.customers.read.all",
    "crm.customers.create",
    "crm.customers.update.all",
    "crm.customers.assign"
  ]
};

test("staff customer list is SQL-scoped to assigned records and omits phone data", async () => {
  const calls = [];
  const pool = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("COUNT(*)")) return [[{ total: 1 }], []];
      return [[{
        id: "41",
        name: "Rider",
        email: null,
        customer_type: "new",
        source: "showroom",
        status: "new",
        interest_status: null,
        call_status: null,
        interested_bike: null,
        assigned_staff_user_id: "7",
        created_at: null,
        updated_at: null
      }], []];
    }
  };
  const url = await startCustomerServer({ principal: staffPrincipal, pool });
  const response = await fetch(`${url}/crm/customers`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ parameters }) => parameters), [["7"], ["7", 25, 0]]);
  assert.equal(calls.every(({ sql }) => sql.includes("assigned_staff_user_id = ?")), true);
  assert.equal(calls.some(({ sql }) => /phone_ciphertext|encryption_nonce|authentication_tag/.test(sql)), false);
  assert.equal(body.data.customers[0].id, "41");
  assert.equal(Object.hasOwn(body.data.customers[0], "phone"), false);
});

test("staff cannot retrieve another staff member's customer", async () => {
  let call;
  const url = await startCustomerServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql, parameters) {
        call = { sql, parameters };
        return [[], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/customers/41`);

  assert.equal(response.status, 404);
  assert.deepEqual(call.parameters, ["41", "7"]);
  assert.match(call.sql, /assigned_staff_user_id = \?/);
});

test("staff cannot assign a customer to another staff member", async () => {
  let transactionCalls = 0;
  const url = await startCustomerServer({
    principal: staffPrincipal,
    withTransaction: async () => {
      transactionCalls += 1;
    }
  });

  const response = await fetch(`${url}/crm/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Rider", assignedStaffUserId: "8" })
  });

  assert.equal(response.status, 400);
  assert.equal(transactionCalls, 0);
});

test("staff customer creation assigns to the actor and accepts no phone fields", async () => {
  const queries = [];
  const connection = {
    async execute(sql, parameters) {
      queries.push({ sql, parameters });
      if (sql.includes("SELECT sp.user_id")) return [[{ user_id: "7" }], []];
      return [{ insertId: "55" }, []];
    }
  };
  const url = await startCustomerServer({
    principal: staffPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Rider", email: "rider@example.com" })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { id: "55" } });
  assert.equal(queries.length, 3);
  assert.deepEqual(queries[0].parameters, ["7"]);
  assert.match(queries[1].sql, /INSERT INTO customers/);
  assert.equal(queries[1].parameters.includes("7"), true);
  assert.equal(/phone_ciphertext|encryption_nonce|authentication_tag/.test(queries[1].sql), false);
});

test("owner reassignment locks and validates active staff before updating", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT id FROM customers")) return [[{ id: "41" }], []];
      if (sql.includes("SELECT sp.user_id")) return [[{ user_id: "8" }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startCustomerServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/customers/41`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignedStaffUserId: "8" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls[2].parameters, ["8", "41"]);
  assert.match(calls[2].sql, /WHERE id = \? AND is_archived = FALSE/);
});

test("customer profile updates keep search indexing and audit writes in one transaction", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT id FROM customers")) return [[{ id: "41" }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startCustomerServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/customers/41`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Rider Two" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls[1].parameters, ["Rider Two", "rider two", "41"]);
  assert.match(calls[1].sql, /updated_at = UTC_TIMESTAMP\(6\)/);
  assert.match(calls[2].sql, /INSERT INTO activity_logs/);
});
