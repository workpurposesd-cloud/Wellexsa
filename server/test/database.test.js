import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIntegrationDatabaseConfig,
  DISPOSABLE_MYSQL_DATABASE_NAME,
  loadDatabaseConfig,
  loadMigrationDatabaseConfig
} from "../src/config/database.js";
import {
  checkDatabaseConnection,
  inspectDatabaseConnection
} from "../src/database/health.js";
import { createPoolManager } from "../src/database/pool.js";

const validEnvironment = {
  MYSQL_HOST: "127.0.0.1",
  MYSQL_PORT: "3306",
  MYSQL_DATABASE: "wellexsa",
  MYSQL_USER: "wellexsa_app",
  MYSQL_PASSWORD: "local-test-password"
};

test("loads valid database settings and safe pool defaults", () => {
  assert.deepEqual(loadDatabaseConfig(validEnvironment), {
    host: "127.0.0.1",
    port: 3306,
    database: "wellexsa",
    user: "wellexsa_app",
    password: "local-test-password",
    connectionLimit: 10,
    connectTimeout: 10000,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true
  });
});

test("migration configuration requires distinct migration credentials", () => {
  assert.deepEqual(loadMigrationDatabaseConfig({
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3306",
    MYSQL_DATABASE: DISPOSABLE_MYSQL_DATABASE_NAME,
    MYSQL_USER: "wellexsa_it_app",
    MYSQL_MIGRATION_USER: "wellexsa_it_migrator",
    MYSQL_MIGRATION_PASSWORD: "migration-test-secret"
  }), {
    host: "127.0.0.1",
    port: 3306,
    database: DISPOSABLE_MYSQL_DATABASE_NAME,
    user: "wellexsa_it_migrator",
    password: "migration-test-secret",
    connectTimeout: 10000,
    timezone: "Z"
  });
  assert.throws(() => loadMigrationDatabaseConfig(validEnvironment), /MYSQL_MIGRATION_USER/);
});

test("migration configuration rejects identical application and migration usernames", () => {
  assert.throws(
    () => loadMigrationDatabaseConfig({
      MYSQL_HOST: "127.0.0.1",
      MYSQL_PORT: "3306",
      MYSQL_DATABASE: DISPOSABLE_MYSQL_DATABASE_NAME,
      MYSQL_USER: "wellexsa_it_migrator",
      MYSQL_MIGRATION_USER: "wellexsa_it_migrator",
      MYSQL_MIGRATION_PASSWORD: "migration-test-secret"
    }),
    /must be different from MYSQL_USER/
  );
});

for (const username of [
  "root",
  "wellexsa_app",
  "wellexsa_it_app",
  "wellexsa_it_other",
  "wellexsa_migrator"
]) {
  test(`migration configuration rejects username ${username}`, () => {
    assert.throws(
      () => loadMigrationDatabaseConfig({
        MYSQL_HOST: "127.0.0.1",
        MYSQL_PORT: "3306",
        MYSQL_DATABASE: DISPOSABLE_MYSQL_DATABASE_NAME,
        MYSQL_USER: "wellexsa_it_app",
        MYSQL_MIGRATION_USER: username,
        MYSQL_MIGRATION_PASSWORD: "migration-test-secret"
      }),
      /MYSQL_MIGRATION_USER must be exactly wellexsa_it_migrator/
    );
  });
}

test("integration database guard rejects another database", () => {
  assert.throws(
    () => assertIntegrationDatabaseConfig({
      host: "127.0.0.1",
      port: 3306,
      database: "wellexsa",
      user: "wellexsa_it_app"
    }, {
      WELLEXSA_INTEGRATION_TESTS: "YES",
      NODE_ENV: "test",
      WELLEXSA_TEST_DATABASE: "wellexsa"
    }),
    /MYSQL_DATABASE must be exactly/
  );
});

test("integration database guard rejects another host", () => {
  assert.throws(
    () => assertIntegrationDatabaseConfig({
      host: "db.example.invalid",
      port: 3306,
      database: DISPOSABLE_MYSQL_DATABASE_NAME,
      user: "wellexsa_it_app"
    }, {
      WELLEXSA_INTEGRATION_TESTS: "YES",
      NODE_ENV: "test",
      WELLEXSA_TEST_DATABASE: DISPOSABLE_MYSQL_DATABASE_NAME
    }),
    /only to local MySQL/
  );
});

