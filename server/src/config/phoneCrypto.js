import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const PHONE_AAD = Buffer.from("wellexsa:phone:v1", "utf8");

function configurationError() {
  const error = new Error("Phone encryption is not configured correctly.");
  error.code = "PHONE_CRYPTO_CONFIG";
  return error;
}

function parseVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1 || version > 65535) {
    throw configurationError();
  }
  return version;
}

function parseKeyRing(value, expectedBytes) {
  let entries;
  try {
    entries = JSON.parse(value);
  } catch {
    throw configurationError();
  }
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    throw configurationError();
  }
  const ring = new Map();
  for (const [rawVersion, encodedKey] of Object.entries(entries)) {
    const version = parseVersion(rawVersion);
    if (typeof encodedKey !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey)) {
      throw configurationError();
    }
    const key = Buffer.from(encodedKey, "base64");
    if (
      key.length !== expectedBytes ||
      key.toString("base64") !== encodedKey ||
      ring.has(version)
    ) throw configurationError();
    ring.set(version, key);
  }
  if (ring.size === 0) throw configurationError();
  return ring;
}

export function loadPhoneCryptoConfig(source = process.env) {
  try {
    const encryptionKeys = parseKeyRing(source.PHONE_ENCRYPTION_KEYS_JSON, 32);
    const lookupKeys = parseKeyRing(source.PHONE_LOOKUP_KEYS_JSON, 32);
    const activeEncryptionVersion = parseVersion(source.PHONE_ENCRYPTION_ACTIVE_VERSION);
    const activeLookupVersion = parseVersion(source.PHONE_LOOKUP_ACTIVE_VERSION);
    if (!encryptionKeys.has(activeEncryptionVersion) || !lookupKeys.has(activeLookupVersion)) {
      throw configurationError();
    }
    if ([...encryptionKeys.values()].some((encryptionKey) =>
      [...lookupKeys.values()].some((lookupKey) => encryptionKey.equals(lookupKey))
    )) throw configurationError();
    return Object.freeze({
      encryptionKeys,
      lookupKeys,
      activeEncryptionVersion,
      activeLookupVersion
    });
  } catch (error) {
    if (error?.code === "PHONE_CRYPTO_CONFIG") throw error;
    throw configurationError();
  }
}

export function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\s().-]/g, "");
  return /^\+?[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function encryptPhone(value, config = loadPhoneCryptoConfig()) {
  const normalizedPhone = normalizePhone(value);
  if (!normalizedPhone) {
    const error = new TypeError("Phone number is invalid.");
    error.code = "INVALID_PHONE";
    throw error;
  }

  const encryptionKey = config.encryptionKeys.get(config.activeEncryptionVersion);
  const lookupKey = config.lookupKeys.get(config.activeLookupVersion);
  if (!encryptionKey || !lookupKey) throw configurationError();

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  cipher.setAAD(PHONE_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(normalizedPhone, "utf8"),
    cipher.final()
  ]);
  const authenticationTag = cipher.getAuthTag();
  const lookupHmac = createHmac("sha256", lookupKey)
    .update(normalizedPhone, "utf8")
    .digest();

  return Object.freeze({
    ciphertext,
    nonce,
    authenticationTag,
    encryptionKeyVersion: config.activeEncryptionVersion,
    lookupHmac,
    lookupKeyVersion: config.activeLookupVersion
  });
}

export function decryptPhone(encrypted, config = loadPhoneCryptoConfig()) {
  const key = config.encryptionKeys.get(encrypted.encryptionKeyVersion);
  if (!key) throw configurationError();
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
  decipher.setAAD(PHONE_AAD);
  decipher.setAuthTag(encrypted.authenticationTag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final()
  ]).toString("utf8");
}
