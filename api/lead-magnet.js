import fs from "node:fs";
import path from "node:path";
import { renderBrandedEmail, normalizeFromAddress } from "../automation/lib/email-template.mjs";

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body));
}

function checklistUrl(slug) {
  const base = String(
    process.env.CHECKLIST_DELIVERY_BASE_URL ||
      `${process.env.SITE_URL || ""}/print/checklist`
  ).replace(/\/$/, "");
  return `${base}/${encodeURIComponent(slug)}`;
}

/**
 * Tente de trouver le fichier checklist.pdf correspondant au slug dans public/delivery/.
 * Le dossier a un hash, donc on scanne les dossiers qui commencent par le slug.
 */
function findChecklistPdf(slug) {
  const deliveryDir = path.join(process.cwd(), "public", "delivery");
  try {
    const dirs = fs.readdirSync(deliveryDir);
    const match = dirs.find((d) => d.startsWith(slug));
    if (match) {
      const pdfPath = path.join(deliveryDir, match, "checklist.pdf");
      if (fs.existsSync(pdfPath)) return pdfPath;
    }
  } catch {
    // pas de dossier delivery ou pas de PDF
  }
  return null;
}

async function sendChecklistEmail({ email, slug }) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");

  const pdfPath = findChecklistPdf(slug);
  const url = checklistUrl(slug);
  const siteUrl = String(process.env.SITE_URL || "https://trippilotguides.com").replace(/\/$/, "");
  const guideUrl = `${siteUrl}/guides/${encodeURIComponent(slug)}`;

  const intro =
    `<p style="margin:0 0 14px;">Merci pour votre inscription ! Voici votre <strong>checklist de voyage gratuite</strong> pour partir l'esprit tranquille, sans rien oublier.</p>` +
    (pdfPath
      ? `<p style="margin:0;">Le PDF est <strong>en pièce jointe</strong> de cet email — enregistrez-le ou imprimez-le.</p>`
      : `<p style="margin:0;">Retrouvez votre checklist imprimable en cliquant sur le bouton ci-dessous.</p>`);

  const secondaryHtml =
    `<div style="margin-top:8px;padding:18px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">` +
    `<p style="margin:0 0 6px;font-size:15px;color:#0b1120;font-weight:700;">Envie d'un itinéraire complet ?</p>` +
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#475569;">Notre guide PDF complet contient l'itinéraire jour par jour, le budget détaillé et les meilleurs quartiers où dormir.</p>` +
    `<a href="${guideUrl}" style="font-size:14px;font-weight:700;color:#4f46e5;text-decoration:none;">Découvrir le guide complet →</a>` +
    `</div>`;

  const html = renderBrandedEmail({
    siteUrl,
    preheader: "Votre checklist de voyage gratuite est arrivée.",
    heading: "Votre checklist de voyage gratuite",
    intro,
    ctaLabel: pdfPath ? "" : "Voir ma checklist",
    ctaUrl: pdfPath ? "" : url,
    secondaryHtml,
    footerNote:
      "Vous recevez cet email car vous avez demandé la checklist gratuite sur trippilotguides.com. Pour vous désinscrire, répondez \"stop\" à cet email.",
  });

  const payload = {
    from: normalizeFromAddress(process.env.LEAD_MAGNET_FROM_EMAIL),
    to: email,
    subject: "Votre checklist voyage gratuite — TripPilot Guides",
    html,
    text:
      `Merci pour votre inscription !\n\n` +
      (pdfPath
        ? `Votre checklist est en pièce jointe de cet email.\n\n`
        : `Votre checklist : ${url}\n\n`) +
      `Envie d'un itinéraire complet ? Découvrez le guide : ${guideUrl}\n\n` +
      `TripPilot Guides`,
  };

  // Attacher le PDF si disponible
  if (pdfPath) {
    const pdfBuffer = fs.readFileSync(pdfPath);
    payload.attachments = [
      {
        filename: `checklist-${slug}.pdf`,
        content: pdfBuffer.toString("base64"),
      },
    ];
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Resend HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const query = new URL(
    req.url,
    process.env.SITE_URL || "https://example.com"
  ).searchParams;
  const body = req.method === "POST" ? parseForm(await readBody(req)) : {};
  const email = String(body.email || query.get("email") || "").trim();
  const slug = String(body.slug || query.get("slug") || "").trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !slug) {
    res.status(400).json({ error: "invalid_email_or_slug" });
    return;
  }

  try {
    await sendChecklistEmail({ email, slug });
  } catch (err) {
    console.error("lead-magnet error:", err.message);
    res.status(500).json({ error: "email_send_failed" });
    return;
  }

  const redirectUrl =
    process.env.LEAD_MAGNET_SUCCESS_URL ||
    `${String(process.env.SITE_URL || "https://www.trippilotguides.com").replace(/\/$/, "")}/checklists?sent=1`;
  res.writeHead(303, { Location: redirectUrl });
  res.end();
}
