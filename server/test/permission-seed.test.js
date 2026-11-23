import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const expectedGrants = {
  owner: [
    "crm.staff.read",
    "crm.staff.manage",
    "crm.roles.manage",
    "crm.customers.read.assigned",
    "crm.customers.read.all",
    "crm.customers.create",
    "crm.customers.update.assigned",
    "crm.customers.update.all",
    "crm.customers.archive",
    "crm.customers.assign",
    "crm.customer_links.review",
    "crm.enquiries.read.assigned",
    "crm.enquiries.read.all",
    "crm.enquiries.update.assigned",
    "crm.enquiries.update.all",
    "crm.enquiries.assign",
    "crm.contacts.log.assigned",
    "crm.contacts.log.all",
    "crm.followups.read.assigned",
    "crm.followups.read.all",
    "crm.followups.create.assigned",
    "crm.followups.create.all",
    "crm.followups.update.assigned",
    "crm.followups.update.all",
    "crm.followups.cancel",
    "crm.sales.read.assigned",
    "crm.sales.read.all",
    "crm.sales.create",
    "crm.sales.update.assigned",
    "crm.sales.update.all",
    "crm.sales.archive",
    "catalog.read",
    "catalog.manage",
    "media.upload",
    "media.manage",
    "homepage_slides.manage",
    "website_settings.manage",
    "business_settings.manage",
    "reports.read",
    "activity_logs.read"
  ],
  staff: [
    "crm.customers.read.assigned",
    "crm.customers.create",
    "crm.customers.update.assigned",
    "crm.enquiries.read.assigned",
    "crm.enquiries.update.assigned",
    "crm.contacts.log.assigned",
    "crm.followups.read.assigned",
    "crm.followups.create.assigned",
    "crm.followups.update.assigned",
    "crm.followups.cancel",
    "crm.sales.read.assigned",
    "crm.sales.create",
    "catalog.read"
  ],
  customer: [
    "customer.profile.read.self",
    "customer.profile.update.self",
    "customer.history.read.self"
  ]
};

test("reference seed matches the reviewed Owner, Staff, and Customer permission matrix", async () => {
  const seedPath = fileURLToPath(new URL("../../database/seeds/001_reference_data.sql", import.meta.url));
  const sql = await readFile(seedPath, "utf8");
  const statementPattern =
    /INSERT IGNORE INTO role_permissions[\s\S]*?p\.code IN \(([\s\S]*?)\)\s*WHERE r\.code = '(owner|staff|customer)';/g;
  const actualGrants = new Map();

  for (const match of sql.matchAll(statementPattern)) {
    const codes = [...match[1].matchAll(/'([a-z][a-z0-9._]+)'/g)].map((item) => item[1]);
    actualGrants.set(match[2], codes);
  }

  assert.deepEqual(Object.fromEntries(actualGrants), expectedGrants);
  assert.equal(actualGrants.has("customer"), true);
  assert.equal(actualGrants.get("customer").some((code) => code.startsWith("crm.")), false);
});
