import { isUsableStripeSecretKey } from "./env-validation.mjs";

const STRIPE_API_VERSION = "2026-02-25.clover";
const DEFAULT_PRICE_CENTS = 900;
const DEFAULT_CURRENCY = "eur";

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function isExplicitFalse(value) {
  return /^(0|false|no|off)$/i.test(String(value || "").trim());
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getStripePaymentConfig(env = process.env) {
  const secretKey = String(env.STRIPE_SECRET_KEY || "").trim();
  const autoCreateRaw = env.AUTO_CREATE_STRIPE_PAYMENT_LINKS;
  const enabled = isUsableStripeSecretKey(secretKey) && !isExplicitFalse(autoCreateRaw);

  return {
    enabled,
    secretKey,
    apiVersion: String(env.STRIPE_API_VERSION || STRIPE_API_VERSION).trim(),
    currency: String(env.STRIPE_PAYMENT_LINK_CURRENCY || DEFAULT_CURRENCY)
      .trim()
      .toLowerCase(),
    unitAmount: toPositiveInt(
      env.STRIPE_PAYMENT_LINK_PRICE_CENTS,
      DEFAULT_PRICE_CENTS
    ),
    automaticTax: isTruthy(env.STRIPE_PAYMENT_LINK_AUTOMATIC_TAX),
    allowPromotionCodes: isTruthy(env.STRIPE_PAYMENT_LINK_ALLOW_PROMO_CODES),
  };
}

export function buildStripePaymentLinkParams({
  slug,
  title,
  description,
  destination,
  deliveryToken,
  siteUrl,
  config = getStripePaymentConfig(),
}) {
  const params = new URLSearchParams();
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", config.currency);
  params.set("line_items[0][price_data][unit_amount]", String(config.unitAmount));
  params.set("line_items[0][price_data][product_data][name]", title);
  params.set("line_items[0][price_data][product_data][description]", description);
  params.set("line_items[0][price_data][product_data][metadata][trip_pilot_slug]", slug);
  params.set(
    "line_items[0][price_data][product_data][metadata][trip_pilot_destination]",
    destination
  );
  params.set("metadata[trip_pilot_slug]", slug);
  params.set("metadata[trip_pilot_destination]", destination);
  params.set("metadata[source]", "trippilot-automation");
  if (deliveryToken) {
    params.set("metadata[trip_pilot_delivery_token]", deliveryToken);
  }
  params.set("after_completion[type]", "hosted_confirmation");
  params.set(
    "after_completion[hosted_confirmation][custom_message]",
    "Merci, votre paiement est confirme. Vous allez recevoir les informations de livraison du guide."
  );

  if (siteUrl) {
    params.set("metadata[site_url]", siteUrl);
  }
  if (config.automaticTax) {
    params.set("automatic_tax[enabled]", "true");
  }
  if (config.allowPromotionCodes) {
    params.set("allow_promotion_codes", "true");
  }

  return params;
}

export async function createStripePaymentLink({
  slug,
  title,
  description,
  destination,
  deliveryToken,
  siteUrl,
  config = getStripePaymentConfig(),
  fetchImpl = globalThis.fetch,
}) {
  if (!config.enabled) {
    return { provider: "stripe", created: false, url: "", reason: "stripe_not_configured" };
  }
  if (typeof fetchImpl !== "function") {
    return { provider: "stripe", created: false, url: "", reason: "fetch_unavailable" };
  }

  const params = buildStripePaymentLinkParams({
    slug,
    title,
    description,
    destination,
    deliveryToken,
    siteUrl,
    config,
  });

  const response = await fetchImpl("https://api.stripe.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": config.apiVersion,
      "Idempotency-Key": `trippilot-payment-link-${slug}-v1`,
    },
    body: params,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Stripe HTTP ${response.status}`;
    return {
      provider: "stripe",
      created: false,
      url: "",
      reason: "stripe_error",
      error: message,
    };
  }

  return {
    provider: "stripe",
    created: true,
    url: String(payload.url || ""),
    id: payload.id,
    livemode: Boolean(payload.livemode),
  };
}
