import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  EMULATOR_HOST,
  PROJECT_ID,
  initializeFirestoreEmulatorApp
} from "./firestore-emulator-app.js";

const app = initializeFirestoreEmulatorApp(initializeApp);

const db = getFirestore(app);
const bikeImageUrls = [
  "http://127.0.0.1:5000/assets/images/image1.png",
  "http://127.0.0.1:5000/assets/images/image2.png",
  "http://127.0.0.1:5000/assets/images/image3.png",
  "http://127.0.0.1:5000/assets/images/image4.png",
  "http://127.0.0.1:5000/assets/images/image5.png",
  "http://127.0.0.1:5000/assets/images/image6.png",
  "http://127.0.0.1:5000/assets/images/image7.png",
  "http://127.0.0.1:5000/assets/images/image8.png"
];

const documents = bikeImageUrls.map((imageUrl, index) => {
  const number = String(index + 1).padStart(2, "0");
  const filename = `image${index + 1}.png`;
  const id = `demo-bike-${number}`;

  return {
    collection: "bikes",
    id,
    fields: {
      name: `LOCAL DEMO Scooter ${number}`,
      price: 1,
      model: `LOCAL-DEMO-${number}`,
      brand: "LOCAL TEST",
      shortDescription: "Local emulator placeholder; not for sale.",
      description: "LOCAL DEMO DATA ONLY. Placeholder price and specifications are not real inventory.",
      batteryChemistry: "Local demo placeholder",
      range: "1 km (local placeholder)",
      batteryWarranty: "Local demo only",
      motor: "Local demo placeholder",
      topSpeed: "1 km/h (local placeholder)",
      imageUrls: [imageUrl],
      imagePaths: [`bike-images/${id}/${filename}`],
      stockQuantity: 0,
      status: "published"
    }
  };
});

documents.push({
  collection: "homepageSlides",
  id: "demo-homepage-showcase",
  fields: {
    title: "LOCAL DEMO SHOWCASE",
    description: "Local emulator preview only; not production content.",
    buttonText: "VIEW SCOOTERS",
    buttonUrl: "#bikes",
    imageUrl: "http://127.0.0.1:5000/assets/images/WELLEXSA%20Electric%20Scooter%20Showcase.png",
    imagePath: "homepage-slides/demo-homepage-showcase/showcase.png",
    order: 0,
    enabled: true,
    active: true,
    status: "published"
  }
});

const references = documents.map(({ collection, id }) => db.collection(collection).doc(id));

async function probeEmulator() {
  await db.collection("bikes").limit(1).get();
}

function documentData(fields) {
  return {
    ...fields,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

function verifySnapshot(snapshot, document) {
  assert.equal(snapshot.exists, true, `Missing ${document.collection}/${document.id}.`);
  assert.equal(snapshot.id, document.id, `Unexpected document ID for ${document.id}.`);

  const actual = snapshot.data();
  const expectedKeys = [...Object.keys(document.fields), "createdAt", "updatedAt"].sort();
  assert.deepEqual(Object.keys(actual).sort(), expectedKeys, `Unexpected fields in ${document.id}.`);

  for (const [field, expectedValue] of Object.entries(document.fields)) {
    assert.deepEqual(actual[field], expectedValue, `Unexpected ${field} in ${document.id}.`);
  }

  assert.equal(actual.createdAt instanceof Timestamp, true, `Invalid createdAt in ${document.id}.`);
  assert.equal(actual.updatedAt instanceof Timestamp, true, `Invalid updatedAt in ${document.id}.`);
}

async function seed() {
  try {
    await probeEmulator();

    const existingSnapshots = await db.getAll(...references);
    const existingIds = existingSnapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => snapshot.ref.path);

    if (existingIds.length > 0) {
      throw new Error(`Refusing to overwrite existing emulator documents: ${existingIds.join(", ")}.`);
    }

    await db.runTransaction(async (transaction) => {
      const transactionSnapshots = await transaction.getAll(...references);
      const transactionExisting = transactionSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => snapshot.ref.path);

      if (transactionExisting.length > 0) {
        throw new Error(`Refusing to overwrite existing emulator documents: ${transactionExisting.join(", ")}.`);
      }

      documents.forEach((document, index) => {
        transaction.create(references[index], documentData(document.fields));
      });
    });

    const createdSnapshots = await db.getAll(...references);
    createdSnapshots.forEach((snapshot, index) => verifySnapshot(snapshot, documents[index]));

    console.log(`Created and verified ${createdSnapshots.length} documents in ${PROJECT_ID} at ${EMULATOR_HOST}.`);
    for (const document of documents) {
      console.log(`PASS ${document.collection}/${document.id}`);
    }
  } finally {
    await app.delete();
  }
}

await seed();
