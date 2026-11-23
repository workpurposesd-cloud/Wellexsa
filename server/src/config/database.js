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
  return Object.freeze({
    host: requiredString(source, "MYSQL_HOST"),
    port: parseInteger(source.MYSQL_PORT, "MYSQL_PORT", undefined, 1, 65535),
    database: requiredString(source, "MYSQL_DATABASE"),
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
  return Object.freeze({
    host: requiredString(source, "MYSQL_HOST"),
    port: parseInteger(source.MYSQL_PORT, "MYSQL_PORT", undefined, 1, 65535),
    database: requiredString(source, "MYSQL_DATABASE"),
    user: requiredString(source, "MYSQL_MIGRATION_USER"),
    password: requiredMigrationPassword(source),
    connectTimeout: parseInteger(source.MYSQL_CONNECT_TIMEOUT, "MYSQL_CONNECT_TIMEOUT", 10000, 1, 120000),
    timezone: "Z"
  });
}
