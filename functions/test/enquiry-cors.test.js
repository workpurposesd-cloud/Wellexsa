import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

const projectId = process.env.GCLOUD_PROJECT || "demo-wellexsa-cors";
const functionsEmulatorHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const functionUrl = `http://${functionsEmulatorHost}/${projectId}/us-central1/crmSubmitBikeEnquiry`;
const allowedOrigins = [
  "http://localhost:5500",
  "https://stunning-squirrel-b7fad7.netlify.app"
];

async function preflight(origin) {
  return fetch(functionUrl, {
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
