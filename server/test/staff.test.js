import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createStaffRouter } from "../src/routes/staff.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startStaffServer({
  principal,
  pool = { async execute() { return [[], []]; } },
  withTransaction = async (operation) => operation(pool),
  getFirebaseUserByEmail
}) {
  const app = express();
  app.use(express.json());
  app.use(createStaffRouter({
    getPool: () => pool,
    withTransaction,
    getFirebaseUserByEmail,
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
  permissions: ["crm.staff.read", "crm.staff.manage"]
};

test("staff APIs require the Owner staff-read permission", async () => {
  let queries = 0;
  const url = await startStaffServer({
    principal: { id: "2", role: "staff", permissions: [] },
    pool: {
      async execute() {
        queries += 1;
        return [[], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/staff`);

  assert.equal(response.status, 403);
  assert.equal(queries, 0);
});

test("staff list returns only staff profile fields, not Firebase identifiers", async () => {
  let sql;
  const url = await startStaffServer({
    principal: ownerPrincipal,
    pool: {
      async execute(query) {
        sql = query;
        return [[{
          user_id: "9",
          email: "staff@example.com",
          display_name: "Staff",
          account_status: "active",
          employee_code: "EMP-9",
          employment_status: "active",
          title: "Sales",
          created_at: null,
          updated_at: null
        }], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/staff`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.staff[0], {
    id: "9",
    email: "staff@example.com",
    displayName: "Staff",
    employeeCode: "EMP-9",
    employmentStatus: "active",
    title: "Sales",
    accountStatus: "active",
    createdAt: null,
    updatedAt: null
  });
  assert.equal(/firebase_uid|phone_ciphertext|encryption_nonce/.test(sql), false);
});

test("Owner can retrieve a specific Staff profile", async () => {
  let call;
  const url = await startStaffServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql, parameters) {
        call = { sql, parameters };
        return [[{
          user_id: "9",
          email: "staff@example.com",
          display_name: "Staff",
          account_status: "active",
          employee_code: null,
          employment_status: "active",
          title: null,
          created_at: null,
          updated_at: null
        }], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/staff/9`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.staff.id, "9");
  assert.deepEqual(call.parameters, ["9"]);
  assert.match(call.sql, /r\.code = 'staff' AND u\.id = \?/);
});

test("placing staff on leave suspends the account in the same transaction", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT sp.user_id")) return [[{ user_id: "9" }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startStaffServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/staff/9`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employmentStatus: "on_leave" })
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].parameters, ["on_leave", "9"]);
  assert.deepEqual(calls[2].parameters, ["suspended", "9"]);
});

test("Owner provisions only an existing verified Firebase account and creates MySQL mappings atomically", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("WHERE firebase_uid = ? OR email = ?")) return [[], []];
      if (sql.includes("FROM roles")) return [[{ id: 2 }], []];
      if (sql.includes("INSERT INTO users")) return [{ insertId: "31" }, []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startStaffServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection),
    getFirebaseUserByEmail: async (email) => {
      assert.equal(email, "staff@example.com");
      return {
        uid: "firebase-staff-uid",
        email: "staff@example.com",
        emailVerified: true,
        disabled: false,
        displayName: "Staff Member"
      };
    }
  });

  const response = await fetch(`${url}/crm/staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "Staff@example.com",
      employeeCode: "EMP-31",
      title: "Sales"
    })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { id: "31" } });
  assert.deepEqual(calls[0].parameters, ["firebase-staff-uid", "staff@example.com"]);
  assert.deepEqual(calls[2].parameters, ["firebase-staff-uid", "staff@example.com", "Staff Member", 2]);
  assert.deepEqual(calls[3].parameters, ["31", "EMP-31", "Sales"]);
  assert.match(calls[4].sql, /INSERT INTO activity_logs/);
});

test("staff provisioning rejects unverified Firebase identities before database writes", async () => {
  let databaseCalls = 0;
  const url = await startStaffServer({
    principal: ownerPrincipal,
    pool: {
      async execute() {
        databaseCalls += 1;
        return [[], []];
      }
    },
    getFirebaseUserByEmail: async () => ({
      uid: "firebase-staff-uid",
      email: "staff@example.com",
      emailVerified: false,
      disabled: false
    })
  });

  const response = await fetch(`${url}/crm/staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "staff@example.com" })
  });

  assert.equal(response.status, 409);
  assert.equal(databaseCalls, 0);
});

test("staff provisioning rejects client-supplied role fields", async () => {
  let firebaseCalls = 0;
  const url = await startStaffServer({
    principal: ownerPrincipal,
    getFirebaseUserByEmail: async () => {
      firebaseCalls += 1;
      return {};
    }
  });

  const response = await fetch(`${url}/crm/staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "staff@example.com", role: "owner" })
  });

  assert.equal(response.status, 400);
  assert.equal(firebaseCalls, 0);
});
