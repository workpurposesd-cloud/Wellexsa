import { createPool as createMySqlPool } from "mysql2/promise";
import { loadDatabaseConfig } from "../config/database.js";

export function createPoolManager({
  poolFactory = createMySqlPool,
  configLoader = loadDatabaseConfig
} = {}) {
  let pool;

  function getPool() {
    if (!pool) pool = poolFactory(configLoader());
    return pool;
  }

  async function withTransaction(operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Transaction operation must be a function.");
    }

    const connection = await getPool().getConnection();
    let transactionStarted = false;

    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const result = await operation(connection);
      await connection.commit();
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "The transaction failed and rollback could not be confirmed."
          );
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function close() {
    if (!pool) return;
    await pool.end();
    pool = undefined;
  }

  return Object.freeze({ getPool, withTransaction, close });
}

const defaultPoolManager = createPoolManager();

export const getDatabasePool = defaultPoolManager.getPool;
export const withDatabaseTransaction = defaultPoolManager.withTransaction;
export const closeDatabasePool = defaultPoolManager.close;
