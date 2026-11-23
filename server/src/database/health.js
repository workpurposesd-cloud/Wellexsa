export async function checkDatabaseConnection(pool) {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    throw new Error("Database connectivity check failed.");
  }
}

export async function inspectDatabaseConnection(pool) {
  try {
    const [versionRows] = await pool.query("SELECT VERSION() AS version");
    const [healthRows] = await pool.query("SELECT 1 AS ok");
    const version = versionRows[0]?.version;

    if (typeof version !== "string" || Number(healthRows[0]?.ok) !== 1) {
      throw new Error("Unexpected database connectivity-check result.");
    }

    return Object.freeze({ version });
  } catch {
    throw new Error("Database connectivity check failed.");
  }
}
