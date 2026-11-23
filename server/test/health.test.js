import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

const app = createApp({
  corsOrigins: ["http://localhost:5500", "http://127.0.0.1:5500"]
});
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("GET /api/health reports API availability with security headers", async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("unknown routes return a JSON 404 without a stack trace", async () => {
  const response = await fetch(`${baseUrl}/api/unknown`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: {
      code: "NOT_FOUND",
      message: "Route not found."
    }
  });
  assert.equal(JSON.stringify(body).includes("stack"), false);
});

test("CORS allows configured origins and omits headers for others", async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "http://localhost:5500" }
  });
  const denied = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://unauthorized.example" }
  });

  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5500");
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("environment loading requires explicit, valid CORS origins", () => {
  assert.throws(() => loadEnv({}), /CORS_ORIGINS/);
  assert.throws(() => loadEnv({ CORS_ORIGINS: "*" }), /explicit HTTP or HTTPS origins/);
  assert.throws(() => loadEnv({ CORS_ORIGINS: "https://*.example.com" }), /explicit HTTP or HTTPS origins/);
  const requiredConfig = {
    NODE_ENV: "test",
    PORT: "3100",
    CORS_ORIGINS: "http://localhost:5500"
  };
  assert.throws(() => loadEnv(requiredConfig), /FIREBASE_PROJECT_ID/);
  assert.throws(() => loadEnv({ ...requiredConfig, FIREBASE_PROJECT_ID: " " }), /FIREBASE_PROJECT_ID/);
  assert.deepEqual(loadEnv({
    ...requiredConfig,
    FIREBASE_PROJECT_ID: "test-firebase-project"
  }), {
    nodeEnv: "test",
    port: 3100,
    corsOrigins: ["http://localhost:5500"],
    firebaseProjectId: "test-firebase-project"
  });
});
