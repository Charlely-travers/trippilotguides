import test from "node:test";
import assert from "node:assert/strict";

import {
  getReadinessReport,
  isPlaceholderValue,
  isUsableStripeSecretKey,
} from "../lib/env-validation.mjs";

test("detects obvious placeholder values", () => {
  assert.equal(isPlaceholderValue("https://ton-site.com"), true);
  assert.equal(isPlaceholderValue("https://ton-formulaire-tally-ou-brevo"), true);
  assert.equal(isPlaceholderValue("sk_test_..."), true);
  assert.equal(isPlaceholderValue("https://trippilotguides.com"), false);
});

test("accepts only usable-looking Stripe secret keys", () => {
  assert.equal(isUsableStripeSecretKey("sk_test_..."), false);
  assert.equal(isUsableStripeSecretKey("sk_live_..."), false);
  assert.equal(isUsableStripeSecretKey("pk_live_1234567890"), false);
  assert.equal(isUsableStripeSecretKey("sk_test_1234567890abcdef"), true);
});

test("reports missing production pieces without exposing secrets", () => {
  const report = getReadinessReport({
    SITE_URL: "https://ton-site.com",
    MISTRAL_API_KEY: "secret_should_not_leak",
    STRIPE_SECRET_KEY: "sk_test_...",
    DEFAULT_CHECKLIST_FORM_LINK: "https://ton-formulaire-tally-ou-brevo",
  });

  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes("SITE_URL_PLACEHOLDER"));
  assert.ok(report.blockers.includes("STRIPE_SECRET_KEY_PLACEHOLDER"));
  assert.ok(report.blockers.includes("CHECKLIST_FORM_LINK_PLACEHOLDER"));
  assert.doesNotMatch(JSON.stringify(report), /secret_should_not_leak/);
});
