import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createFollowupRouter } from "../src/routes/followups.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startFollowupServer({
  principal,
  pool = { async execute() { return [[], []]; } },
  withTransaction = async (operation) => operation(pool)
}) {
  const app = express();
  app.use(express.json());
  app.use(createFollowupRouter({
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
  role: "staff",
  permissions: [
    "crm.followups.read.assigned",
    "crm.followups.create.assigned",
    "crm.followups.update.assigned",
    "crm.followups.cancel"
  ]
};

const ownerPrincipal = {
  id: "1",
  role: "owner",
  permissions: [
    "crm.followups.read.all",
    "crm.followups.create.all",
    "crm.followups.update.all",
    "crm.followups.cancel"
  ]
};

test("staff follow-up list is restricted to their assignments", async () => {
  const calls = [];
  const url = await startFollowupServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return sql.includes("COUNT(*)")
          ? [[{ total: "1" }], []]
          : [[{
            id: "18",
            customer_id: "9",
            customer_name: "Rider",
            enquiry_id: null,
            bike_model_snapshot: null,
            assigned_staff_user_id: "7",
            due_at: "2030-01-02 10:00:00",
            status: "pending",
            notes: null,
            created_by_user_id: "7",
            completed_by_user_id: null,
            completed_at: null,
            cancelled_by_user_id: null,
            cancelled_at: null,
            created_at: null,
            updated_at: null
          }], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/follow-ups`);

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ parameters }) => parameters), [["7"], ["7", 25, 0]]);
  assert.equal(calls.every(({ sql }) => sql.includes("f.assigned_staff_user_id = ?")), true);
});

test("staff follow-up detail is assignment-scoped", async () => {
  let call;
  const url = await startFollowupServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql, parameters) {
        call = { sql, parameters };
        return [[], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/follow-ups/18`);

  assert.equal(response.status, 404);
  assert.deepEqual(call.parameters, ["18", "7"]);
  assert.match(call.sql, /f\.assigned_staff_user_id = \?/);
});

test("staff follow-up creation scopes the customer and records creation history", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT id FROM customers")) return [[{ id: "9" }], []];
      if (sql.includes("SELECT sp.user_id")) return [[{ user_id: "7" }], []];
      if (sql.includes("INSERT INTO follow_ups")) return [{ insertId: "18" }, []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startFollowupServer({
    principal: staffPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/follow-ups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: "9",
      dueAt: "2030-01-02T15:00:00+05:00",
      notes: "Call about the test ride."
    })
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { id: "18" } });
  assert.deepEqual(calls[0].parameters, ["9", "7"]);
  assert.deepEqual(calls[2].parameters, [
    "9", null, "7", "2030-01-02 10:00:00.000", "Call about the test ride.", "7"
  ]);
  assert.match(calls[3].sql, /INSERT INTO follow_up_history/);
});

test("Owner must assign a new follow-up to an active staff profile", async () => {
  let transactions = 0;
  const url = await startFollowupServer({
    principal: ownerPrincipal,
    withTransaction: async () => {
      transactions += 1;
    }
  });

  const response = await fetch(`${url}/crm/follow-ups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId: "9", dueAt: "2030-01-02T10:00:00Z" })
  });

  assert.equal(response.status, 400);
  assert.equal(transactions, 0);
});

test("rescheduling and completing a follow-up write separate audit history entries", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT id, due_at")) {
        return [[{
          id: "18",
          due_at: "2030-01-01 10:00:00.000",
          assigned_staff_user_id: "7",
          status: "pending"
        }], []];
      }
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startFollowupServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/follow-ups/18`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dueAt: "2030-01-02T10:00:00Z", status: "completed" })
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 5);
  assert.match(calls[1].sql, /UPDATE follow_ups SET/);
  assert.equal(calls[2].parameters[1], "rescheduled");
  assert.equal(calls[3].parameters[1], "status_changed");
});

test("completed follow-ups reject staff reassignment attempts", async () => {
  let writes = 0;
  const url = await startFollowupServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql) {
        if (sql.includes("SELECT id, due_at")) {
          return [[{
            id: "18",
            due_at: "2030-01-01 10:00:00",
            assigned_staff_user_id: "7",
            status: "completed"
          }], []];
        }
        writes += 1;
        return [{ affectedRows: 1 }, []];
      }
    }
  });

  const response = await fetch(`${url}/crm/follow-ups/18`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignedStaffUserId: "8" })
  });

  assert.equal(response.status, 409);
  assert.equal(writes, 0);
});

test("repeated completed status patches are rejected", async () => {
  let writes = 0;
  const url = await startFollowupServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql) {
        if (sql.includes("SELECT id, due_at")) {
          return [[{
            id: "18",
            due_at: "2030-01-01 10:00:00",
            assigned_staff_user_id: "7",
            status: "completed"
          }], []];
        }
        writes += 1;
        return [{ affectedRows: 1 }, []];
      }
    }
  });

  const response = await fetch(`${url}/crm/follow-ups/18`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "completed" })
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "FOLLOWUP_TERMINAL",
      message: "Completed or cancelled follow-ups cannot be changed."
    }
  });
  assert.equal(writes, 0);
});

test("repeated cancelled status patches are rejected", async () => {
  let writes = 0;
  const url = await startFollowupServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql) {
        if (sql.includes("SELECT id, due_at")) {
          return [[{
            id: "18",
            due_at: "2030-01-01 10:00:00",
            assigned_staff_user_id: "7",
            status: "cancelled"
          }], []];
        }
        writes += 1;
        return [{ affectedRows: 1 }, []];
      }
    }
  });

  const response = await fetch(`${url}/crm/follow-ups/18`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "cancelled" })
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "FOLLOWUP_TERMINAL",
      message: "Completed or cancelled follow-ups cannot be changed."
    }
  });
  assert.equal(writes, 0);
});

test("cancelled follow-ups reject staff reassignment attempts", async () => {
  let writes = 0;
  const url = await startFollowupServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql) {
        if (sql.includes("SELECT id, due_at")) {
          return [[{
            id: "18",
            due_at: "2030-01-01 10:00:00",
            assigned_staff_user_id: "7",
            status: "cancelled"
          }], []];
        }
        writes += 1;
        return [{ affectedRows: 1 }, []];
      }
    }
  });

  const response = await fetch(`${url}/crm/follow-ups/18`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignedStaffUserId: "8" })
  });

  assert.equal(response.status, 409);
  assert.equal(writes, 0);
});

test("terminal follow-ups cannot transition to pending or another terminal status", async (t) => {
  for (const [currentStatus, requestedStatus] of [
    ["completed", "pending"],
    ["completed", "cancelled"],
    ["cancelled", "pending"],
    ["cancelled", "completed"]
  ]) {
    await t.test(`${currentStatus} to ${requestedStatus}`, async () => {
      let writes = 0;
      const url = await startFollowupServer({
        principal: ownerPrincipal,
        pool: {
          async execute(sql) {
            if (sql.includes("SELECT id, due_at")) {
              return [[{
                id: "18",
                due_at: "2030-01-01 10:00:00",
                assigned_staff_user_id: "7",
                status: currentStatus
              }], []];
            }
            writes += 1;
            return [{ affectedRows: 1 }, []];
          }
        }
      });

      const response = await fetch(`${url}/crm/follow-ups/18`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: requestedStatus })
      });

      assert.equal(response.status, 409);
      assert.equal(writes, 0);
    });
  }
});
