import assert from "node:assert/strict";
import test from "node:test";
import { buildWhatsAppUrl } from "../js/enquiry-whatsapp.js";

test("builds the requested WhatsApp draft for manual sending", () => {
  const url = new URL(buildWhatsAppUrl({
    scooterName: "[BIKE NAME]",
    scooterModel: "[BIKE MODEL]",
    customerName: "[CUSTOMER NAME]",
    mobileNumber: "[CUSTOMER MOBILE NUMBER]",
    enquiryMessage: "I would like to know the current price and range."
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
    "Enquiry: I would like to know the current price and range."
  ].join("\n"));
});
