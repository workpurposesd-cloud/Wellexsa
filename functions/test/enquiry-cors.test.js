import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// The Functions emulator enables allow-all CORS for its worker; load the callable
// without that emulator-only override so these checks exercise its configured policy.
process.env.FIREBASE_DEBUG_MODE = "false";
const projectId = process.env.GCLOUD_PROJECT || "demo-wellexsa-cors";
if (!projectId.startsWith("demo-")) {
  throw new Error("Enquiry CORS tests must use a demo Firebase project.");
}
initializeApp({ projectId });
const firestore = getFirestore();
const { crmSubmitBikeEnquiry } = await import("../crm.js");

const functionsEmulatorHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const functionUrl = `http://${functionsEmulatorHost}/${projectId}/us-central1/crmSubmitBikeEnquiry`;
let corsServer;
let corsFunctionUrl;
const testBikeId = "enquiry-cors-test-bike";
const testBike = { name: "CORS Test Scooter", model: "CORS Test Model" };
const allowedOrigins = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://stunning-squirrel-b7fad7.netlify.app"
];

test.before(async () => {
  await firestore.collection("bikes").doc(testBikeId).set({
    ...testBike,
    status: "published"
  });
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
  if (corsServer) {
    await new Promise((resolve, reject) => {
      corsServer.close((error) => error ? reject(error) : resolve());
    });
  }
  await firestore.collection("bikes").doc(testBikeId).delete();
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
      Origin: allowedOrigins[1],
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: {
        requestId,
        bikeId: testBikeId,
        bikeName: testBike.name,
        name: "CORS Integration Test",
        mobile: "9876543210",
        bikeModel: testBike.model,
        message: "Please share the current price and availability."
      }
    })
  });

  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigins[1]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: { submitted: true } });
});

test("rejects a public enquiry without a customer message", async () => {
  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Origin: allowedOrigins[1],
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      data: {
        requestId: randomUUID(),
        bikeId: testBikeId,
        bikeName: testBike.name,
        name: "CORS Integration Test",
        mobile: "9876543210",
        bikeModel: testBike.model
      }
    })
  });
  const body = await response.json();

  assert.notEqual(response.status, 200);
  assert.match(JSON.stringify(body).toLowerCase(), /enquiry message|invalid-argument/);
});
