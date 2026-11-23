import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const MIGRATION_FILE_PATTERN = /^(\d{3}_[a-z0-9_]+)\.sql$/;
const BOOTSTRAP_VERSION = "000_schema_migrations";

const EXPECTED_COLUMNS = [
  ["version", "varchar(64)", "NO", 64],
  ["checksum_sha256", "char(64)", "NO", 64],
  ["status", "enum('running','applied','failed')", "NO", null],
  ["started_at", "datetime(6)", "NO", null],
  ["applied_at", "datetime(6)", "YES", null],
  ["applied_by", "varchar(128)", "NO", 128],
  ["error_code", "varchar(64)", "YES", 64]
];

function migrationError(message) {
  return new Error(message);
}

function queryRows(result) {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : [];
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : "SQL_ERROR";
}

function createdTableNames(sql) {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
  const names = [];
  const pattern = /\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(`([A-Za-z0-9_]+)`|([A-Za-z0-9_]+))/gi;

  for (const match of withoutComments.matchAll(pattern)) {
    names.push(match[2] || match[3]);
  }

  return [...new Set(names)];
}

export async function loadMigrations(directory) {
  const filenames = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const migrations = [];

  for (const filename of filenames) {
    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) {
      throw migrationError(`Invalid migration filename: ${basename(filename)}.`);
    }

    const contents = await readFile(join(directory, filename));
    migrations.push(Object.freeze({
      version: match[1],
      filename,
      checksum: createHash("sha256").update(contents).digest("hex"),
      sql: contents.toString("utf8")
    }));
  }

  if (migrations.length === 0 || migrations[0].version !== BOOTSTRAP_VERSION) {
    throw migrationError(`The first migration must be ${BOOTSTRAP_VERSION}.`);
  }

  for (let index = 1; index < migrations.length; index += 1) {
    const previousNumber = Number(migrations[index - 1].version.slice(0, 3));
    const currentNumber = Number(migrations[index].version.slice(0, 3));
    if (currentNumber !== previousNumber + 1) {
      throw migrationError("Migration versions must be consecutive and ordered.");
    }
  }

  return Object.freeze(migrations);
}

export function validateMigrationHistory(migrations, records) {
  const migrationByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const recordByVersion = new Map();

  for (const record of records) {
    const migration = migrationByVersion.get(record.version);
    if (!migration) {
      throw migrationError(`Database contains unknown migration ${record.version}.`);
    }
    if (recordByVersion.has(record.version)) {
      throw migrationError(`Database contains duplicate history for ${record.version}.`);
    }
    if (record.checksum_sha256 !== migration.checksum) {
      throw migrationError(`Checksum mismatch for migration ${record.version}; stop and review manually.`);
    }
    if (record.status !== "applied") {
      throw migrationError(
        `Migration ${record.version} is ${record.status}; automatic rerun is blocked. Review the schema manually.`
      );
    }
    recordByVersion.set(record.version, record);
  }

  let appliedCount = 0;
  for (const migration of migrations) {
    if (!recordByVersion.has(migration.version)) break;
    appliedCount += 1;
  }

  if (appliedCount !== recordByVersion.size) {
    throw migrationError("Migration history is out of order or has a missing earlier migration.");
  }

  return appliedCount;
}

export async function assertMigrationLedgerShape(connection) {
  const tableRows = queryRows(await connection.query(
    "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  ));
  if (tableRows.length !== 1 || tableRows[0].ENGINE !== "InnoDB") {
    throw migrationError("schema_migrations is missing or is not an InnoDB table; stop for manual review.");
  }

  const columnRows = queryRows(await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH,
            CHARACTER_SET_NAME, COLLATION_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'
     ORDER BY ORDINAL_POSITION`
  ));
  if (columnRows.length !== EXPECTED_COLUMNS.length) {
    throw migrationError("schema_migrations has an unexpected column layout; stop for manual review.");
  }

  for (let index = 0; index < EXPECTED_COLUMNS.length; index += 1) {
    const [name, type, nullable, length] = EXPECTED_COLUMNS[index];
    const column = columnRows[index];
    if (
      column.COLUMN_NAME !== name ||
      String(column.COLUMN_TYPE).toLowerCase() !== type ||
      column.IS_NULLABLE !== nullable ||
      (length !== null && Number(column.CHARACTER_MAXIMUM_LENGTH) !== length)
    ) {
      throw migrationError("schema_migrations has an unexpected column layout; stop for manual review.");
    }
    if (name === "checksum_sha256" &&
        (column.CHARACTER_SET_NAME !== "ascii" || column.COLLATION_NAME !== "ascii_bin")) {
      throw migrationError("schema_migrations checksum collation is unexpected; stop for manual review.");
    }
  }

  const primaryKeyRows = queryRows(await connection.query(
    `SELECT COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'
       AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY ORDINAL_POSITION`
  ));
  const checkRows = queryRows(await connection.query(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'
       AND CONSTRAINT_TYPE = 'CHECK'`
  ));

  if (
    primaryKeyRows.length !== 1 ||
    primaryKeyRows[0].COLUMN_NAME !== "version" ||
    !checkRows.some((row) => row.CONSTRAINT_NAME === "chk_schema_migrations_state")
  ) {
    throw migrationError("schema_migrations constraints are unexpected; stop for manual review.");
  }
}

async function getMigrationRecords(connection) {
  return queryRows(await connection.query(
    "SELECT version, checksum_sha256, status FROM schema_migrations ORDER BY version"
  ));
}

async function tableExists(connection, tableName) {
  const rows = queryRows(await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  ));
  return rows.length === 1;
}