test("integration database guard accepts port 3306", () => {
  assert.doesNotThrow(
    () => assertIntegrationDatabaseConfig({
      host: "127.0.0.1",
      port: 3306,
      database: DISPOSABLE_MYSQL_DATABASE_NAME,
      user: "wellexsa_it_app"
    }, {
      WELLEXSA_INTEGRATION_TESTS: "YES",
      NODE_ENV: "test",
      WELLEXSA_TEST_DATABASE: DISPOSABLE_MYSQL_DATABASE_NAME
    })
  );
});

for (const port of [undefined, 3307, 33060, "3306"]) {
  test(`integration database guard rejects port ${String(port)}`, () => {
    assert.throws(
      () => assertIntegrationDatabaseConfig({
        host: "127.0.0.1",
        port,
        database: DISPOSABLE_MYSQL_DATABASE_NAME,
        user: "wellexsa_it_app"
      }, {
        WELLEXSA_INTEGRATION_TESTS: "YES",
        NODE_ENV: "test",
        WELLEXSA_TEST_DATABASE: DISPOSABLE_MYSQL_DATABASE_NAME
      }),
      /MYSQL_PORT=3306/
    );
  });
}

test("integration database guard accepts the exact application username", () => {
  assert.doesNotThrow(
    () => assertIntegrationDatabaseConfig({
      host: "127.0.0.1",
      port: 3306,
      database: DISPOSABLE_MYSQL_DATABASE_NAME,
      user: "wellexsa_it_app"
    }, {
      WELLEXSA_INTEGRATION_TESTS: "YES",
      NODE_ENV: "test",
      WELLEXSA_TEST_DATABASE: DISPOSABLE_MYSQL_DATABASE_NAME
    })
  );
});

for (const username of [
  "wellexsa_it_migrator",
  "wellexsa_app",
  "wellexsa_it_other",
  "root"
]) {
  test(`integration database guard rejects username ${username}`, () => {
    assert.throws(
      () => assertIntegrationDatabaseConfig({
        host: "127.0.0.1",
        port: 3306,
        database: DISPOSABLE_MYSQL_DATABASE_NAME,
        user: username
      }, {
        WELLEXSA_INTEGRATION_TESTS: "YES",
        NODE_ENV: "test",
        WELLEXSA_TEST_DATABASE: DISPOSABLE_MYSQL_DATABASE_NAME
      }),
      /dedicated integration app account/
    );
  });
}

for (const setting of [
  "MYSQL_HOST",
  "MYSQL_DATABASE",
  "MYSQL_USER",
  "MYSQL_PASSWORD"
]) {
  test(`rejects a missing ${setting}`, () => {
    const config = { ...validEnvironment };
    delete config[setting];
    assert.throws(() => loadDatabaseConfig(config), new RegExp(setting));
  });
}

test("rejects invalid database ports", () => {
  const missingPort = { ...validEnvironment };
  delete missingPort.MYSQL_PORT;
  assert.throws(
    () => loadDatabaseConfig(missingPort),
    /MYSQL_PORT must be an integer between 1 and 65535/
  );

  for (const port of ["not-a-port", "0", "65536", "3306.5", ""]) {
    assert.throws(
      () => loadDatabaseConfig({ ...validEnvironment, MYSQL_PORT: port }),
      /MYSQL_PORT must be an integer between 1 and 65535/
    );
  }
});

test("configuration errors do not include password values", () => {
  const config = {
    ...validEnvironment,
    MYSQL_PASSWORD: "secret-that-must-not-leak",
    MYSQL_HOST: " "
  };
  assert.throws(() => loadDatabaseConfig(config), (error) => {
    assert.match(error.message, /MYSQL_HOST/);
    assert.equal(error.message.includes(config.MYSQL_PASSWORD), false);
    return true;
  });
});

