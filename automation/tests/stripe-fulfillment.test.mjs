import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGuideDeliveryUrl,
  handleStripeWebhook,
  signStripePayloadForTest,
  verifyStripeSignature,
} from "../lib/stripe-fulfillment.mjs";

test("verifies Stripe webhook signatures", () => {
  const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
  const secret = "whsec_test_secret";
  const signature = signStripePayloadForTest({ payload, secret, timestamp: 1_800_000_000 });

  assert.equal(
    verifyStripeSignature({ payload, signature, secret, now: 1_800_000_100 }),
    true
  );
  assert.equal(
    verifyStripeSignature({ payload, signature, secret: "wrong", now: 1_800_000_100 }),
    false
  );
});

test("builds a delivery URL from a slug", () => {
  assert.equal(
    buildGuideDeliveryUrl({
      env: { GUIDE_DELIVERY_BASE_URL: "https://trippilotguides.com/delivery" },
      slug: "lisbonne",
      token: "abc123",
    }),
    "https://trippilotguides.com/delivery/lisbonne-abc123/guide.pdf"
  );
});

test("fulfills checkout.session.completed by sending a guide email", async () => {
  const event = {
    id: "evt_123",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_123",
        customer_details: { email: "buyer@example.com" },
        metadata: {
          trip_pilot_slug: "porto",
          trip_pilot_destination: "Porto",
          trip_pilot_delivery_token: "tok123",
        },
      },
    },
  };
  const payload = JSON.stringify(event);
  const secret = "whsec_test_secret";
  const signature = signStripePayloadForTest({ payload, secret, timestamp: 1_800_000_000 });
  const sent = [];

  const result = await handleStripeWebhook({
    payload,
    signature,
    env: {
      STRIPE_WEBHOOK_SECRET: secret,
      GUIDE_DELIVERY_BASE_URL: "https://trippilotguides.com/delivery",
      FULFILLMENT_FROM_EMAIL: "TripPilot <hello@trippilotguides.com>",
    },
    now: 1_800_000_100,
    sendEmail: async (email) => {
      sent.push(email);
      return { id: "email_123" };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(sent[0].to, "buyer@example.com");
  assert.match(sent[0].html, /https:\/\/trippilotguides\.com\/delivery\/porto-tok123\/guide\.pdf/);
});