async function assertNoExistingTables(connection) {
  const rows = queryRows(await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME`
  ));
  if (rows.length > 0) {
    throw migrationError(
      "The target database already contains tables but has no migration ledger; no SQL was run."
    );
  }
}

async function recordBootstrap(connection, migration, appliedBy) {
  await connection.query(migration.sql);
  await assertMigrationLedgerShape(connection);
  await connection.query(
    `INSERT INTO schema_migrations
     (version, checksum_sha256, status, applied_at, applied_by)
     VALUES (?, ?, 'applied', UTC_TIMESTAMP(6), ?)`,
    [migration.version, migration.checksum, appliedBy]
  );
}

async function ensureBootstrap(connection, migrations, appliedBy) {
  const bootstrap = migrations[0];
  const exists = await tableExists(connection, "schema_migrations");

  if (!exists) {
    await assertNoExistingTables(connection);
    await recordBootstrap(connection, bootstrap, appliedBy);
    return getMigrationRecords(connection);
  }

  await assertMigrationLedgerShape(connection);
  const records = await getMigrationRecords(connection);
  if (records.length === 0) {
    throw migrationError(
      "schema_migrations exists but has no bootstrap history; no SQL was run. Inspect it manually before continuing."
    );
  }
  validateMigrationHistory(migrations, records);
  return records;
}

async function assertPendingMigrationHasNoObjects(connection, migration) {
  const tableNames = createdTableNames(migration.sql);
  if (tableNames.length === 0) return;

  const existingRows = queryRows(await connection.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [tableNames]
  ));
  if (existingRows.length > 0) {
    throw migrationError(
      `Migration ${migration.version} has untracked table ${existingRows[0].TABLE_NAME}; automatic rerun is blocked.`
    );
  }
}

async function applyOneMigration(connection, migration, appliedBy) {
  await connection.query(
    `INSERT INTO schema_migrations
     (version, checksum_sha256, status, applied_by)
     VALUES (?, ?, 'running', ?)`,
    [migration.version, migration.checksum, appliedBy]
  );

  try {
    await connection.query(migration.sql);
  } catch (error) {
    const code = safeErrorCode(error);
    try {
      const result = await connection.query(
        `UPDATE schema_migrations
         SET status = 'failed', error_code = ?
         WHERE version = ? AND status = 'running'`,
        [code, migration.version]
      );
      const affectedRows = result?.[0]?.affectedRows;
      if (affectedRows !== undefined && affectedRows !== 1) {
        throw migrationError("Failure status update did not affect exactly one migration row.");
      }
    } catch {
      throw migrationError(
        `Migration ${migration.version} failed (${code}); its running state could not be updated. Do not rerun; inspect the database manually.`
      );
    }
    throw migrationError(
      `Migration ${migration.version} failed (${code}) and was marked failed; automatic rerun is blocked.`
    );
  }

  const result = await connection.query(
    `UPDATE schema_migrations
     SET status = 'applied', applied_at = UTC_TIMESTAMP(6)
     WHERE version = ? AND status = 'running'`,
    [migration.version]
  );
  const affectedRows = result?.[0]?.affectedRows;
  if (affectedRows !== undefined && affectedRows !== 1) {
    throw migrationError(
      `Migration ${migration.version} executed but its applied state was not recorded; do not rerun.`
    );
  }
}

export async function runMigrations(connection, migrations, {
  appliedBy = "wellexsa-migration-runner"
} = {}) {
  if (
    !Array.isArray(migrations) ||
    migrations.length === 0 ||
    migrations[0].version !== BOOTSTRAP_VERSION
  ) {
    throw migrationError(`The first migration must be ${BOOTSTRAP_VERSION}.`);
  }

  let records = await ensureBootstrap(connection, migrations, appliedBy);
  await assertMigrationLedgerShape(connection);
  let appliedCount = validateMigrationHistory(migrations, records);

  for (let index = appliedCount; index < migrations.length; index += 1) {
    const migration = migrations[index];
    await assertPendingMigrationHasNoObjects(connection, migration);
    await applyOneMigration(connection, migration, appliedBy);
    records = [...records, {
      version: migration.version,
      checksum_sha256: migration.checksum,
      status: "applied"
    }];
    appliedCount = validateMigrationHistory(migrations, records);
  }

  return Object.freeze({ appliedCount });
}
