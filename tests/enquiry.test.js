import assert from "node:assert/strict";
import test from "node:test";
import { buildWhatsAppUrl } from "../js/enquiry-whatsapp.js";

test("builds the requested WhatsApp draft for manual sending", () => {
  const url = new URL(buildWhatsAppUrl({
    scooterName: "[BIKE NAME]",
    scooterModel: "[BIKE MODEL]",
    customerName: "[CUSTOMER NAME]",
    mobileNumber: "[CUSTOMER MOBILE NUMBER]"
  }));
  assert.equal(url.origin + url.pathname, "https://wa.me/919989992230");
  assert.equal(url.searchParams.get("text"), [
    "Hello WELLEXSA MOTORS,",
    "",
    "I am interested in the [BIKE NAME] [BIKE MODEL].",
    "",
    "Customer Name: [CUSTOMER NAME]",
    "Mobile Number: [CUSTOMER MOBILE NUMBER]",
    "",
    "Enquiry: Please share the price, availability and more details."
  ].join("\n"));
});
