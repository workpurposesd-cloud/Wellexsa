import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_BIKES,
  validateSeedEnvironment
} from "../scripts/seed-demo-bikes.mjs";

const validEnvironment = {
  NODE_ENV: "development",
  WELLEXSA_USE_AUTH_EMULATOR: "true",
  MYSQL_HOST: "127.0.0.1",
  MYSQL_PORT: "3306",
  MYSQL_DATABASE: "wellexsa_it_20261123_1752",
  MYSQL_USER: "wellexsa_it_app",
  MYSQL_PASSWORD: "test-only"
};

test("demo bike seed config accepts only the local disposable database", () => {
  const config = validateSeedEnvironment(validEnvironment, "development");

  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.database, "wellexsa_it_20261123_1752");
  assert.equal(config.user, "wellexsa_it_app");
  assert.equal(DEMO_BIKES.length, 8);
  assert.equal(DEMO_BIKES[0].name, "LOCAL DEMO Scooter 01");
  assert.equal(DEMO_BIKES[0].model, "LOCAL-DEMO-01");
  assert.equal(DEMO_BIKES[7].name, "LOCAL DEMO Scooter 08");
  assert.equal(DEMO_BIKES[7].model, "LOCAL-DEMO-08");
});

test("demo bike seed config rejects production in either environment source", () => {
  assert.throws(
    () => validateSeedEnvironment({ ...validEnvironment, NODE_ENV: "production" }, "development"),
    /production environment/
  );
  assert.throws(
    () => validateSeedEnvironment(validEnvironment, "production"),
    /production environment/
  );
});

test("demo bike seed config rejects missing emulator opt-in", () => {
  assert.throws(
    () => validateSeedEnvironment({ ...validEnvironment, WELLEXSA_USE_AUTH_EMULATOR: "false" }, "development"),
    /WELLEXSA_USE_AUTH_EMULATOR=true/
  );
});

test("demo bike seed config rejects non-loopback hosts and non-disposable databases", () => {
  assert.throws(
    () => validateSeedEnvironment({ ...validEnvironment, MYSQL_HOST: "localhost" }, "development"),
    /MYSQL_HOST must be exactly 127\.0\.0\.1/
  );
  assert.throws(
    () => validateSeedEnvironment({ ...validEnvironment, MYSQL_DATABASE: "wellexsa" }, "development"),
    /MYSQL_DATABASE must be exactly wellexsa_it_20261123_1752/
  );
});

test("demo bike seed config rejects accounts other than the local app user", () => {
  assert.throws(
    () => validateSeedEnvironment({ ...validEnvironment, MYSQL_USER: "wellexsa_app" }, "development"),
    /MYSQL_USER must be exactly wellexsa_it_app/
  );
});
