import { isFirebaseAuthEmulatorEnabled } from "./env.js";

export const DISPOSABLE_MYSQL_DATABASE_NAME = "wellexsa_it_20261123_1752";

export function assertDisposableDatabaseName(database) {
  if (database !== DISPOSABLE_MYSQL_DATABASE_NAME) {
    throw new Error(`MYSQL_DATABASE must be exactly ${DISPOSABLE_MYSQL_DATABASE_NAME}.`);
  }
}

export function assertIntegrationDatabaseConfig(config, source = process.env) {
  if (source.WELLEXSA_INTEGRATION_TESTS !== "YES") {
    throw new Error("Set WELLEXSA_INTEGRATION_TESTS=YES only in the isolated integration environment.");
  }
  if (source.NODE_ENV !== "test") {
    throw new Error("Integration tests require NODE_ENV=test.");
  }
  if (config.host !== "127.0.0.1") {
    throw new Error("Integration tests may connect only to local MySQL.");
  }
  if (config.port !== 3306) {
    throw new Error("Integration tests require MYSQL_PORT=3306.");
  }
  assertDisposableDatabaseName(config.database);
  if (source.WELLEXSA_TEST_DATABASE !== config.database) {
    throw new Error("WELLEXSA_TEST_DATABASE must match MYSQL_DATABASE.");
  }
  if (config.user !== "wellexsa_it_app") {
    throw new Error("Use a dedicated integration app account.");
  }
}

function requiredString(source, name) {
  const value = source[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredPassword(source) {
  const password = source.MYSQL_PASSWORD;
  if (typeof password !== "string" || !password.trim()) {
    throw new Error("MYSQL_PASSWORD must be a non-empty string.");
  }
  return password;
}

function requiredMigrationPassword(source) {
  const password = source.MYSQL_MIGRATION_PASSWORD;
  if (typeof password !== "string" || !password.trim()) {
    throw new Error("MYSQL_MIGRATION_PASSWORD must be a non-empty string.");
  }
  return password;
}

function parseInteger(value, name, defaultValue, min, max) {
  const result = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return result;
}

export function loadDatabaseConfig(source = process.env) {
  const database = requiredString(source, "MYSQL_DATABASE");
  if (isFirebaseAuthEmulatorEnabled(source)) {
    assertDisposableDatabaseName(database);
  }

  return Object.freeze({
    host: requiredString(source, "MYSQL_HOST"),
    port: parseInteger(source.MYSQL_PORT, "MYSQL_PORT", undefined, 1, 65535),
    database,
    user: requiredString(source, "MYSQL_USER"),
    password: requiredPassword(source),
    connectionLimit: parseInteger(source.MYSQL_CONNECTION_LIMIT, "MYSQL_CONNECTION_LIMIT", 10, 1, 100),
    connectTimeout: parseInteger(source.MYSQL_CONNECT_TIMEOUT, "MYSQL_CONNECT_TIMEOUT", 10000, 1, 120000),
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true
  });
}

export function loadMigrationDatabaseConfig(source = process.env) {
  const migrationUser = requiredString(source, "MYSQL_MIGRATION_USER");
  if (migrationUser !== "wellexsa_it_migrator") {
    throw new Error("MYSQL_MIGRATION_USER must be exactly wellexsa_it_migrator.");
  }
  if (
    typeof source.MYSQL_USER === "string" &&
    source.MYSQL_USER.trim() &&
    source.MYSQL_USER.trim() === migrationUser
  ) {
    throw new Error("MYSQL_MIGRATION_USER must be different from MYSQL_USER.");
  }
  return Object.freeze({
    host: requiredString(source, "MYSQL_HOST"),
    port: parseInteger(source.MYSQL_PORT, "MYSQL_PORT", undefined, 1, 65535),
    database: requiredString(source, "MYSQL_DATABASE"),
    user: migrationUser,
    password: requiredMigrationPassword(source),
    connectTimeout: parseInteger(source.MYSQL_CONNECT_TIMEOUT, "MYSQL_CONNECT_TIMEOUT", 10000, 1, 120000),
    timezone: "Z"
  });
}
