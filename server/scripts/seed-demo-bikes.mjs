import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createPool } from "mysql2/promise";
import {
  DISPOSABLE_MYSQL_DATABASE_NAME,
  loadDatabaseConfig
} from "../src/config/database.js";

const MYSQL_HOST = "127.0.0.1";
const MYSQL_USER = "wellexsa_it_app";
const SEED_LOCK_NAME = "wellexsa_demo_bikes_seed";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const EMULATOR_ENV_PATH = fileURLToPath(new URL("../.env.emulator", import.meta.url));

export const DEMO_BIKES = Object.freeze(
  Array.from({ length: 8 }, (_unused, index) => {
    const number = String(index + 1).padStart(2, "0");
    return Object.freeze({
      name: `LOCAL DEMO Scooter ${number}`,
      model: `LOCAL-DEMO-${number}`
    });
  })
);

export function validateSeedEnvironment(env, inheritedNodeEnv) {
  const isProduction = [env.NODE_ENV, inheritedNodeEnv].some(
    (value) => typeof value === "string" && value.trim().toLowerCase() === "production"
  );
  if (isProduction) {
    throw new Error("Refusing to seed catalogue bikes in a production environment.");
  }
  if (env.NODE_ENV !== "development") {
    throw new Error("The emulator environment file must set NODE_ENV=development.");
  }
  if (env.WELLEXSA_USE_AUTH_EMULATOR !== "true") {
    throw new Error("Refusing to seed without WELLEXSA_USE_AUTH_EMULATOR=true.");
  }
  if (env.MYSQL_HOST !== MYSQL_HOST) {
    throw new Error(`MYSQL_HOST must be exactly ${MYSQL_HOST}.`);
  }
  if (env.MYSQL_DATABASE !== DISPOSABLE_MYSQL_DATABASE_NAME) {
    throw new Error(`MYSQL_DATABASE must be exactly ${DISPOSABLE_MYSQL_DATABASE_NAME}.`);
  }

  const config = loadDatabaseConfig(env);
  if (config.host !== MYSQL_HOST || config.database !== DISPOSABLE_MYSQL_DATABASE_NAME) {
    throw new Error("Refusing to connect outside the local disposable database.");
  }
  if (config.user !== MYSQL_USER) {
    throw new Error(`MYSQL_USER must be exactly ${MYSQL_USER}.`);
  }

  return config;
}

function getTargetRowsQuery() {
  const namePlaceholders = DEMO_BIKES.map(() => "?").join(", ");
  const modelPlaceholders = DEMO_BIKES.map(() => "?").join(", ");
  return `SELECT id, name, model, status
          FROM bikes
          WHERE name IN (${namePlaceholders}) OR model IN (${modelPlaceholders})
          FOR UPDATE`;
}

const targetRowParameters = [
  ...DEMO_BIKES.map(({ name }) => name),
  ...DEMO_BIKES.map(({ model }) => model)
];

function verifySeedRows(rows) {
  assert.equal(rows.length, DEMO_BIKES.length, "Unexpected number of matching catalogue rows.");

  const seenIds = new Set();
  return DEMO_BIKES.map((expected) => {
    const matches = rows.filter(
      (row) => row.name === expected.name && row.model === expected.model
    );
    assert.equal(matches.length, 1, `Expected one catalogue row for ${expected.name}.`);

    const row = matches[0];
    assert.equal(row.status, "published", `Unexpected status for ${expected.name}.`);
    const id = String(row.id);
    assert.match(id, /^[1-9]\d*$/, `Invalid catalogue ID for ${expected.name}.`);
    assert.equal(seenIds.has(id), false, `Duplicate catalogue ID for ${expected.name}.`);
    seenIds.add(id);

    return { id, name: row.name, model: row.model, status: row.status };
  });
}

export async function seedDemoBikes() {
  if (
    typeof process.env.NODE_ENV === "string" &&
    process.env.NODE_ENV.trim().toLowerCase() === "production"
  ) {
    throw new Error("Refusing to seed catalogue bikes in a production environment.");
  }

  const envFile = await readFile(EMULATOR_ENV_PATH, "utf8");
  const env = parseEnv(envFile);
  const config = validateSeedEnvironment(env, process.env.NODE_ENV);
  const pool = createPool(config);
  let connection;
  let transactionStarted = false;
  let seedLockAcquired = false;
  let verifiedRecords;

  try {
    connection = await pool.getConnection();
    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [SEED_LOCK_NAME]
    );
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new Error("Could not acquire the local demo catalogue seed lock.");
    }
    seedLockAcquired = true;

    await connection.beginTransaction();
    transactionStarted = true;

    const [existingRows] = await connection.execute(
      getTargetRowsQuery(),
      targetRowParameters
    );
    if (existingRows.length > 0) {
      throw new Error(
        "Refusing to insert demo catalogue bikes: matching names or models already exist."
      );
    }

    for (const bike of DEMO_BIKES) {
      await connection.execute(
        "INSERT INTO bikes (name, model, status) VALUES (?, ?, ?)",
        [bike.name, bike.model, "published"]
      );
    }

    const [insertedRows] = await connection.execute(
      getTargetRowsQuery(),
      targetRowParameters
    );
    verifiedRecords = verifySeedRows(insertedRows);

    await connection.commit();
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
        transactionStarted = false;
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Catalogue seeding failed and transaction rollback could not be confirmed."
        );
      }
    }
    throw error;
  } finally {
    try {
      if (connection && seedLockAcquired) {
        const [releaseRows] = await connection.execute(
          "SELECT RELEASE_LOCK(?) AS released",
          [SEED_LOCK_NAME]
        );
        if (Number(releaseRows[0]?.released) !== 1) {
          throw new Error("Could not release the local demo catalogue seed lock.");
        }
      }
    } finally {
      if (connection) connection.release();
      await pool.end();
    }
  }

  console.log(JSON.stringify({
    database: config.database,
    verifiedRecords
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await seedDemoBikes();
}
