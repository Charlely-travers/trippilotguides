/**
 * Rendu d'épingles Pinterest PREMIUM via Playwright (HTML/CSS + vraies polices web).
 * Qualité éditoriale : photos de monuments en fond, typographie serif/sans,
 * dégradés, plusieurs templates qui alternent. 100% gratuit (Chromium headless).
 *
 * Repli : si Playwright/Chromium est indisponible, lève une erreur et l'appelant
 * retombe sur le rendu sharp + SVG.
 */

import fs from "node:fs/promises";

const PIN_WIDTH = 1000;
const PIN_HEIGHT = 1500;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Nettoie et raccourcit un titre d'épingle pour qu'il soit percutant et jamais tronqué. */
function cleanTitle(raw, destination) {
  let t = String(raw || "")
    .replace(/#[\p{L}\p{N}_-]+/gu, "") // hashtags
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'«»\s]+|["'«»\s]+$/g, "");

  // Retire une parenthèse ouvrante non fermée en fin (ex: "... parfait (sans se").
  if ((t.match(/\(/g) || []).length > (t.match(/\)/g) || []).length) {
    t = t.replace(/\s*\([^)]*$/, "");
  }
  // Coupe proprement à ~84 caractères sur une frontière de mot (sécurité anti-débordement).
  if (t.length > 84) {
    const cut = t.slice(0, 84);
    t = cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s:,;–-]+$/, "") + "…";
  }
  if (!t) t = `${destination} : le guide`;
  return t;
}

/** Taille de police adaptée à la longueur du titre (évite tout débordement). */
function titleFontSize(title) {
  const n = title.length;
  if (n <= 18) return 96;
  if (n <= 28) return 84;
  if (n <= 40) return 74;
  if (n <= 52) return 64;
  if (n <= 66) return 56;
  return 48;
}

function mimeFromPath(p) {
  if (/\.png$/i.test(p)) return "image/png";
  if (/\.jpe?g$/i.test(p)) return "image/jpeg";
  if (/\.webp$/i.test(p)) return "image/webp";
  return "image/png";
}

async function toDataUri(filePath) {
  const buf = await fs.readFile(filePath);
  return `data:${mimeFromPath(filePath)};base64,${buf.toString("base64")}`;
}

