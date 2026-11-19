import assert from "node:assert/strict";
import test from "node:test";
import { buildWhatsAppUrl } from "../js/enquiry-whatsapp.js";

test("builds the requested WhatsApp draft for manual sending", () => {
  const url = new URL(buildWhatsAppUrl("[BIKE MODEL]", "[CUSTOMER NAME]", "[CUSTOMER MOBILE NUMBER]"));
  assert.equal(url.origin + url.pathname, "https://wa.me/919989992230");
  assert.equal(url.searchParams.get("text"), [
    "Hello WELLEXSA MOTORS,",
    "",
    "I am interested in the [BIKE MODEL].",
    "",
    "Customer Name: [CUSTOMER NAME]",
    "Mobile Number: [CUSTOMER MOBILE NUMBER]",
    "",
    "Please contact me with more details."
  ].join("\n"));
});
