import crypto from "node:crypto";
import { isUsableUrl } from "./env-validation.mjs";

const DEFAULT_TOLERANCE_SECONDS = 300;

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseSignatureHeader(signature) {
  return String(signature || "")
    .split(",")
    .reduce((acc, part) => {
      const [key, value] = part.split("=");
      if (key && value) {
        if (!acc[key]) acc[key] = [];
        acc[key].push(value);
      }
      return acc;
    }, {});
}

function signPayload({ payload, secret, timestamp }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
}

export function signStripePayloadForTest({ payload, secret, timestamp }) {
  return `t=${timestamp},v1=${signPayload({ payload, secret, timestamp })}`;
}

export function verifyStripeSignature({
  payload,
  signature,
  secret,
  now = Math.floor(Date.now() / 1000),
  tolerance = DEFAULT_TOLERANCE_SECONDS,
}) {
  if (!payload || !signature || !secret) return false;
  const parsed = parseSignatureHeader(signature);
  const timestamp = Number(parsed.t?.[0]);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = signPayload({ payload, secret, timestamp });
  return (parsed.v1 || []).some((candidate) => timingSafeEqualHex(candidate, expected));
}

export function buildGuideDeliveryUrl({ env = process.env, slug, token = "" }) {
  const configuredBase = String(env.GUIDE_DELIVERY_BASE_URL || "").replace(/\/$/, "");
  const siteBase = isUsableUrl(env.SITE_URL)
    ? `${String(env.SITE_URL).replace(/\/$/, "")}/delivery`
    : "https://trippilotguides.com/delivery";
  const base = isUsableUrl(configuredBase) ? configuredBase : siteBase;
  const folder = token ? `${slug}-${token}` : slug;
  return `${base}/${encodeURIComponent(folder)}/guide.pdf`;
}

export function buildFulfillmentEmail({ to, destination, guideUrl, from }) {
  const subject = destination
    ? `Votre guide TripPilot pour ${destination}`
    : "Votre guide TripPilot";
  return {
    from,
    to,
    subject,
    html: [
      `<p>Merci pour votre achat.</p>`,
      `<p>Votre guide est disponible ici :</p>`,
      `<p><a href="${guideUrl}">${guideUrl}</a></p>`,
      `<p>Bon voyage,<br/>TripPilot Guides</p>`,
    ].join("\n"),
  };
}

export async function handleStripeWebhook({
  payload,
  signature,
  env = process.env,
  now = Math.floor(Date.now() / 1000),
  sendEmail,
}) {
  if (!verifyStripeSignature({
    payload,
    signature,
    secret: env.STRIPE_WEBHOOK_SECRET,
    now,
  })) {
    return { status: 400, body: { error: "invalid_signature" } };
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }

  if (event.type !== "checkout.session.completed") {
    return { status: 200, body: { received: true, ignored: true } };
  }

  const session = event.data?.object || {};
  const email = session.customer_details?.email || session.customer_email || "";
  const slug = session.metadata?.trip_pilot_slug || "";
  const token = session.metadata?.trip_pilot_delivery_token || "";
  const destination = session.metadata?.trip_pilot_destination || "";

  if (!email || !slug) {
    return { status: 200, body: { received: true, fulfilled: false, reason: "missing_email_or_slug" } };
  }

  const guideUrl = buildGuideDeliveryUrl({ env, slug, token });
  const from = env.FULFILLMENT_FROM_EMAIL || "TripPilot Guides <hello@trippilotguides.com>";
  if (typeof sendEmail !== "function") {
    return { status: 200, body: { received: true, fulfilled: false, reason: "email_not_configured" } };
  }

  await sendEmail(buildFulfillmentEmail({ to: email, destination, guideUrl, from }));
  return { status: 200, body: { received: true, fulfilled: true, slug } };
}
