import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { randomUUID } from "node:crypto";

// The Functions emulator enables allow-all CORS for its worker; load the callable
// without that emulator-only override so these checks exercise its configured policy.
process.env.FIREBASE_DEBUG_MODE = "false";
const { crmSubmitBikeEnquiry } = await import("../crm.js");

const projectId = process.env.GCLOUD_PROJECT || "demo-wellexsa-cors";
const functionsEmulatorHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const functionUrl = `http://${functionsEmulatorHost}/${projectId}/us-central1/crmSubmitBikeEnquiry`;
let corsServer;
let corsFunctionUrl;
const allowedOrigins = [
  "http://localhost:5500",
  "https://stunning-squirrel-b7fad7.netlify.app"
];

test.before(async () => {
  corsServer = createServer((request, response) => {
    void crmSubmitBikeEnquiry(request, response);
  });
  await new Promise((resolve, reject) => {
    corsServer.once("error", reject);
    corsServer.listen(0, "127.0.0.1", resolve);
  });
  const address = corsServer.address();
  assert.ok(address && typeof address !== "string");
  corsFunctionUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!corsServer) return;
  await new Promise((resolve, reject) => {
    corsServer.close((error) => error ? reject(error) : resolve());
  });
});

async function preflight(origin) {
  return fetch(corsFunctionUrl, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type"
    }
  });
}

for (const origin of allowedOrigins) {
  test(`allows callable OPTIONS preflight from ${origin}`, async () => {
    const response = await preflight(origin);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    const allowedMethods = response.headers.get("access-control-allow-methods") || "";
    assert.match(allowedMethods, /\bPOST\b/i);
    const allowedHeaders = response.headers.get("access-control-allow-headers") || "";
    assert.match(allowedHeaders, /\bauthorization\b/i);
    assert.match(allowedHeaders, /\bcontent-type\b/i);
  });
}

test("does not grant CORS access to an unauthorized origin", async () => {
  const response = await preflight("https://unauthorized.example");
  assert.notEqual(response.headers.get("access-control-allow-origin"), "https://unauthorized.example");
});

test("accepts a callable-formatted public enquiry submission", async () => {
  const requestId = randomUUID();
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Origin: allowedOrigins[0],
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: {
        requestId,
        name: "CORS Integration Test",
        mobile: "9876543210",
        bikeModel: "CORS Test Model"
      }
    })
  });

  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigins[0]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { submitted: true } });
});
