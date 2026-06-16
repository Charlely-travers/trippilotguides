import { handleStripeWebhook } from "../automation/lib/stripe-fulfillment.mjs";

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function sendResendEmail(email) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY missing");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(email),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Resend HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const payload = await readRawBody(req);
  const signature = req.headers["stripe-signature"] || "";
  const result = await handleStripeWebhook({
    payload,
    signature,
    env: process.env,
    sendEmail: process.env.RESEND_API_KEY ? sendResendEmail : undefined,
  });

  res.status(result.status).json(result.body);
}
