import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  decryptPhone,
  encryptPhone,
  loadPhoneCryptoConfig,
  normalizePhone
} from "../src/config/phoneCrypto.js";

function createConfig() {
  return loadPhoneCryptoConfig({
    PHONE_ENCRYPTION_ACTIVE_VERSION: "1",
    PHONE_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: randomBytes(32).toString("base64") }),
    PHONE_LOOKUP_ACTIVE_VERSION: "3",
    PHONE_LOOKUP_KEYS_JSON: JSON.stringify({ 3: randomBytes(32).toString("base64") })
  });
}

test("phone normalization and encryption produce reversible ciphertext and keyed lookup only", () => {
  const config = createConfig();
  const normalized = normalizePhone("+91 (98765) 43210");
  const encrypted = encryptPhone("+91 (98765) 43210", config);

  assert.equal(normalized, "+919876543210");
  assert.equal(decryptPhone(encrypted, config), normalized);
  assert.equal(encrypted.encryptionKeyVersion, 1);
  assert.equal(encrypted.lookupKeyVersion, 3);
  assert.equal(encrypted.ciphertext.toString("utf8").includes(normalized), false);
  assert.equal(encrypted.lookupHmac.length, 32);
  assert.equal(encryptPhone("+91 98765 43210", config).lookupHmac.equals(encrypted.lookupHmac), true);
});

test("phone key configuration rejects missing, malformed, and incorrectly sized keys", () => {
  assert.throws(() => loadPhoneCryptoConfig({}), { code: "PHONE_CRYPTO_CONFIG" });
  assert.throws(() => loadPhoneCryptoConfig({
    PHONE_ENCRYPTION_ACTIVE_VERSION: "1",
    PHONE_ENCRYPTION_KEYS_JSON: JSON.stringify({ 1: Buffer.alloc(16).toString("base64") }),
    PHONE_LOOKUP_ACTIVE_VERSION: "1",
    PHONE_LOOKUP_KEYS_JSON: JSON.stringify({ 1: Buffer.alloc(32).toString("base64") })
  }), { code: "PHONE_CRYPTO_CONFIG" });
});

test("phone encryption rejects invalid phone input without returning a fallback", () => {
  assert.throws(() => encryptPhone("not a phone", createConfig()), { code: "INVALID_PHONE" });
});
