import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStripePaymentLinkParams,
  createStripePaymentLink,
  getStripePaymentConfig,
} from "../lib/stripe-payment-links.mjs";

test("enables automatic Stripe payment links when a secret key exists", () => {
  const config = getStripePaymentConfig({
    STRIPE_SECRET_KEY: "sk_test_1234567890abcdef",
    STRIPE_PAYMENT_LINK_PRICE_CENTS: "1200",
    STRIPE_PAYMENT_LINK_CURRENCY: "EUR",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.unitAmount, 1200);
  assert.equal(config.currency, "eur");
});

test("can explicitly disable Stripe payment link creation", () => {
  const config = getStripePaymentConfig({
    STRIPE_SECRET_KEY: "sk_test_123",
    AUTO_CREATE_STRIPE_PAYMENT_LINKS: "false",
  });

  assert.equal(config.enabled, false);
});

test("builds Stripe Payment Link parameters for a guide", () => {
  const params = buildStripePaymentLinkParams({
    slug: "lisbonne",
    title: "Lisbonne en 4 jours - guide complet",
    description: "Guide PDF Lisbonne.",
    destination: "Lisbonne",
    siteUrl: "https://trippilotguides.com",
    config: {
      currency: "eur",
      unitAmount: 900,
      automaticTax: true,
      allowPromotionCodes: true,
    },
  });

  assert.equal(params.get("line_items[0][quantity]"), "1");
  assert.equal(params.get("line_items[0][price_data][currency]"), "eur");
  assert.equal(params.get("line_items[0][price_data][unit_amount]"), "900");
  assert.equal(
    params.get("line_items[0][price_data][product_data][name]"),
    "Lisbonne en 4 jours - guide complet"
  );
  assert.equal(params.get("automatic_tax[enabled]"), "true");
  assert.equal(params.get("allow_promotion_codes"), "true");
});

test("creates a Stripe Payment Link through fetch", async () => {
  const calls = [];
  const result = await createStripePaymentLink({
    slug: "porto",
    title: "Porto en 3 jours - guide complet",
    description: "Guide PDF Porto.",
    destination: "Porto",
    siteUrl: "https://trippilotguides.com",
    config: {
      enabled: true,
      secretKey: "sk_test_123",
      apiVersion: "2026-02-25.clover",
      currency: "eur",
      unitAmount: 900,
      automaticTax: false,
      allowPromotionCodes: false,
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          id: "plink_123",
          url: "https://buy.stripe.com/test_123",
          livemode: false,
        }),
      };
    },
  });

  assert.equal(result.url, "https://buy.stripe.com/test_123");
  assert.equal(result.created, true);
  assert.equal(calls[0].url, "https://api.stripe.com/v1/payment_links");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk_test_123");
  assert.equal(
    calls[0].options.headers["Idempotency-Key"],
    "trippilot-payment-link-porto-v1"
  );
});
