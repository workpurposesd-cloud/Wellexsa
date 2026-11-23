const VALID_NODE_ENVIRONMENTS = new Set(["development", "test", "production"]);

function parsePort(value) {
  const port = value === undefined || value === "" ? 3001 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function parseCorsOrigins(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("CORS_ORIGINS must contain an explicit origin allowlist.");
  }

  const origins = value.split(",").map((origin) => origin.trim());
  if (origins.some((origin) => !origin || origin.includes("*"))) {
    throw new Error("CORS_ORIGINS must contain only explicit HTTP or HTTPS origins.");
  }

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS contains an invalid origin.");
    }

    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error("CORS_ORIGINS entries must be HTTP or HTTPS origins without paths.");
    }
  }

  return [...new Set(origins)];
}

export function loadEnv(source = process.env) {
  const nodeEnv = source.NODE_ENV || "development";
  if (!VALID_NODE_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }
  const port = parsePort(source.PORT);
  const corsOrigins = parseCorsOrigins(source.CORS_ORIGINS);
  if (typeof source.FIREBASE_PROJECT_ID !== "string" || !source.FIREBASE_PROJECT_ID.trim()) {
    throw new Error("FIREBASE_PROJECT_ID must be a non-empty string.");
  }

  return Object.freeze({
    nodeEnv,
    port,
    corsOrigins: Object.freeze(corsOrigins),
    firebaseProjectId: source.FIREBASE_PROJECT_ID.trim()
  });
}
