import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { closeDatabasePool } from "./database/pool.js";

const config = loadEnv();
const app = createApp(config);
const server = app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}.`);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing the API server.`);

  const timeout = setTimeout(() => {
    console.error("API server shutdown timed out.");
    server.closeAllConnections();
  }, 10000);
  timeout.unref();

  server.close(async (error) => {
    clearTimeout(timeout);
    if (error) {
      console.error("API server shutdown failed.", { code: error.code || "unknown" });
      process.exitCode = 1;
    }

    try {
      await closeDatabasePool();
    } catch (poolError) {
      console.error("Database pool shutdown failed.", { code: poolError.code || "unknown" });
      process.exitCode = 1;
    }
  });
}

server.on("error", (error) => {
  console.error("API server error.", { code: error.code || "unknown" });
  process.exitCode = 1;
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
