import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { createAccountRouter } from "../src/routes/account.js";
import { createVerifyFirebaseToken } from "../src/middleware/verifyFirebaseToken.js";

const servers = new Set();

test.afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startAccountServer({ pool, principalResolver }) {
  const app = express();
  app.use(express.json());
  app.use(createAccountRouter({
    getPool: () => pool,
    verifyToken: createVerifyFirebaseToken(async () => ({
      uid: "firebase-uid",
      email: "rider@example.com",
      name: "Rider",
      email_verified: true,
      role: "owner"
    })),
    principalResolver
  }));
  const server = app.listen(0, "127.0.0.1");
  servers.add(server);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("profile sync rejects client-supplied role and permission fields", async () => {
  let databaseCalls = 0;
  const url = await startAccountServer({
    pool: {
      async execute() {
        databaseCalls += 1;
        return [{ affectedRows: 1 }, []];
      }
    },
    principalResolver: async () => null
  });

  const response = await fetch(`${url}/auth/sync`, {
    method: "POST",
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ role: "owner", permissions: ["crm.staff.manage"] })
  });

  assert.equal(response.status, 400);
  assert.equal(databaseCalls, 0);
});

test("profile sync creates a Customer mapping from verified Firebase claims only", async () => {
  const calls = [];
  const pool = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      return [{ affectedRows: 1 }, []];
    }
  };
  const principalResolver = async (_pool, auth) => ({
    uid: auth.uid,
    email: auth.email,
    displayName: auth.name,
    role: "customer",
    permissions: ["customer.profile.read.self"]
  });
  const url = await startAccountServer({ pool, principalResolver });

  const response = await fetch(`${url}/auth/sync`, {
    method: "POST",
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json"
    },
    body: "{}"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      user: {
        uid: "firebase-uid",
        email: "rider@example.com",
        displayName: "Rider",
        role: "customer",
        permissions: ["customer.profile.read.self"]
      }
    }
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /roles\.code = 'customer'/);
  assert.deepEqual(calls[0].parameters, ["firebase-uid", "rider@example.com", "Rider", 1]);
  assert.equal(calls[0].sql.includes("role ="), false);
});

test("GET /me requires a mapped MySQL profile", async () => {
  const url = await startAccountServer({
    pool: {},
    principalResolver: async () => null
  });

  const response = await fetch(`${url}/me`, {
    headers: { Authorization: "Bearer valid-token" }
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "PROFILE_REQUIRED",
      message: "A server-managed user profile is required."
    }
  });
});