const FONTS_LINK = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet">`;

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${PIN_WIDTH}px; height: ${PIN_HEIGHT}px; overflow: hidden; }
  .pin { position: relative; width: ${PIN_WIDTH}px; height: ${PIN_HEIGHT}px; overflow: hidden; background: #0b1120; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .serif { font-family: 'Playfair Display', Georgia, serif; }
  .sans { font-family: 'Inter', system-ui, sans-serif; }
  .brand {
    position: absolute; top: 54px; left: 54px; z-index: 3;
    display: flex; align-items: center; gap: 14px;
    background: rgba(11,17,32,0.42); backdrop-filter: blur(6px);
    padding: 14px 24px 14px 16px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.18);
  }
  .brand .dot { width: 30px; height: 30px; border-radius: 50%;
    background: linear-gradient(135deg,#818cf8,#34d399); }
  .brand .name { font-family:'Inter',sans-serif; color:#fff; font-weight:800; font-size:28px; letter-spacing:-0.2px; }
  .eyebrow { font-family:'Inter',sans-serif; font-weight:800; letter-spacing:6px;
    text-transform:uppercase; font-size:26px; }
  .rule { height:6px; width:72px; border-radius:3px;
    background:linear-gradient(90deg,#818cf8,#34d399); }
  .foot { font-family:'Inter',sans-serif; }
  .foot .tags { font-weight:700; font-size:27px; color:#fff; opacity:.95; }
  .foot .url { font-weight:600; font-size:23px; color:#cbd5e1; margin-top:6px; }
`;

/** Template 1 — Éditorial plein cadre, bande basse forte, titre serif. */
function templateEditorial(pin, bg) {
  const fs = titleFontSize(pin.title);
  return `<div class="pin">
    <img class="bg" src="${bg}" />
    <div style="position:absolute;inset:0;background:radial-gradient(125% 85% at 50% 18%, rgba(11,17,32,0) 42%, rgba(11,17,32,.42) 100%);z-index:1"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:64%;background:linear-gradient(to bottom, rgba(11,17,32,0) 0%, rgba(11,17,32,.55) 40%, rgba(11,17,32,.9) 73%, rgba(8,12,24,.98) 100%);z-index:1"></div>
    <div class="brand"><span class="dot"></span><span class="name">TripPilot Guides</span></div>
    <div style="position:absolute;left:72px;right:72px;bottom:104px;z-index:3">
      <div class="eyebrow" style="color:#5eead4;text-shadow:0 2px 8px rgba(0,0,0,.6)">${escapeHtml(pin.destination.toUpperCase())}</div>
      <div class="rule" style="margin:18px 0 24px"></div>
      <div class="serif" style="color:#fff;font-weight:900;font-size:${fs}px;line-height:1.05;letter-spacing:-1px;text-shadow:0 2px 4px rgba(0,0,0,.6),0 10px 36px rgba(0,0,0,.5)">${escapeHtml(pin.title)}</div>
      <div class="foot" style="margin-top:32px">
        <div class="tags" style="text-shadow:0 1px 5px rgba(0,0,0,.7)">Itinéraire · Budget · Checklist</div>
        <div class="url" style="text-shadow:0 1px 4px rgba(0,0,0,.7)">${escapeHtml(pin.urlText)}</div>
      </div>
    </div>
  </div>`;
}

/** Template 2 — Plaque centrale frostée (lisibilité garantie sur tout fond). */
function templateCard(pin, bg) {
  const fs = Math.round(titleFontSize(pin.title) * 0.94);
  return `<div class="pin">
    <img class="bg" src="${bg}" />
    <div style="position:absolute;inset:0;background:rgba(11,17,32,.5);z-index:1"></div>
    <div class="brand"><span class="dot"></span><span class="name">TripPilot Guides</span></div>
    <div style="position:absolute;left:72px;right:72px;top:50%;transform:translateY(-50%);z-index:3;background:rgba(11,17,32,.58);border:1.5px solid rgba(255,255,255,.28);border-radius:30px;padding:62px 50px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.45)">
      <div class="eyebrow" style="color:#5eead4">${escapeHtml(pin.destination.toUpperCase())}</div>
      <div class="rule" style="margin:22px auto 28px"></div>
      <div class="serif" style="color:#fff;font-weight:900;font-size:${fs}px;line-height:1.08;letter-spacing:-1px">${escapeHtml(pin.title)}</div>
      <div class="foot tags" style="margin-top:30px;text-align:center;opacity:.95">Itinéraire · Budget · Checklist</div>
    </div>
    <div class="foot url" style="position:absolute;left:0;right:0;bottom:70px;text-align:center;z-index:3;text-shadow:0 1px 5px rgba(0,0,0,.7)">${escapeHtml(pin.urlText)}</div>
  </div>`;
}

/** Template 3 — Magazine : photo en haut, bloc dégradé en bas (titre sur aplat). */
function templateMagazine(pin, bg, number) {
  const fs = titleFontSize(pin.title);
  return `<div class="pin">
    <img class="bg" src="${bg}" style="height:62%" />
    <div style="position:absolute;top:0;left:0;right:0;height:62%;background:linear-gradient(to bottom,rgba(11,17,32,.40),rgba(11,17,32,0) 38%);z-index:1"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:40%;background:linear-gradient(140deg,#312e81 0%,#4f46e5 55%,#0f766e 100%);z-index:1"></div>
    <div class="brand"><span class="dot"></span><span class="name">TripPilot Guides</span></div>
    <div style="position:absolute;right:70px;top:calc(62% - 58px);z-index:3;width:116px;height:116px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 34px rgba(0,0,0,.35)">
      <span class="serif" style="font-weight:900;font-size:56px;color:#4f46e5">${number}</span>
    </div>
    <div style="position:absolute;left:70px;right:70px;bottom:106px;z-index:3">
      <div class="eyebrow" style="color:#a7f3d0">${escapeHtml(pin.destination.toUpperCase())}</div>
      <div class="rule" style="margin:18px 0 24px;background:#fff"></div>
      <div class="serif" style="color:#fff;font-weight:900;font-size:${fs}px;line-height:1.06;letter-spacing:-1px">${escapeHtml(pin.title)}</div>
      <div class="foot tags" style="margin-top:28px;opacity:.95">Itinéraire · Budget · Checklist</div>
      <div class="foot url" style="color:#c7d2fe;margin-top:6px">${escapeHtml(pin.urlText)}</div>
    </div>
  </div>`;
}

/** Template 4 — Carte postale : encart blanc arrondi (texte sombre, ultra lisible). */
function templatePostcard(pin, bg) {
  const fs = Math.round(titleFontSize(pin.title) * 0.9);
  return `<div class="pin">
    <img class="bg" src="${bg}" />
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(11,17,32,.5) 0%,rgba(11,17,32,0) 32%);z-index:1"></div>
    <div class="brand"><span class="dot"></span><span class="name">TripPilot Guides</span></div>
    <div style="position:absolute;left:58px;right:58px;bottom:84px;z-index:3;background:#fff;border-radius:30px;padding:54px 50px;box-shadow:0 30px 70px rgba(0,0,0,.4)">
      <div class="eyebrow" style="color:#4338ca">${escapeHtml(pin.destination.toUpperCase())}</div>
      <div class="rule" style="margin:16px 0 22px"></div>
      <div class="serif" style="color:#0b1120;font-weight:900;font-size:${fs}px;line-height:1.07;letter-spacing:-1px">${escapeHtml(pin.title)}</div>
      <div class="foot" style="margin-top:28px;display:flex;justify-content:space-between;align-items:center;gap:16px">
        <span style="font-family:'Inter',sans-serif;font-weight:700;font-size:23px;color:#475569">Itinéraire · Budget · Checklist</span>
        <span style="font-family:'Inter',sans-serif;font-weight:800;font-size:21px;color:#4f46e5;white-space:nowrap">${escapeHtml(pin.urlText)}</span>
      </div>
    </div>
  </div>`;
}

const TEMPLATES = [templateEditorial, templateCard, templateMagazine, templatePostcard];

function pinHtml(pin, bg, index) {
  const tpl = TEMPLATES[index % TEMPLATES.length];
  const number = String(index + 1).padStart(2, "0");
  const inner = tpl(pin, bg, number);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">${FONTS_LINK}<style>${BASE_CSS}</style></head><body>${inner}</body></html>`;
}

/**
 * Rend les épingles en PNG via Playwright. Lève si Playwright indisponible.
 * @param {{pins:Array, outputDir:string, backgrounds:string[], destination:string, urlText:string}} args
 * @returns {Promise<string[]>} chemins des PNG écrits
 */
export async function renderBeautifulPins({ pins, outputDir, backgrounds, destination, urlText }) {
  const { chromium } = await import("playwright");

  // Prépare les fonds en data URI (rotation sur les photos disponibles).
  const bgUris = [];
  for (const b of backgrounds || []) {
    try {
      bgUris.push(await toDataUri(b));
    } catch {
      /* fond manquant : ignoré */
    }
  }
  if (!bgUris.length) throw new Error("no_background_available");

  await fs.mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const files = [];
  try {
    const page = await browser.newPage({
      viewport: { width: PIN_WIDTH, height: PIN_HEIGHT, deviceScaleFactor: 1 },
    });
    for (const [index, raw] of pins.entries()) {
      const pin = {
        destination: raw.destination || destination || "Voyage",
        title: cleanTitle(raw.title, raw.destination || destination),
        urlText: (raw.url || urlText || "trippilotguides.com").replace(/^https?:\/\//, ""),
      };
      const bg = bgUris[index % bgUris.length];
      await page.setContent(pinHtml(pin, bg, index), { waitUntil: "networkidle" });
      // Garantit que les polices web sont prêtes avant la capture.
      try {
        await page.evaluate(() => document.fonts.ready);
      } catch {
        /* ignore */
      }
      await page.waitForTimeout(150);
      const number = String(index + 1).padStart(2, "0");
      const outPath = `${outputDir}/pin-${number}.png`;
      await page.screenshot({ path: outPath, type: "png", clip: { x: 0, y: 0, width: PIN_WIDTH, height: PIN_HEIGHT } });
      files.push(outPath);
    }
  } finally {
    await browser.close();
  }
  return files;
}
