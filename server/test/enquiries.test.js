import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createEnquiryRouter } from "../src/routes/enquiries.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startEnquiryServer({
  principal,
  pool = { async execute() { return [[], []]; } },
  withTransaction = async (operation) => operation(pool),
  phoneEncryptor,
  phoneDecryptor
}) {
  const app = express();
  app.use(express.json());
  app.use(createEnquiryRouter({
    getPool: () => pool,
    withTransaction,
    phoneEncryptor,
    phoneDecryptor,
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
  permissions: ["crm.enquiries.read.assigned", "crm.enquiries.update.assigned"]
};

const ownerPrincipal = {
  id: "1",
  role: "owner",
  permissions: [
    "crm.enquiries.read.all",
    "crm.enquiries.update.all",
    "crm.enquiries.assign"
  ]
};

function enquiryRow(overrides = {}) {
  return {
    id: "32",
    request_id: "c1aa6629-8e33-4e8e-9af0-60721dce9f27",
    record_type: "public",
    customer_id: "12",
    customer_name_snapshot: "Rider",
    customer_email: "rider@example.com",
    bike_id: "5",
    bike_model_snapshot: "EU-1",
    assigned_staff_user_id: "7",
    status: "new",
    created_at: null,
    updated_at: null,
    ...overrides
  };
}

test("staff enquiry list is restricted to their assignments", async () => {
  const calls = [];
  const url = await startEnquiryServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return sql.includes("COUNT(*)")
          ? [[{ total: "1" }], []]
          : [[enquiryRow({
            phone_ciphertext: Buffer.from([1]),
            encryption_nonce: Buffer.from([2]),
            authentication_tag: Buffer.from([3]),
            encryption_key_version: 1
          })], []];
      }
    },
    phoneDecryptor: () => "+919876543210"
  });

  const response = await fetch(`${url}/crm/enquiries?status=new`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ parameters }) => parameters), [["7", "new"], ["7", "new", 25, 0]]);
  assert.equal(calls.every(({ sql }) => sql.includes("assigned_staff_user_id = ?")), true);
  assert.equal(body.data.enquiries[0].id, "32");
  assert.equal(body.data.enquiries[0].mobile, "+919876543210");
  assert.equal(JSON.stringify(body).includes("phone_ciphertext"), false);
});

test("staff enquiry detail cannot reveal unassigned enquiries", async () => {
  let call;
  const url = await startEnquiryServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql, parameters) {
        call = { sql, parameters };
        return [[], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/enquiries/32`);

  assert.equal(response.status, 404);
  assert.deepEqual(call.parameters, ["32", "7"]);
  assert.match(call.sql, /assigned_staff_user_id = \?/);
});

test("enquiry history checks assigned scope before returning status records", async () => {
  const calls = [];
  const url = await startEnquiryServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return sql.includes("SELECT id FROM enquiries")
          ? [[{ id: "32" }], []]
          : [[{
            id: "90",
            from_status: "new",
            to_status: "contacted",
            changed_by_user_id: "7",
            changed_at: null
          }], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/enquiries/32/history`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].parameters, ["32", "7"]);
  assert.deepEqual(calls[1].parameters, ["32"]);
  assert.equal(body.data.history[0].toStatus, "contacted");
});

