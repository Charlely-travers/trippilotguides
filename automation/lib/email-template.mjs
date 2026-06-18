/**
 * Template d'email HTML de marque pour TripPilot Guides.
 * Compatible clients email (tables inline styles), responsive, avec logo et CTA.
 */

/** Normalise une adresse "Nom email@x" -> "Nom <email@x>" attendue par Resend. */
export function normalizeFromAddress(value, fallback = "TripPilot Guides <hello@trippilotguides.com>") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (raw.includes("<") && raw.includes(">")) return raw;
  // Cherche l'email dans la chaîne
  const emailMatch = raw.match(/[^\s<>]+@[^\s<>]+\.[^\s<>]+/);
  if (!emailMatch) return fallback;
  const email = emailMatch[0];
  const name = raw.replace(email, "").trim() || "TripPilot Guides";
  return `${name} <${email}>`;
}

const BRAND = {
  name: "TripPilot Guides",
  indigo: "#4f46e5",
  violet: "#7c3aed",
  ink: "#0b1120",
  slate: "#475569",
  light: "#f1f5f9",
};

/**
 * Construit un email HTML responsive et stylé.
 * @param {object} opts
 * @param {string} opts.siteUrl
 * @param {string} opts.preheader - texte d'aperçu (caché)
 * @param {string} opts.heading
 * @param {string} opts.intro - HTML
 * @param {string} [opts.ctaLabel]
 * @param {string} [opts.ctaUrl]
 * @param {string} [opts.secondaryHtml] - bloc secondaire HTML
 * @param {string} [opts.footerNote]
 */
export function renderBrandedEmail({
  siteUrl = "https://trippilotguides.com",
  preheader = "",
  heading = "",
  intro = "",
  ctaLabel = "",
  ctaUrl = "",
  secondaryHtml = "",
  footerNote = "",
}) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  const logoUrl = `${base}/logo.png`;
  const year = new Date().getFullYear();

  const ctaButton =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
          <tr><td style="border-radius:9999px;background:linear-gradient(135deg,${BRAND.indigo},${BRAND.violet});">
            <a href="${ctaUrl}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:9999px;">${ctaLabel}</a>
          </td></tr>
        </table>`
      : "";

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
</head>
<body style="margin:0;padding:0;background-color:#eef2ff;font-family:Arial,Helvetica,sans-serif;">
  <span style="display:none;font-size:1px;color:#eef2ff;max-height:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef2ff;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px -12px rgba(15,23,42,0.18);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.indigo},${BRAND.violet});padding:28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="${logoUrl}" width="36" height="36" alt="" style="display:block;border-radius:8px;" />
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;">
                    <span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">${BRAND.name}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${heading ? `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:${BRAND.ink};font-weight:800;">${heading}</h1>` : ""}
              <div style="font-size:16px;line-height:1.6;color:${BRAND.slate};">${intro}</div>
              ${ctaButton}
              ${secondaryHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:${BRAND.light};">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:#94a3b8;">${footerNote || `Vous recevez cet email de la part de ${BRAND.name}.`}</p>
              <p style="margin:0;font-size:12px;color:#94a3b8;">© ${year} ${BRAND.name} · <a href="${base}" style="color:${BRAND.indigo};text-decoration:none;">trippilotguides.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