test("pool manager lazily creates and reuses a pool with configured options", async () => {
  let factoryCalls = 0;
  let closeCalls = 0;
  let receivedOptions;
  const pool = {
    async end() {
      closeCalls += 1;
    }
  };
  const manager = createPoolManager({
    configLoader: () => loadDatabaseConfig({
      ...validEnvironment,
      MYSQL_CONNECTION_LIMIT: "7",
      MYSQL_CONNECT_TIMEOUT: "4500"
    }),
    poolFactory(options) {
      factoryCalls += 1;
      receivedOptions = options;
      return pool;
    }
  });

  assert.equal(factoryCalls, 0);
  assert.strictEqual(manager.getPool(), pool);
  assert.strictEqual(manager.getPool(), pool);
  assert.equal(factoryCalls, 1);
  assert.deepEqual(receivedOptions, {
    host: "127.0.0.1",
    port: 3306,
    database: "wellexsa",
    user: "wellexsa_app",
    password: "local-test-password",
    connectionLimit: 7,
    connectTimeout: 4500,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true
  });

  await manager.close();
  assert.equal(factoryCalls, 1);
  assert.equal(closeCalls, 1);
});

test("transactions commit and release their connection", async () => {
  const events = [];
  const connection = {
    async beginTransaction() {
      events.push("begin");
    },
    async commit() {
      events.push("commit");
    },
    async rollback() {
      events.push("rollback");
    },
    release() {
      events.push("release");
    }
  };
  const manager = createPoolManager({
    configLoader: () => ({}),
    poolFactory: () => ({
      async getConnection() {
        events.push("acquire");
        return connection;
      }
    })
  });

  const result = await manager.withTransaction(async (transactionConnection) => {
    assert.strictEqual(transactionConnection, connection);
    events.push("operation");
    return "committed";
  });

  assert.equal(result, "committed");
  assert.deepEqual(events, ["acquire", "begin", "operation", "commit", "release"]);
});

test("failed transactions roll back and release their connection", async () => {
  const events = [];
  const operationError = new Error("operation failed");
  const connection = {
    async beginTransaction() {
      events.push("begin");
    },
    async commit() {
      events.push("commit");
    },
    async rollback() {
      events.push("rollback");
    },
    release() {
      events.push("release");
    }
  };
  const manager = createPoolManager({
    configLoader: () => ({}),
    poolFactory: () => ({
      async getConnection() {
        return connection;
      }
    })
  });

  await assert.rejects(
    manager.withTransaction(async () => {
      throw operationError;
    }),
    (error) => error === operationError
  );
  assert.deepEqual(events, ["begin", "rollback", "release"]);
});

test("importing the pool module does not require configuration or create a pool", async () => {
  const poolModule = await import("../src/database/pool.js?lazy-import-check");
  assert.equal(typeof poolModule.getDatabasePool, "function");
  assert.equal(typeof poolModule.closeDatabasePool, "function");
});

test("database connectivity check issues only SELECT 1", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return [[{ 1: 1 }], []];
    }
  };

  assert.equal(await checkDatabaseConnection(pool), true);
  assert.deepEqual(queries, ["SELECT 1"]);
});

test("database inspection checks the server version and connectivity", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return sql.startsWith("SELECT VERSION()")
        ? [[{ version: "8.0.42" }], []]
        : [[{ ok: 1 }], []];
    }
  };

  assert.deepEqual(await inspectDatabaseConnection(pool), { version: "8.0.42" });
  assert.deepEqual(queries, ["SELECT VERSION() AS version", "SELECT 1 AS ok"]);
});

test("database connectivity errors do not expose credentials", async () => {
  const pool = {
    async query() {
      throw new Error("MYSQL_PASSWORD=private-test-secret");
    }
  };

  await assert.rejects(checkDatabaseConnection(pool), (error) => {
    assert.equal(error.message, "Database connectivity check failed.");
    assert.equal(error.message.includes("private-test-secret"), false);
    return true;
  });
});

test("database inspection failures use a safe message", async () => {
  const pool = {
    async query() {
      throw new Error("MYSQL_PASSWORD=private-test-secret");
    }
  };

  await assert.rejects(inspectDatabaseConnection(pool), (error) => {
    assert.equal(error.message, "Database connectivity check failed.");
    assert.equal(error.message.includes("private-test-secret"), false);
    return true;
  });
});