test("Owner status change and history insert are atomic", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT id, status FROM enquiries")) {
        return [[{ id: "32", status: "new" }], []];
      }
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startEnquiryServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/enquiries/32`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "contacted" })
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].parameters, ["contacted", "32"]);
  assert.deepEqual(calls[2].parameters, ["32", "new", "contacted", "1"]);
  assert.match(calls[2].sql, /INSERT INTO enquiry_status_history/);
});

test("Owner reassignment validates active Staff and records the assignment change", async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("SELECT id, status FROM enquiries")) {
        return [[{ id: "32", status: "new" }], []];
      }
      if (sql.includes("FROM staff_profiles")) return [[{ user_id: "7" }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const url = await startEnquiryServer({
    principal: ownerPrincipal,
    pool: {},
    withTransaction: (operation) => operation(connection)
  });

  const response = await fetch(`${url}/crm/enquiries/32`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignedStaffUserId: "7" })
  });

  assert.equal(response.status, 200);
  assert.match(calls[1].sql, /FROM staff_profiles/);
  assert.match(calls[1].sql, /crm\.enquiries\.read\.assigned/);
  assert.deepEqual(calls[1].parameters, ["7"]);
  assert.deepEqual(calls[2].parameters, ["7", "32"]);
  assert.match(calls[2].sql, /assigned_staff_user_id = \?/);
  assert.match(calls[3].sql, /INSERT INTO activity_logs/);
});

test("enquiry update rejects unknown and phone-related fields", async () => {
  let transactions = 0;
  const url = await startEnquiryServer({
    principal: ownerPrincipal,
    withTransaction: async () => {
      transactions += 1;
    }
  });

  const response = await fetch(`${url}/crm/enquiries/32`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneCiphertext: "not-allowed" })
  });

  assert.equal(response.status, 400);
  assert.equal(transactions, 0);
});

test("Staff cannot reassign enquiries", async () => {
  let transactions = 0;
  const url = await startEnquiryServer({
    principal: staffPrincipal,
    withTransaction: async () => {
      transactions += 1;
    }
  });

  const response = await fetch(`${url}/crm/enquiries/32`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignedStaffUserId: "8" })
  });

  assert.equal(response.status, 403);
  assert.equal(transactions, 0);
});

test("public enquiry stores only encrypted phone fields and returns no contact details", async () => {
  const calls = [];
  const requestId = "c1aa6629-8e33-4e8e-9af0-60721dce9f27";
  const url = await startEnquiryServer({
    principal: null,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        if (sql.includes("FROM enquiries WHERE request_id")) return [[], []];
        if (sql.includes("FROM bikes")) return [[{ id: "5", name: "Bike", model: "EU-1" }], []];
        if (sql.includes("FROM staff_profiles")) return [[], []];
        return [{ insertId: "40" }, []];
      }
    },
    phoneEncryptor: () => ({
      ciphertext: Buffer.from([1, 2, 3]),
      nonce: Buffer.alloc(12, 4),
      authenticationTag: Buffer.alloc(16, 5),
      encryptionKeyVersion: 1,
      lookupHmac: Buffer.alloc(32, 6),
      lookupKeyVersion: 1
    })
  });

  const response = await fetch(`${url}/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      name: "Rider",
      email: "rider@example.com",
      phone: "+919876543210",
      bikeId: "5"
    })
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.data.requestId, requestId);
  assert.deepEqual(calls[1].parameters, ["5"]);
  const insert = calls.find(({ sql }) => sql.includes("INSERT INTO enquiries"));
  assert.equal(insert.parameters.includes("+919876543210"), false);
  assert.equal(insert.parameters.some(Buffer.isBuffer), true);
  assert.equal(insert.parameters[6], 1);
  assert.equal(insert.parameters[9], "5");
  assert.equal(insert.parameters[10], "EU-1");
  assert.equal(insert.parameters[11], null);
  assert.equal(JSON.stringify(body).includes("phone"), false);
});

test("public enquiry is idempotent for a matching request ID", async () => {
  const calls = [];
  const requestId = "c1aa6629-8e33-4e8e-9af0-60721dce9f27";
  const phoneLookupHmac = Buffer.alloc(32, 6);
  const url = await startEnquiryServer({
    principal: null,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        if (sql.includes("FROM enquiries WHERE request_id")) {
          return [[{
            customer_name_snapshot: "Rider",
            customer_email: null,
            bike_id: "5",
            phone_lookup_hmac: phoneLookupHmac,
            lookup_key_version: 1
          }], []];
        }
        return [[], []];
      }
    },
    phoneEncryptor: () => ({
      ciphertext: Buffer.from([1, 2, 3]),
      nonce: Buffer.alloc(12, 4),
      authenticationTag: Buffer.alloc(16, 5),
      encryptionKeyVersion: 1,
      lookupHmac: phoneLookupHmac,
      lookupKeyVersion: 1
    })
  });

  const response = await fetch(`${url}/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      name: "Rider",
      phone: "+919876543210",
      bikeId: "5"
    })
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.requestId, requestId);
  assert.equal(calls.length, 1);
});

test("public enquiry assigns to active Staff with assigned-read permission", async () => {
  const calls = [];
  const url = await startEnquiryServer({
    principal: null,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        if (sql.includes("FROM enquiries WHERE request_id")) return [[], []];
        if (sql.includes("FROM bikes")) return [[{ id: "5", name: "Bike", model: "EU-1" }], []];
        if (sql.includes("FROM staff_profiles")) return [[{ user_id: "7" }], []];
        return [{ insertId: "40" }, []];
      }
    },
    phoneEncryptor: () => ({
      ciphertext: Buffer.from([1, 2, 3]),
      nonce: Buffer.alloc(12, 4),
      authenticationTag: Buffer.alloc(16, 5),
      encryptionKeyVersion: 1,
      lookupHmac: Buffer.alloc(32, 6),
      lookupKeyVersion: 1
    })
  });

  const response = await fetch(`${url}/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: "c1aa6629-8e33-4e8e-9af0-60721dce9f27",
      name: "Rider",
      phone: "+919876543210",
      bikeId: "5"
    })
  });
  const assignmentQuery = calls.find(({ sql }) => sql.includes("FROM staff_profiles"));
  const insert = calls.find(({ sql }) => sql.includes("INSERT INTO enquiries"));

  assert.equal(response.status, 201);
  assert.match(assignmentQuery.sql, /crm\.enquiries\.read\.assigned/);
  assert.equal(insert.parameters[11], "7");
});

