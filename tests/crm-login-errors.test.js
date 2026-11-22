import assert from "node:assert/strict";
import test from "node:test";
import { crmLoginErrorMessage, crmRoleMismatchMessage } from "../js/crm-login-errors.js";

test("maps invalid Firebase credentials without revealing account existence", () => {
  assert.equal(
    crmLoginErrorMessage({ code: "auth/invalid-credential" }, "owner"),
    "Incorrect email or password."
  );
});

test("distinguishes missing Owner access from missing Staff access", () => {
  assert.match(crmLoginErrorMessage({ code: "functions/not-found" }, "owner"), /Owner access is not configured/);
  assert.match(crmLoginErrorMessage({ code: "functions/not-found" }, "staff"), /CRM access is not configured/);
});

test("explains disabled access and fresh-session requirements", () => {
  assert.match(crmLoginErrorMessage({
    code: "functions/permission-denied",
    message: "CRM access is inactive."
  }, "owner"), /inactive/);
  assert.match(crmLoginErrorMessage({
    code: "functions/failed-precondition",
    message: "Sign out and sign in again to activate this CRM session."
  }, "owner"), /sign in again/);
});

test("reports missing authentication-time policy and insufficient CRM permissions", () => {
  assert.match(crmLoginErrorMessage({
    code: "functions/failed-precondition",
    message: "The CRM access record is missing its authentication-time requirement."
  }, "owner"), /authentication-time threshold/);
  assert.match(crmLoginErrorMessage({
    code: "functions/permission-denied",
    message: "This CRM permission is not assigned to your account."
  }, "staff"), /required CRM permissions/);
});

test("distinguishes email verification and Firebase connectivity failures", () => {
  assert.match(crmLoginErrorMessage({
    code: "functions/failed-precondition",
    message: "Verify the account email before using CRM access."
  }, "owner"), /Verify your email/);
  assert.match(crmLoginErrorMessage({ code: "functions/unavailable" }, "owner"), /Firebase/);
});

test("does not allow Staff sessions to proceed to the Owner workspace", () => {
  assert.match(crmRoleMismatchMessage("owner", "staff"), /Staff accounts cannot access the Owner workspace/);
  assert.match(crmRoleMismatchMessage("staff", "owner"), /Owner accounts must use Owner sign-in/);
});

test("distinguishes Firebase Authentication account disablement", () => {
  assert.match(crmLoginErrorMessage({ code: "auth/user-disabled" }, "owner"), /Firebase account is disabled/);
});

test("identifies Firebase Console provider and domain configuration errors", () => {
  assert.match(crmLoginErrorMessage({ code: "auth/operation-not-allowed" }, "owner"), /Email and password sign-in is disabled/);
  assert.match(crmLoginErrorMessage({ code: "auth/unauthorized-domain" }, "owner"), /domain is not authorized/);
});
