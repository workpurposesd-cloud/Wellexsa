import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test, { afterEach } from "node:test";
import { createVerifyFirebaseToken } from "../src/middleware/verifyFirebaseToken.js";

const servers = new Set();

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  servers.clear();
});

async function startProtectedTestServer(verifyIdToken) {
  const app = express();
  app.use(express.json());
  app.all("/protected", createVerifyFirebaseToken(verifyIdToken), (request, response) => {
    response.json({ auth: request.auth });
  });
  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND" } });
  });

  const server = app.listen(0, "127.0.0.1");
  servers.add(server);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}/protected`;
}

async function assertUnauthorized(url, headers = {}) {
  const response = await fetch(url, { headers });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: "UNAUTHENTICATED",
      message: "Authentication required."
    }
  });
}

test("missing Authorization header returns 401", async () => {
  const url = await startProtectedTestServer(async () => {
    throw new Error("Token verification must not run.");
  });

  await assertUnauthorized(url);
});

test("malformed Authorization header returns 401", async () => {
  const url = await startProtectedTestServer(async () => {
    throw new Error("Token verification must not run.");
  });

  await assertUnauthorized(url, { Authorization: "Basic credentials" });
});

test("empty Bearer token returns 401", async () => {
  const url = await startProtectedTestServer(async () => {
    throw new Error("Token verification must not run.");
  });

  await assertUnauthorized(url, { Authorization: "Bearer " });
});

test("valid token uses revocation checking and populates auth only from verified claims", async () => {
  const verifiedToken = { uid: "verified-uid", email: "rider@example.com" };
  const calls = [];
  const url = await startProtectedTestServer(async (...args) => {
    calls.push(args);
    return verifiedToken;
  });
  const response = await fetch(`${url}?uid=attacker-uid&role=admin`, {
    headers: { Authorization: "Bearer valid-token" }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [["valid-token", true]]);
  assert.deepEqual(await response.json(), { auth: verifiedToken });
});

test("invalid token returns generic 401 without Firebase error details", async () => {
  const url = await startProtectedTestServer(async () => {
    throw new Error("token detail must not be exposed");
  });

  await assertUnauthorized(url, { Authorization: "Bearer invalid-token" });
});

test("revoked token returns generic 401 without Firebase error details", async () => {
  const url = await startProtectedTestServer(async (_token, checkRevoked) => {
    assert.equal(checkRevoked, true);
    throw new Error("revocation detail must not be exposed");
  });

  await assertUnauthorized(url, { Authorization: "Bearer revoked-token" });
});