test("assigned Staff can read decrypted phone only for their enquiry", async () => {
  const calls = [];
  const url = await startEnquiryServer({
    principal: staffPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return [[enquiryRow({
          phone_ciphertext: Buffer.from([1]),
          encryption_nonce: Buffer.from([2]),
          authentication_tag: Buffer.from([3]),
          encryption_key_version: 1
        })], []];
      }
    },
    phoneDecryptor: () => "+919876543210"
  });

  const response = await fetch(`${url}/crm/enquiries/32`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.match(calls[0].sql, /e\.assigned_staff_user_id = \?/);
  assert.deepEqual(calls[0].parameters, ["32", "7"]);
  assert.equal(body.data.enquiry.mobile, "+919876543210");
  assert.equal(JSON.stringify(body).includes("phone_ciphertext"), false);
});

test("Owner can see an unassigned enquiry and its authorized contact details", async () => {
  const calls = [];
  const url = await startEnquiryServer({
    principal: ownerPrincipal,
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return sql.includes("COUNT(*)")
          ? [[{ total: "1" }], []]
          : [[enquiryRow({
            assigned_staff_user_id: null,
            phone_ciphertext: Buffer.from([1]),
            encryption_nonce: Buffer.from([2]),
            authentication_tag: Buffer.from([3]),
            encryption_key_version: 1
          })], []];
      }
    },
    phoneDecryptor: () => "+919876543210"
  });

  const response = await fetch(`${url}/crm/enquiries`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls.some(({ sql }) => /assigned_staff_user_id = \?/.test(sql)), false);
  assert.equal(body.data.enquiries[0].assignedStaffUserId, null);
  assert.equal(body.data.enquiries[0].mobile, "+919876543210");
});

test("Owner without all-read permission is limited to their assigned enquiries", async () => {
  const calls = [];
  const url = await startEnquiryServer({
    principal: {
      id: "1",
      role: "owner",
      permissions: ["crm.enquiries.read.assigned"]
    },
    pool: {
      async execute(sql, parameters) {
        calls.push({ sql, parameters });
        return sql.includes("COUNT(*)")
          ? [[{ total: "1" }], []]
          : [[enquiryRow({ assigned_staff_user_id: "1" })], []];
      }
    }
  });

  const response = await fetch(`${url}/crm/enquiries`);

  assert.equal(response.status, 200);
  assert.equal(calls.every(({ sql }) => sql.includes("assigned_staff_user_id = ?")), true);
  assert.equal(calls[0].parameters[0], "1");
});

test("public enquiry submission fails closed when phone encryption is unavailable", async () => {
  let databaseCalls = 0;
  const url = await startEnquiryServer({
    principal: null,
    pool: {
      async execute() {
        databaseCalls += 1;
        return [[], []];
      }
    },
    phoneEncryptor() {
      const error = new Error("configuration missing");
      error.code = "PHONE_CRYPTO_CONFIG";
      throw error;
    }
  });

  const response = await fetch(`${url}/enquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Rider",
      phone: "+919876543210",
      bikeId: "5"
    })
  });

  assert.equal(response.status, 503);
  assert.equal(databaseCalls, 0);
  assert.equal((await response.text()).includes("configuration missing"), false);
});
