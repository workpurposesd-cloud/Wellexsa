import { createConnection } from "mysql2/promise";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDisposableDatabaseName,
  loadMigrationDatabaseConfig
} from "../src/config/database.js";
import { loadMigrations, runMigrations } from "../src/database/migration-runner.js";

export function getConfirmedDatabase(args, configuredDatabase) {
  assertDisposableDatabaseName(configuredDatabase);
  if (
    args.length !== 2 ||
    args[0] !== "--confirm-database" ||
    args[1] !== configuredDatabase
  ) {
    throw new Error(
      "Refusing to migrate. Supply --confirm-database followed by the exact disposable database name."
    );
  }
  return configuredDatabase;
}

function assertSupportedMySqlVersion(version) {
  const match = /^8\.0\.(\d+)(?:[-+.]|$)/.exec(version);
  if (!match || Number(match[1]) < 16) {
    throw new Error("The migration runner requires MySQL 8.0.16 or later in the 8.0 series.");
  }
}

export async function runMigrationCommand({
  args = process.argv.slice(2),
  configLoader = loadMigrationDatabaseConfig,
  migrationLoader = loadMigrations,
  connectionFactory = createConnection,
  environment = process.env
} = {}) {
  const config = configLoader();
  getConfirmedDatabase(args, config.database);
  if (config.port !== 3306) {
    throw new Error("MYSQL_PORT must be 3306 for the disposable migration database.");
  }
  if (config.host !== "127.0.0.1") {
    throw new Error("MYSQL_HOST must be 127.0.0.1 for the disposable migration database.");
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const migrationDirectory = resolve(scriptDirectory, "..", "..", "database", "migrations");
  const migrations = await migrationLoader(migrationDirectory);
  const connection = await connectionFactory({
    ...config,
    charset: "UTF8MB4_GENERAL_CI",
    multipleStatements: true,
    timezone: "Z"
  });

  try {
    const [versionRows] = await connection.query("SELECT VERSION() AS version");
    const version = versionRows[0]?.version;
    if (typeof version !== "string") {
      throw new Error("Could not determine the MySQL server version.");
    }
    assertSupportedMySqlVersion(version);
    await connection.query("SET time_zone = '+00:00'");

    const operator = (environment.USERNAME || environment.USER || "").trim();
    const appliedBy = (operator || "wellexsa-migration-runner").slice(0, 128);
    const result = await runMigrations(connection, migrations, { appliedBy });
    console.log(`Migration check complete. ${result.appliedCount} migration(s) are applied.`);
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runMigrationCommand().catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration runner failed.");
    process.exitCode = 1;
  });
}
