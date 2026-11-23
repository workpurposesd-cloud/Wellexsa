import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadMigrations,
  runMigrations,
  validateMigrationHistory
} from "../src/database/migration-runner.js";

const expectedColumns = [
  ["version", "varchar(64)", "NO", 64],
  ["checksum_sha256", "char(64)", "NO", 64],
  ["status", "enum('running','applied','failed')", "NO", null],
  ["started_at", "datetime(6)", "NO", null],
  ["applied_at", "datetime(6)", "YES", null],
  ["applied_by", "varchar(128)", "NO", 128],
  ["error_code", "varchar(64)", "YES", 64]
].map(([COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH]) => ({
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  CHARACTER_MAXIMUM_LENGTH,
  CHARACTER_SET_NAME: COLUMN_NAME === "checksum_sha256" ? "ascii" : "utf8mb4",
  COLLATION_NAME: COLUMN_NAME === "checksum_sha256" ? "ascii_bin" : "utf8mb4_0900_ai_ci"
}));

function createFakeConnection({ tables = [], records = [], failMigration = false } = {}) {
  const state = {
    tables: new Set(tables),
    records: records.map((record) => ({ ...record })),
    ledgerExists: tables.includes("schema_migrations"),
    executedMigrations: [],
    failMigration
  };

  return {
    state,
    async query(sql, parameters = []) {
      if (sql.includes("SELECT ENGINE FROM information_schema.TABLES")) {
        return [state.ledgerExists ? [{ ENGINE: "InnoDB" }] : [], []];
      }
      if (sql.includes("FROM information_schema.TABLES") && sql.includes("TABLE_NAME = ?")) {
        return [state.ledgerExists ? [{ TABLE_NAME: "schema_migrations" }] : [], []];
      }
      if (sql.includes("FROM information_schema.TABLES") && sql.includes("TABLE_NAME IN (?)")) {
        const existing = parameters[0].filter((name) => state.tables.has(name));
        return [existing.map((TABLE_NAME) => ({ TABLE_NAME })), []];
      }
      if (sql.includes("FROM information_schema.TABLES")) {
        return [[...state.tables].map((TABLE_NAME) => ({ TABLE_NAME })), []];
      }
      if (sql.includes("FROM information_schema.COLUMNS")) {
        return [state.ledgerExists ? expectedColumns : [], []];
      }
      if (sql.includes("FROM information_schema.KEY_COLUMN_USAGE")) {
        return [[{ COLUMN_NAME: "version" }], []];
      }
      if (sql.includes("FROM information_schema.TABLE_CONSTRAINTS")) {
        return [[{ CONSTRAINT_NAME: "chk_schema_migrations_state" }], []];
      }
      if (sql.startsWith("SELECT version, checksum_sha256, status")) {
        return [state.records.map((record) => ({ ...record })), []];
      }
      if (sql.startsWith("INSERT INTO schema_migrations")) {
        const [version, checksum, ...rest] = parameters;
        const status = sql.includes("'running'") ? "running" : "applied";
        state.records.push({
          version,
          checksum_sha256: checksum,
          status,
          error_code: null,
          applied_by: rest[0]
        });
        state.ledgerExists = true;
        state.tables.add("schema_migrations");
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith("UPDATE schema_migrations")) {
        const isFailed = sql.includes("status = 'failed'");
        const version = isFailed ? parameters[1] : parameters[0];
        const record = state.records.find((row) => row.version === version);
        if (!record || record.status !== "running") return [{ affectedRows: 0 }, []];
        record.status = isFailed ? "failed" : "applied";
        if (isFailed) record.error_code = parameters[0];
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) {
        state.ledgerExists = true;
        state.tables.add("schema_migrations");
        state.executedMigrations.push("000_schema_migrations");
        return [[], []];
      }
      if (sql.includes("CREATE TABLE roles")) {
        state.executedMigrations.push("001_initial_schema");
        if (state.failMigration) {
          const error = new Error("SQL details should not escape.");
          error.code = "ER_PARSE_ERROR";
          throw error;
        }
        state.tables.add("roles");
        return [[], []];
      }
      throw new Error(`Unexpected fake query: ${sql}`);
    }
  };
}

function migration(version, checksum, sql = "") {
  const migrationSql = version === "000_schema_migrations" && !sql
    ? "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) NOT NULL);"
    : sql;
  return { version, checksum, sql: migrationSql };
}

