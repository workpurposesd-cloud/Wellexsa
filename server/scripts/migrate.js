import { createConnection } from "mysql2/promise";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrationDatabaseConfig } from "../src/config/database.js";
import { loadMigrations, runMigrations } from "../src/database/migration-runner.js";

function getConfirmedDatabase(args, configuredDatabase) {
  const confirmationIndex = args.indexOf("--confirm-database");
  const confirmedDatabase = args[confirmationIndex + 1];
  if (
    confirmationIndex < 0 ||
    !confirmedDatabase ||
    args.length !== 2 ||
    confirmedDatabase !== configuredDatabase
  ) {
    throw new Error(
      "Refusing to migrate. Supply --confirm-database followed by the exact MYSQL_DATABASE value."
    );
  }
}

function assertSupportedMySqlVersion(version) {
  const match = /^8\.0\.(\d+)(?:[-+.]|$)/.exec(version);
  if (!match || Number(match[1]) < 16) {
    throw new Error("The migration runner requires MySQL 8.0.16 or later in the 8.0 series.");
  }
}

async function main() {
  const config = loadMigrationDatabaseConfig();
  getConfirmedDatabase(process.argv.slice(2), config.database);

  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const migrationDirectory = resolve(scriptDirectory, "..", "..", "database", "migrations");
  const migrations = await loadMigrations(migrationDirectory);
  const connection = await createConnection({
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

    const operator = (process.env.USERNAME || process.env.USER || "").trim();
    const appliedBy = (operator || "wellexsa-migration-runner").slice(0, 128);
    const result = await runMigrations(connection, migrations, { appliedBy });
    console.log(`Migration check complete. ${result.appliedCount} migration(s) are applied.`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration runner failed.");
  process.exitCode = 1;
});
