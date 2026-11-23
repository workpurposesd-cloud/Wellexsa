import assert from "node:assert/strict";
import test from "node:test";
import { resolvePrincipal } from "../src/middleware/authorize.js";

function createPool(user, permissionRows = []) {
  const calls = [];
  return {
    calls,
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.includes("FROM users AS u")) return [[user].filter(Boolean), []];
      return [permissionRows, []];
    }
  };
}

test("principal role comes from MySQL, not Firebase token claims", async () => {
  const pool = createPool({
    id: 17,
    firebase_uid: "owner-uid",
    email: "owner@example.com",
    display_name: "Owner",
    email_verified_at: new Date(),
    account_status: "active",
    role_code: "owner"
  }, [{ code: "crm.customers.read.all", effect: null }]);

  const principal = await resolvePrincipal(pool, {
    uid: "owner-uid",
    role: "customer"
  });

  assert.equal(principal.role, "owner");
  assert.deepEqual(principal.permissions, ["crm.customers.read.all"]);
  assert.deepEqual(pool.calls[0].parameters, ["owner-uid"]);
});

test("Customer role overrides cannot grant CRM permissions", async () => {
  const pool = createPool({
    id: 18,
    firebase_uid: "customer-uid",
    email: "customer@example.com",
    display_name: "Customer",
    email_verified_at: null,
    account_status: "active",
    role_code: "customer"
  }, [
    { code: "crm.customers.read.all", effect: "grant" },
    { code: "customer.profile.read.self", effect: "grant" },
    { code: "customer.history.read.self", effect: "deny" }
  ]);

  const principal = await resolvePrincipal(pool, { uid: "customer-uid" });

  assert.deepEqual(principal.permissions, ["customer.profile.read.self"]);
});

test("Staff role overrides cannot expand assigned scope or management permissions", async () => {
  const pool = createPool({
    id: 19,
    firebase_uid: "staff-uid",
    email: "staff@example.com",
    display_name: "Staff",
    email_verified_at: new Date(),
    account_status: "active",
    role_code: "staff"
  }, [
    { code: "crm.customers.read.assigned", effect: null },
    { code: "crm.customers.read.all", effect: "grant" },
    { code: "crm.staff.manage", effect: "grant" },
    { code: "crm.sales.create", effect: null }
  ]);

  const principal = await resolvePrincipal(pool, { uid: "staff-uid" });

  assert.deepEqual(principal.permissions, [
    "crm.customers.read.assigned",
    "crm.sales.create"
  ]);
});

test("permission denials override role grants and disabled users are rejected", async () => {
  const activePool = createPool({
    id: 20,
    firebase_uid: "staff-uid",
    email: "staff@example.com",
    display_name: "Staff",
    email_verified_at: new Date(),
    account_status: "active",
    role_code: "staff"
  }, [{ code: "crm.sales.create", effect: "deny" }]);
  const principal = await resolvePrincipal(activePool, { uid: "staff-uid" });
  assert.deepEqual(principal.permissions, []);

  const disabledPool = createPool({
    id: 21,
    firebase_uid: "disabled-uid",
    email: null,
    display_name: "",
    email_verified_at: null,
    account_status: "disabled",
    role_code: "customer"
  });
  await assert.rejects(resolvePrincipal(disabledPool, { uid: "disabled-uid" }), {
    statusCode: 403,
    code: "ACCOUNT_INACTIVE"
  });
});
