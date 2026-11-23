import { closeDatabasePool, getDatabasePool } from "../src/database/pool.js";
import { inspectDatabaseConnection } from "../src/database/health.js";

let connectionVerified = false;

try {
  const { version } = await inspectDatabaseConnection(getDatabasePool());
  console.log(`MySQL connection verified. Server version: ${version}`);
  connectionVerified = true;
} catch {
  console.error("MySQL connection check failed. Verify the local database settings.");
  process.exitCode = 1;
}

try {
  await closeDatabasePool();
} catch {
  console.error("MySQL connection pool could not be closed cleanly.");
  process.exitCode = 1;
}

if (connectionVerified && process.exitCode !== 1) {
  console.log("Both SELECT VERSION() and SELECT 1 completed successfully.");
}
