import fs from "node:fs";
import path from "node:path";

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

  // Préparer le payload Resend
  const payload = {
    from:
      process.env.LEAD_MAGNET_FROM_EMAIL ||
      "TripPilot Guides <hello@trippilotguides.com>",
    to: email,
    subject: `Votre checklist voyage gratuite — TripPilot Guides`,
    html: [
      `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">`,
      `<p style="font-size:16px;"><strong>Bonjour 👋</strong></p>`,
      `<p>Merci pour votre inscription ! Voici votre checklist gratuite pour préparer votre voyage sans rien oublier.</p>`,
      pdfPath
        ? `<p>📎 <strong>Le PDF est en pièce jointe de cet email.</strong> Vous pouvez l'enregistrer ou l'imprimer.</p>`
        : `<p>👉 <a href="${url}" style="color:#4f46e5;font-weight:bold;">Accéder à votre checklist imprimable</a></p>`,
      `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />`,
      `<p style="font-size:14px;">💡 <strong>Envie d'un itinéraire complet ?</strong></p>`,
      `<p style="font-size:14px;">Notre guide PDF complet contient l'itinéraire jour par jour, le budget détaillé et les meilleurs quartiers où dormir. <a href="${String(process.env.SITE_URL || "").replace(/\/$/, "")}/guides/${encodeURIComponent(slug)}" style="color:#4f46e5;">Découvrir le guide →</a></p>`,
      `<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />`,
      `<p style="font-size:12px;color:#64748b;">Vous recevez cet email car vous avez demandé la checklist gratuite sur trippilotguides.com.<br/>Se désinscrire ? Répondez simplement "stop" à cet email.</p>`,
      `</div>`,
    ].join("\n"),
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
    `${String(process.env.SITE_URL || "").replace(/\/$/, "")}/checklists/${encodeURIComponent(slug)}?sent=1`;
  res.writeHead(303, { Location: redirectUrl });
  res.end();
}
