import crypto from "node:crypto";
import { isUsableUrl } from "./env-validation.mjs";
import { renderBrandedEmail, normalizeFromAddress } from "./email-template.mjs";

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

export function buildFulfillmentEmail({ to, destination, guideUrl, from, siteUrl }) {
  const subject = destination
    ? `Votre guide TripPilot pour ${destination} est prêt`
    : "Votre guide TripPilot est prêt";
  const dest = destination || "votre destination";
  const intro =
    `<p style="margin:0 0 14px;">Merci pour votre achat, et bravo pour cette future aventure à <strong>${dest}</strong> !</p>` +
    `<p style="margin:0;">Votre guide PDF complet est prêt : itinéraire jour par jour, budget détaillé, quartiers où dormir et checklist imprimable. Cliquez ci-dessous pour le télécharger.</p>`;
  const secondaryHtml =
    `<div style="margin-top:8px;padding:16px 18px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">` +
    `<p style="margin:0 0 6px;font-size:14px;color:#0b1120;font-weight:700;">Astuce</p>` +
    `<p style="margin:0;font-size:14px;line-height:1.5;color:#475569;">Enregistrez le PDF sur votre téléphone pour l'avoir hors-ligne pendant le voyage. Le lien reste accessible, mais une copie locale ne dépend pas du réseau.</p>` +
    `</div>`;
  const html = renderBrandedEmail({
    siteUrl,
    preheader: `Votre guide ${dest} est disponible au téléchargement.`,
    heading: `Votre guide pour ${dest} est prêt`,
    intro,
    ctaLabel: "Télécharger mon guide PDF",
    ctaUrl: guideUrl,
    secondaryHtml,
    footerNote:
      "Vous recevez cet email car vous avez acheté un guide sur trippilotguides.com. Une question ? Répondez simplement à cet email.",
  });
  return {
    from: normalizeFromAddress(from),
    to,
    reply_to: "hello@trippilotguides.com",
    subject,
    headers: {
      "List-Unsubscribe": "<mailto:hello@trippilotguides.com?subject=unsubscribe>",
    },
    html,
    text:
      `Merci pour votre achat !\n\n` +
      `Votre guide pour ${dest} est disponible ici : ${guideUrl}\n\n` +
      `Bon voyage,\nTripPilot Guides`,
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

  await sendEmail(buildFulfillmentEmail({ to: email, destination, guideUrl, from, siteUrl: env.SITE_URL }));
  await addBuyerToAudience({ email, slug, env });
  return { status: 200, body: { received: true, fulfilled: true, slug } };
}

/**
 * Ajoute l'acheteur à l'audience Resend (liste = contacts les plus précieux).
 * Best-effort : n'échoue jamais la livraison du guide.
 */
async function addBuyerToAudience({ email, slug, env = process.env }) {
  const audienceId = env.RESEND_AUDIENCE_ID;
  if (!env.RESEND_API_KEY || !audienceId || !email) return;
  try {
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        unsubscribed: false,
        first_name: slug ? `Acheteur ${slug}` : "Acheteur",
      }),
    });
    if (!res.ok && res.status !== 409) {
      const t = await res.text().catch(() => "");
      console.error(`buyer audience add failed: HTTP ${res.status} ${t.slice(0, 150)}`);
    }
  } catch (err) {
    console.error("buyer audience add error:", err.message);
  }
}