test("loads ordered migration files with SHA-256 checksums", async () => {
  const migrationDirectory = fileURLToPath(new URL("../../database/migrations", import.meta.url));
  const migrations = await loadMigrations(migrationDirectory);
  assert.deepEqual(migrations.map((item) => item.version), [
    "000_schema_migrations",
    "001_initial_schema"
  ]);
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
});

test("runner rejects a checksum mismatch before executing SQL", async () => {
  const migrations = [
    migration("000_schema_migrations", "current"),
    migration("001_initial_schema", "schema")
  ];
  const connection = createFakeConnection({
    tables: ["schema_migrations"],
    records: [{
      version: "000_schema_migrations",
      checksum_sha256: "old",
      status: "applied"
    }]
  });

  await assert.rejects(runMigrations(connection, migrations), /Checksum mismatch/);
  assert.deepEqual(connection.state.executedMigrations, []);
});

test("runner refuses an existing empty ledger instead of replaying bootstrap", async () => {
  const migrations = [
    migration("000_schema_migrations", "zero"),
    migration("001_initial_schema", "one")
  ];
  const connection = createFakeConnection({ tables: ["schema_migrations"] });

  await assert.rejects(runMigrations(connection, migrations), /no bootstrap history/);
  assert.deepEqual(connection.state.executedMigrations, []);
});

test("runner stops on a previous running or failed migration", async (t) => {
  for (const status of ["running", "failed"]) {
    await t.test(status, async () => {
      const migrations = [
        migration("000_schema_migrations", "zero"),
        migration("001_initial_schema", "one")
      ];
      const connection = createFakeConnection({
        tables: ["schema_migrations", "roles"],
        records: [
          { version: "000_schema_migrations", checksum_sha256: "zero", status: "applied" },
          { version: "001_initial_schema", checksum_sha256: "one", status }
        ]
      });

      await assert.rejects(runMigrations(connection, migrations), new RegExp(status));
      assert.deepEqual(connection.state.executedMigrations, []);
    });
  }
});

test("runner detects untracked tables from a partially applied migration", async () => {
  const migrations = [
    migration("000_schema_migrations", "zero"),
    migration("001_initial_schema", "one", "CREATE TABLE roles (id INT);")
  ];
  const connection = createFakeConnection({
    tables: ["schema_migrations", "roles"],
    records: [{
      version: "000_schema_migrations",
      checksum_sha256: "zero",
      status: "applied"
    }]
  });

  await assert.rejects(runMigrations(connection, migrations), /untracked table roles/);
  assert.deepEqual(connection.state.executedMigrations, []);
});

test("runner records failed execution and refuses to rerun it", async () => {
  const migrations = [
    migration("000_schema_migrations", "zero"),
    migration("001_initial_schema", "one", "CREATE TABLE roles (id INT);")
  ];
  const connection = createFakeConnection({ failMigration: true });

  await assert.rejects(runMigrations(connection, migrations), /marked failed/);
  assert.equal(connection.state.records[1].status, "failed");
  assert.equal(connection.state.records[1].error_code, "ER_PARSE_ERROR");

  await assert.rejects(runMigrations(connection, migrations), /failed/);
  assert.deepEqual(connection.state.executedMigrations, [
    "000_schema_migrations",
    "001_initial_schema"
  ]);
});

test("runner applies pending migrations and treats an applied rerun as a no-op", async () => {
  const migrations = [
    migration("000_schema_migrations", "zero"),
    migration("001_initial_schema", "one", "CREATE TABLE roles (id INT);")
  ];
  const connection = createFakeConnection();

  assert.deepEqual(await runMigrations(connection, migrations), { appliedCount: 2 });
  assert.deepEqual(await runMigrations(connection, migrations), { appliedCount: 2 });
  assert.deepEqual(connection.state.executedMigrations, [
    "000_schema_migrations",
    "001_initial_schema"
  ]);
});

test("history validator rejects gaps and unknown database migrations", () => {
  const migrations = [
    migration("000_schema_migrations", "zero"),
    migration("001_initial_schema", "one")
  ];

  assert.throws(() => validateMigrationHistory(migrations, [
    { version: "001_initial_schema", checksum_sha256: "one", status: "applied" }
  ]), /out of order/);
  assert.throws(() => validateMigrationHistory(migrations, [
    { version: "999_unknown", checksum_sha256: "x", status: "applied" }
  ]), /unknown migration/);
});
