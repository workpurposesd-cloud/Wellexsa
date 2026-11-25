import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, before } from "node:test";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createVerifyFirebaseToken } from "../src/middleware/verifyFirebaseToken.js";

const startupEnvironmentKeys = [
  "NODE_ENV",
  "PORT",
  "CORS_ORIGINS",
  "FIREBASE_PROJECT_ID",
  "WELLEXSA_USE_AUTH_EMULATOR",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "npm_lifecycle_event"
];

function withStartupEnvironment(values, emulatorStartup, operation) {
  const previousEnvironment = new Map(
    startupEnvironmentKeys.map((key) => [key, process.env[key]])
  );
  for (const key of startupEnvironmentKeys) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      process.env[key] = values[key];
    } else {
      delete process.env[key];
    }
  }

  process.env.npm_lifecycle_event = emulatorStartup ? "start:emulator" : "start";

  try {
    return operation();
  } finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

const validStartupEnvironment = {
  NODE_ENV: "development",
  PORT: "3100",
  CORS_ORIGINS: "http://localhost:5500",
  FIREBASE_PROJECT_ID: "test-firebase-project"
};

const app = createApp({
  corsOrigins: [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:5000"
  ]
}, {
  getPool: () => ({}),
  verifyToken: createVerifyFirebaseToken(async (token) => ({
    uid: token,
    email: `${token}@example.invalid`,
    email_verified: true
  })),
  principalResolver: async (_pool, auth) => {
    if (auth.uid === "account-inactive") {
      const error = new Error("Sensitive inactive-account detail.");
      error.statusCode = 403;
      error.code = "ACCOUNT_INACTIVE";
      throw error;
    }
    if (auth.uid === "email-not-verified") {
      const error = new Error("Sensitive email-verification detail.");
      error.statusCode = 403;
      error.code = "EMAIL_NOT_VERIFIED";
      throw error;
    }
    if (auth.uid === "profile-required") return null;
    if (auth.uid === "unknown-4xx") {
      const error = new Error("Sensitive database detail.");
      error.statusCode = 418;
      error.code = "INTERNAL_DATABASE_DETAIL";
      throw error;
    }
    if (auth.uid === "server-error") {
      const error = new Error("Sensitive SQL, credential, or stack detail.");
      error.statusCode = 500;
      error.code = "INTERNAL_DATABASE_DETAIL";
      throw error;
    }
    for (const status of [502, 503, 504]) {
      if (auth.uid === `server-error-${status}`) {
        const error = new Error(`Sensitive ${status} upstream detail.`);
        error.statusCode = status;
        error.code = "INTERNAL_DATABASE_DETAIL";
        throw error;
      }
    }
    return {
      uid: auth.uid,
      email: auth.email,
      displayName: "Test User",
      role: "customer",
      permissions: ["customer.profile.read.self"]
    };
  }
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

test("global error handler preserves explicit application 4xx codes", async (t) => {
  const cases = [
    ["account-inactive", "ACCOUNT_INACTIVE"],
    ["email-not-verified", "EMAIL_NOT_VERIFIED"],
    ["profile-required", "PROFILE_REQUIRED"]
  ];

  for (const [uid, code] of cases) {
    await t.test(code, async () => {
      const response = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${uid}` }
      });
      const body = await response.json();

      assert.equal(response.status, 403);
      assert.equal(body.error.code, code);
      assert.equal(JSON.stringify(body).includes("Sensitive"), false);
    });
  }
});

test("global error handler falls back for unknown 4xx and generic 5xx errors", async (t) => {
  await t.test("unknown 4xx", async () => {
    const response = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: "Bearer unknown-4xx" }
    });
    const body = await response.json();

    assert.equal(response.status, 418);
    assert.deepEqual(body, {
      error: {
        code: "REQUEST_ERROR",
        message: "The request could not be processed."
      }
    });
  });

  await t.test("unexpected 5xx", async () => {
    const response = await fetch(`${baseUrl}/api/me`, {
      headers: { Authorization: "Bearer server-error" }
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error."
      }
    });
    assert.equal(JSON.stringify(body).includes("Sensitive"), false);
  });

  for (const status of [502, 503, 504]) {
    await t.test(`${status} preserves status and uses generic 5xx code`, async () => {
      const response = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer server-error-${status}` }
      });
      const body = await response.json();

      assert.equal(response.status, status);
      assert.deepEqual(body, {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Internal server error."
        }
      });
      assert.equal(JSON.stringify(body).includes("Sensitive"), false);
    });
  }
});

test("CORS allows the local Hosting Emulator origin and omits headers for others", async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "http://127.0.0.1:5000" }
  });
  const deniedLoopback = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "http://localhost:5000" }
  });
  const deniedRemote = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://unauthorized.example" }
  });
  const existingAllowed = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "http://localhost:5500" }
  });

  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://127.0.0.1:5000");
  assert.equal(deniedLoopback.headers.get("access-control-allow-origin"), null);
  assert.equal(deniedRemote.headers.get("access-control-allow-origin"), null);
  assert.equal(existingAllowed.headers.get("access-control-allow-origin"), "http://localhost:5500");
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
    firebaseProjectId: "test-firebase-project",
    firebaseAuthEmulatorEnabled: false
  });
});

test("normal startup accepts configuration without emulator variables", () => {
  withStartupEnvironment(validStartupEnvironment, false, () => {
    assert.equal(loadEnv().firebaseAuthEmulatorEnabled, false);
  });
  withStartupEnvironment({
    ...validStartupEnvironment,
    WELLEXSA_USE_AUTH_EMULATOR: "false"
  }, false, () => {
    assert.equal(loadEnv().firebaseAuthEmulatorEnabled, false);
  });
});

test("normal startup rejects an inherited emulator opt-in", () => {
  withStartupEnvironment({
    ...validStartupEnvironment,
    WELLEXSA_USE_AUTH_EMULATOR: "true"
  }, false, () => {
    assert.throws(
      () => loadEnv(),
      /available only through the emulator startup script/
    );
  });
});

test("normal startup rejects an inherited emulator host", () => {
  withStartupEnvironment({
    ...validStartupEnvironment,
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099"
  }, false, () => {
    assert.throws(() => loadEnv(), /requires WELLEXSA_USE_AUTH_EMULATOR=true/);
  });
});

test("emulator startup accepts explicit opt-in and the exact loopback host", () => {
  withStartupEnvironment({
    ...validStartupEnvironment,
    WELLEXSA_USE_AUTH_EMULATOR: "true",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099"
  }, true, () => {
    assert.equal(loadEnv().firebaseAuthEmulatorEnabled, true);
  });
});

test("emulator startup rejects a missing opt-in or invalid host", () => {
  withStartupEnvironment({
    ...validStartupEnvironment,
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099"
  }, true, () => {
    assert.throws(() => loadEnv(), /requires WELLEXSA_USE_AUTH_EMULATOR=true/);
  });
  withStartupEnvironment({
    ...validStartupEnvironment,
    WELLEXSA_USE_AUTH_EMULATOR: "true",
    FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099"
  }, true, () => {
    assert.throws(() => loadEnv(), /FIREBASE_AUTH_EMULATOR_HOST must be exactly/);
  });
});

test("emulator startup rejects production environments", () => {
  withStartupEnvironment({
    ...validStartupEnvironment,
    NODE_ENV: "production",
    CORS_ORIGINS: "https://wellexsa.example",
    WELLEXSA_USE_AUTH_EMULATOR: "true",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099"
  }, true, () => {
    assert.throws(() => loadEnv(), /not allowed in production/);
  });
});
