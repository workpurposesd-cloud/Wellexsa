import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { createApp } from "../src/app.js";
import {
  assertIntegrationDatabaseConfig,
  loadDatabaseConfig
} from "../src/config/database.js";
import { loadEnv } from "../src/config/env.js";
import { createPoolManager } from "../src/database/pool.js";
import { resolvePrincipal } from "../src/middleware/authorize.js";
import { createVerifyFirebaseToken } from "../src/middleware/verifyFirebaseToken.js";
import { loadMigrations, validateMigrationHistory } from "../src/database/migration-runner.js";
import { fileURLToPath } from "node:url";

const INTEGRATION_TOKEN = "wellexsa-local-integration-token";

assert.equal(
  process.env.WELLEXSA_INTEGRATION_TESTS,
  "YES",
  "Set WELLEXSA_INTEGRATION_TESTS=YES only in the isolated integration environment."
);

const databaseConfig = loadDatabaseConfig();
assertIntegrationDatabaseConfig(databaseConfig, process.env);

const poolManager = createPoolManager({ configLoader: () => databaseConfig });
const ownerUid = `integration-owner-${randomUUID()}`;
let server;
let ownerInserted = false;
let baseUrl;

function assertDisposableMigrationHistory(records, migrations) {
  const appliedCount = validateMigrationHistory(migrations, records);
  assert.equal(appliedCount, migrations.length, "Apply all reviewed migrations to the disposable database first.");
}

before(async () => {
  const pool = poolManager.getPool();
  const [[databaseRow]] = await pool.execute("SELECT DATABASE() AS database_name");
  assert.equal(databaseRow.database_name, databaseConfig.database);

  const migrationDirectory = fileURLToPath(
    new URL("../../database/migrations", import.meta.url)
  );
  const migrations = await loadMigrations(migrationDirectory);
  const [records] = await pool.execute(
    "SELECT version, checksum_sha256, status FROM schema_migrations ORDER BY version"
  );
  assertDisposableMigrationHistory(records, migrations);

  const [roleRows] = await pool.execute(
    "SELECT id, code FROM roles WHERE code IN ('owner', 'staff', 'customer')"
  );
  const ownerRole = roleRows.find((row) => row.code === "owner");
  assert.ok(ownerRole, "Apply the reviewed reference seed to the disposable database first.");
  assert.ok(roleRows.some((row) => row.code === "staff"));
  assert.ok(roleRows.some((row) => row.code === "customer"));

  await pool.execute(
    `INSERT INTO users (
       firebase_uid, email, display_name, email_verified_at, primary_role_id
     ) VALUES (?, ?, 'Disposable integration owner', UTC_TIMESTAMP(6), ?)`,
    [ownerUid, `${ownerUid}@example.invalid`, ownerRole.id]
  );
  ownerInserted = true;

  const config = loadEnv();
  const verifyToken = createVerifyFirebaseToken(async (token) => {
    if (token !== INTEGRATION_TOKEN) throw new Error("Invalid local integration token.");
    return { uid: ownerUid };
  });
  const app = createApp(config, {
    getPool: poolManager.getPool,
    withTransaction: poolManager.withTransaction,
    verifyToken,
    principalResolver: resolvePrincipal
  });
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
      server.closeAllConnections();
    });
  }
  try {
    if (ownerInserted) {
      await poolManager.getPool().execute(
        "DELETE FROM users WHERE firebase_uid = ?",
        [ownerUid]
      );
    }
  } finally {
    await poolManager.close();
  }
});

test("API health endpoint responds without database or Firebase access", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("public catalogue endpoint reads the migrated MySQL schema", async () => {
  const response = await fetch(`${baseUrl}/api/catalog/bikes`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(Array.isArray(payload.data.bikes));
  assert.equal(payload.data.pagination.page, 1);
  assert.equal(payload.data.pagination.pageSize, 25);
  assert.ok(Number.isInteger(payload.data.pagination.total));
});

test("CRM authentication and role resolution use the disposable MySQL database", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/crm/customers`);
  assert.equal(unauthenticated.status, 401);

  const response = await fetch(`${baseUrl}/api/me`, {
    headers: { Authorization: `Bearer ${INTEGRATION_TOKEN}` }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.user.uid, ownerUid);
  assert.equal(payload.data.user.role, "owner");
  assert.ok(payload.data.user.permissions.includes("crm.customers.read.all"));
});
