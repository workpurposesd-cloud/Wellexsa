const VALID_NODE_ENVIRONMENTS = new Set(["development", "test", "production"]);

export function isFirebaseAuthEmulatorEnabled(source = process.env) {
  const flag = source.WELLEXSA_USE_AUTH_EMULATOR;
  if (flag !== undefined && flag !== "true" && flag !== "false") {
    throw new Error("WELLEXSA_USE_AUTH_EMULATOR must be true or false.");
  }
  return flag === "true";
}

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
  const firebaseAuthEmulatorEnabled = isFirebaseAuthEmulatorEnabled(source);
  const emulatorStartup = source.npm_lifecycle_event === "start:emulator";
  if (firebaseAuthEmulatorEnabled && !emulatorStartup) {
    throw new Error("Firebase Auth Emulator mode is available only through the emulator startup script.");
  }
  if (emulatorStartup && !firebaseAuthEmulatorEnabled) {
    throw new Error("Emulator startup requires WELLEXSA_USE_AUTH_EMULATOR=true.");
  }
  if (firebaseAuthEmulatorEnabled) {
    if (nodeEnv === "production") {
      throw new Error("Firebase Auth Emulator mode is not allowed in production.");
    }
    if (source.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") {
      throw new Error("FIREBASE_AUTH_EMULATOR_HOST must be exactly 127.0.0.1:9099.");
    }
  } else if (source.FIREBASE_AUTH_EMULATOR_HOST !== undefined) {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST requires WELLEXSA_USE_AUTH_EMULATOR=true.");
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
    firebaseProjectId: source.FIREBASE_PROJECT_ID.trim(),
    firebaseAuthEmulatorEnabled
  });
}
