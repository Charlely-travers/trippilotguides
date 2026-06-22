/**
 * TripPilot Guides — Annonce automatique des nouveaux guides à la liste email.
 *
 * Lit automation/output/summary.json (produits publiés ce run), et pour chaque
 * NOUVELLE ville (jamais encore annoncée), crée + envoie un "broadcast" Resend
 * à ton audience. Ferme la Voie 3 : collecte auto + relance auto.
 *
 * Pré-requis : RESEND_API_KEY + RESEND_AUDIENCE_ID. Sans eux, le script ne fait
 * rien (sortie propre, ne bloque jamais le pipeline).
 *
 * État anti-doublon : automation/published-broadcasts.json (committé par le workflow).
 */

import "./lib/load-env.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { renderBrandedEmail, normalizeFromAddress } from "./lib/email-template.mjs";

const ROOT = process.cwd();
const SUMMARY_FILE = path.join(ROOT, "automation", "output", "summary.json");
const PRODUCTS_DIR = path.join(ROOT, "automation", "products");
const STATE_FILE = path.join(ROOT, "automation", "published-broadcasts.json");

const API_KEY = process.env.RESEND_API_KEY;
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;
const FROM = normalizeFromAddress(
  process.env.LEAD_MAGNET_FROM_EMAIL ||
    process.env.FULFILLMENT_FROM_EMAIL ||
    "TripPilot Guides <hello@trippilotguides.com>"
);
const SITE = String(process.env.SITE_URL || "https://www.trippilotguides.com").replace(/\/$/, "");

async function readJsonSafe(filepath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filepath, "utf8"));
  } catch {
    return fallback;
  }
}

function buildAnnouncementEmail({ destination, title, guideUrl, checklistUrl, price }) {
  const dest = destination || title;
  const intro =
    `<p style="margin:0 0 14px;">Bonne nouvelle : un nouveau guide vient d'arriver sur TripPilot Guides 🧭</p>` +
    `<p style="margin:0;">Voici <strong>${title}</strong> — itinéraire jour par jour, budget détaillé, ` +
    `quartiers où dormir, transports et bonnes adresses, dans un PDF clair et prêt à suivre.</p>`;
  const secondaryHtml =
    `<div style="margin-top:8px;padding:18px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">` +
    `<p style="margin:0 0 6px;font-size:15px;color:#0b1120;font-weight:700;">Pas encore décidé ?</p>` +
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#475569;">Télécharge d'abord la checklist gratuite pour ${dest} et garde le guide complet sous la main pour planifier.</p>` +
    `<a href="${checklistUrl}" style="font-size:14px;font-weight:700;color:#4f46e5;text-decoration:none;">Voir la checklist gratuite →</a>` +
    `</div>`;
  const html = renderBrandedEmail({
    siteUrl: SITE,
    preheader: `Nouveau guide : ${dest}${price ? ` — ${price}` : ""}.`,
    heading: `Nouveau guide : ${dest}`,
    intro,
    ctaLabel: `Voir le guide ${dest}`,
    ctaUrl: guideUrl,
    secondaryHtml,
    footerNote:
      "Vous recevez cet email car vous êtes inscrit·e à TripPilot Guides. Pour vous désinscrire, répondez \"stop\" à cet email.",
  });
  const text =
    `Nouveau guide : ${title}\n\n` +
    `Itinéraire jour par jour, budget détaillé, quartiers et bonnes adresses.\n` +
    `Le guide : ${guideUrl}\n` +
    `La checklist gratuite : ${checklistUrl}\n\n` +
    `TripPilot Guides`;
  return { html, text };
}

/** Crée un broadcast Resend puis l'envoie. Renvoie true si OK. */
async function sendBroadcast({ subject, html, text }) {
  // 1) Création
  const createRes = await fetch("https://api.resend.com/broadcasts", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ audience_id: AUDIENCE_ID, from: FROM, subject, html, text }),
  });
  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    throw new Error(`create HTTP ${createRes.status}: ${t.slice(0, 200)}`);
  }
  const created = await createRes.json();
  const id = created?.id || created?.data?.id;
  if (!id) throw new Error("broadcast id manquant");

  // 2) Envoi immédiat
  const sendRes = await fetch(`https://api.resend.com/broadcasts/${id}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!sendRes.ok) {
    const t = await sendRes.text().catch(() => "");
    throw new Error(`send HTTP ${sendRes.status}: ${t.slice(0, 200)}`);
  }
  return id;
}

async function main() {
  if (!API_KEY || !AUDIENCE_ID) {
    console.log("Broadcast ignoré : RESEND_API_KEY ou RESEND_AUDIENCE_ID absent.");
    return;
  }

  const summary = await readJsonSafe(SUMMARY_FILE, {});
  const products = summary?.productize?.products || [];
  const state = await readJsonSafe(STATE_FILE, { announced: [] });
  const announced = new Set(state.announced || []);

  // Ne garde que les guides réellement publiés et jamais annoncés.
  const fresh = products.filter(
    (p) => p.slug && p.guideDraft === false && !announced.has(p.slug)
  );

  if (!fresh.length) {
    console.log("Broadcast : aucune nouvelle ville à annoncer.");
    return;
  }

  const sent = [];
  for (const p of fresh) {
    const product = await readJsonSafe(path.join(PRODUCTS_DIR, p.slug, "product.json"), {});
    const destination = product.destination || p.slug;
    const title = product.title || `${destination} - guide complet`;
    const guideUrl = `${SITE}${product.guidePagePath || `/guides/${p.slug}`}`;
    const checklistUrl = `${SITE}${product.checklistPagePath || `/checklists/${p.slug}`}`;
    const { html, text } = buildAnnouncementEmail({
      destination,
      title,
      guideUrl,
      checklistUrl,
      price: product.price,
    });
    try {
      const id = await sendBroadcast({ subject: `Nouveau guide : ${destination}`, html, text });
      announced.add(p.slug);
      sent.push({ slug: p.slug, id });
      console.log(`Broadcast envoyé pour ${p.slug} (id: ${id})`);
    } catch (err) {
      console.error(`Broadcast échec pour ${p.slug} : ${err.message}`);
    }
  }

  // Persiste l'état anti-doublon.
  state.announced = [...announced];
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");

  // Trace dans le summary pour la notification Discord.
  summary.broadcast = { sent: sent.length, items: sent };
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
  console.log(`Broadcasts envoyés : ${sent.length}`);
}

main().catch((err) => {
  console.error("Erreur broadcast :", err?.message || err);
  process.exit(0); // ne bloque jamais le pipeline
});
