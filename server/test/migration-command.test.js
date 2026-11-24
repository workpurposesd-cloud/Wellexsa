import assert from "node:assert/strict";
import test from "node:test";
import {
  DISPOSABLE_MYSQL_DATABASE_NAME,
  loadMigrationDatabaseConfig
} from "../src/config/database.js";
import {
  getConfirmedDatabase,
  runMigrationCommand
} from "../scripts/migrate.js";

const target = DISPOSABLE_MYSQL_DATABASE_NAME;

test("accepts only the exact disposable database with matching confirmation", () => {
  assert.equal(getConfirmedDatabase(["--confirm-database", target], target), target);
});

for (const database of ["wellexsa", "wellexsa_it_another", "development"]) {
  test(`rejects migration target ${database}`, () => {
    assert.throws(
      () => getConfirmedDatabase(["--confirm-database", database], database),
      /must be exactly/
    );
  });
}

test("rejects a mismatched database confirmation", () => {
  assert.throws(
    () => getConfirmedDatabase(["--confirm-database", "wellexsa"], target),
    /Refusing to migrate/
  );
});

test("rejects extra confirmation arguments", () => {
  assert.throws(
    () => getConfirmedDatabase(["--confirm-database", target, "extra"], target),
    /Refusing to migrate/
  );
});

test("rejects extra confirmation arguments before database work", async () => {
  let migrationLoads = 0;
  let connectionAttempts = 0;
  let sqlExecutions = 0;

  await assert.rejects(
    runMigrationCommand({
      args: ["--confirm-database", target, "extra"],
      configLoader: () => ({ database: target, host: "127.0.0.1", port: 3306 }),
      migrationLoader: async () => {
        migrationLoads += 1;
        return [];
      },
      connectionFactory: async () => {
        connectionAttempts += 1;
        return { async query() { sqlExecutions += 1; } };
      }
    }),
    /Refusing to migrate/
  );

  assert.equal(migrationLoads, 0);
  assert.equal(connectionAttempts, 0);
  assert.equal(sqlExecutions, 0);
});

test("rejects incorrect port before migration loading or database work", async () => {
  let migrationLoads = 0;
  let connectionAttempts = 0;
  let sqlExecutions = 0;

  await assert.rejects(
    runMigrationCommand({
      args: ["--confirm-database", target],
      configLoader: () => ({ database: target, host: "127.0.0.1", port: 3307 }),
      migrationLoader: async () => {
        migrationLoads += 1;
        return [];
      },
      connectionFactory: async () => {
        connectionAttempts += 1;
        return { async query() { sqlExecutions += 1; } };
      }
    }),
    /MYSQL_PORT must be 3306/
  );

  assert.equal(migrationLoads, 0);
  assert.equal(connectionAttempts, 0);
  assert.equal(sqlExecutions, 0);
});

test("rejects identical migration and application usernames before database work", async () => {
  let migrationLoads = 0;
  let connectionAttempts = 0;
  let sqlExecutions = 0;

  await assert.rejects(
    runMigrationCommand({
      args: ["--confirm-database", target],
      configLoader: () => {
        throw new Error("MYSQL_MIGRATION_USER must be different from MYSQL_USER.");
      },
      migrationLoader: async () => {
        migrationLoads += 1;
        return [];
      },
      connectionFactory: async () => {
        connectionAttempts += 1;
        return { async query() { sqlExecutions += 1; } };
      }
    }),
    /must be different/
  );

  assert.equal(migrationLoads, 0);
  assert.equal(connectionAttempts, 0);
  assert.equal(sqlExecutions, 0);
});

test("rejects wrong migration username before migration loading or database work", async () => {
  let migrationLoads = 0;
  let connectionAttempts = 0;
  let sqlExecutions = 0;

  await assert.rejects(
    runMigrationCommand({
      args: ["--confirm-database", target],
      configLoader: () => loadMigrationDatabaseConfig({
        MYSQL_HOST: "127.0.0.1",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: target,
        MYSQL_USER: "wellexsa_it_app",
        MYSQL_MIGRATION_USER: "wellexsa_it_app",
        MYSQL_MIGRATION_PASSWORD: "migration-test-secret"
      }),
      migrationLoader: async () => {
        migrationLoads += 1;
        return [];
      },
      connectionFactory: async () => {
        connectionAttempts += 1;
        return { async query() { sqlExecutions += 1; } };
      }
    }),
    /MYSQL_MIGRATION_USER must be exactly/
  );

  assert.equal(migrationLoads, 0);
  assert.equal(connectionAttempts, 0);
  assert.equal(sqlExecutions, 0);
});

for (const args of [[], ["--confirm-database"]]) {
  test(`rejects missing confirmation arguments ${JSON.stringify(args)} before database work`, async () => {
    let migrationLoads = 0;
    let connectionAttempts = 0;
    let sqlExecutions = 0;

    await assert.rejects(
      runMigrationCommand({
        args,
        configLoader: () => ({
          database: target,
          host: "127.0.0.1"
        }),
        migrationLoader: async () => {
          migrationLoads += 1;
          return [];
        },
        connectionFactory: async () => {
          connectionAttempts += 1;
          return {
            async query() {
              sqlExecutions += 1;
            }
          };
        }
      }),
      /Refusing to migrate/
    );

    assert.equal(migrationLoads, 0);
    assert.equal(connectionAttempts, 0);
    assert.equal(sqlExecutions, 0);
  });
}

test("rejected targets do not load migrations, connect, or execute SQL", async (t) => {
  const rejectedConfigurations = [
    { database: "wellexsa", confirmation: "wellexsa", host: "127.0.0.1", port: 3306 },
    { database: "wellexsa_it_another", confirmation: "wellexsa_it_another", host: "127.0.0.1", port: 3306 },
    { database: target, confirmation: "wellexsa", host: "127.0.0.1", port: 3306 },
    { database: target, confirmation: target, host: "mysql.production.example", port: 3306 }
  ];

  for (const { database, confirmation, host, port } of rejectedConfigurations) {
    await t.test(`${database} at ${host} confirmed as ${confirmation}`, async () => {
      let migrationLoads = 0;
      let connectionAttempts = 0;
      let sqlExecutions = 0;

      await assert.rejects(
        runMigrationCommand({
          args: ["--confirm-database", confirmation],
          configLoader: () => ({ database, host, port }),
          migrationLoader: async () => {
            migrationLoads += 1;
            return [];
          },
          connectionFactory: async () => {
            connectionAttempts += 1;
            return {
              async query() {
                sqlExecutions += 1;
              }
            };
          }
        }),
        /Refusing to migrate|must be exactly|MYSQL_HOST must be/
      );

      assert.equal(migrationLoads, 0);
      assert.equal(connectionAttempts, 0);
      assert.equal(sqlExecutions, 0);
    });
  }
});
