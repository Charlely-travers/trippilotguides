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

async function sendChecklistEmail({ email, slug }) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");
  const url = checklistUrl(slug);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.LEAD_MAGNET_FROM_EMAIL || "TripPilot Guides <hello@trippilotguides.com>",
      to: email,
      subject: "Votre checklist TripPilot",
      html: [
        "<p>Voici votre checklist gratuite.</p>",
        `<p><a href="${url}">${url}</a></p>`,
        "<p>Bon voyage,<br/>TripPilot Guides</p>",
      ].join("\n"),
    }),
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

  const query = new URL(req.url, process.env.SITE_URL || "https://example.com").searchParams;
  const body = req.method === "POST" ? parseForm(await readBody(req)) : {};
  const email = String(body.email || query.get("email") || "").trim();
  const slug = String(body.slug || query.get("slug") || "").trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !slug) {
    res.status(400).json({ error: "invalid_email_or_slug" });
    return;
  }

  await sendChecklistEmail({ email, slug });
  const redirectUrl =
    process.env.LEAD_MAGNET_SUCCESS_URL ||
    `${String(process.env.SITE_URL || "").replace(/\/$/, "")}/checklists/${encodeURIComponent(slug)}?sent=1`;
  res.writeHead(303, { Location: redirectUrl });
  res.end();
}
