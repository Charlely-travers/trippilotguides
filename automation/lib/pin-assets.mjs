import fs from "node:fs/promises";
import path from "node:path";

const PIN_WIDTH = 1000;
const PIN_HEIGHT = 1500;

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHashtags(value) {
  return String(value || "")
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagsFrom(value) {
  return [...String(value || "").matchAll(/#([\p{L}\p{N}_-]+)/gu)]
    .map((match) => match[1].toLowerCase())
    .slice(0, 5);
}

function compactOverlay(value, destination) {
  const clean = stripHashtags(value);
  if (clean.length <= 42) return clean;
  const words = clean.split(/\s+/).filter(Boolean);
  const picked = [];
  for (const word of words) {
    const next = [...picked, word].join(" ");
    if (next.length > 42) break;
    picked.push(word);
  }
  return picked.join(" ") || `${destination} pratique`;
}

export function buildFallbackPins({ destination, title, url }) {
  const dest = destination || "Voyage";
  const ideas = [
    `${dest} sans exploser le budget`,
    `L'itinéraire simple pour ${dest}`,
    `${dest}: les erreurs à éviter`,
    `Où dormir à ${dest}`,
    `${dest} jour par jour`,
    `Budget réaliste pour ${dest}`,
    `${dest}: quoi réserver avant`,
    `Première fois à ${dest}`,
    `${dest}: checklist avant départ`,
    `${dest}: les bons réflexes`,
  ];
  return ideas.map((idea) => ({
    destination: dest,
    title: idea,
    overlayText: compactOverlay(idea, dest),
    description: `${title || idea} - guide pratique TripPilot Guides.`,
    tags: [dest.toLowerCase().replace(/\s+/g, ""), "voyage", "itineraire", "budget", "guide"],
    url,
  }));
}

export function extractPinterestPins(markdown, context) {
  const section = String(markdown || "").match(/##\s*.*Id[ée]es Pinterest[\s\S]*?(?=\n##\s|\s*$)/i)?.[0] || "";
  const pins = [];
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
    if (!match) continue;
    const raw = match[1].replace(/\*\*/g, "").trim();
    const title = stripHashtags(raw);
    if (!title) continue;
    pins.push({
      destination: context.destination,
      title,
      overlayText: compactOverlay(title, context.destination),
      description: `${title}. ${context.title || ""}`.trim(),
      tags: tagsFrom(raw),
      url: context.url,
    });
  }
  return pins;
}

function svgTextLines(text, maxChars = 17) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4);
}

function wrapText(text, maxChars, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

/**
 * Overlay transparent (texte + dégradés) à composer PAR-DESSUS la photo de ville.
 * Design éditorial : badge marque, destination, gros titre bas, footer.
 */
export function renderPinOverlaySvg(pin) {
  const dest = escapeXml((pin.destination || "Voyage").toUpperCase());
  const titleLines = wrapText(pin.title, 17, 4);
  const lineHeight = 92;
  const titleBlockHeight = titleLines.length * lineHeight;
  const titleStartY = 1180 - titleBlockHeight;

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="80" y="${titleStartY + i * lineHeight}" font-size="74" font-weight="800" fill="#ffffff" font-family="'Plus Jakarta Sans','Inter',sans-serif" letter-spacing="-1">${escapeXml(
          line
        )}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 ${PIN_WIDTH} ${PIN_HEIGHT}">
  <defs>
    <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.30" stop-color="#0b1120" stop-opacity="0"/>
      <stop offset="0.62" stop-color="#0b1120" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#0b1120" stop-opacity="0.94"/>
    </linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1120" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#0b1120" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#818cf8"/>
      <stop offset="1" stop-color="#34d399"/>
    </linearGradient>
  </defs>

  <!-- Dégradés de lisibilité -->
  <rect x="0" y="0" width="${PIN_WIDTH}" height="300" fill="url(#top)"/>
  <rect x="0" y="0" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" fill="url(#bottom)"/>

  <!-- Badge marque (haut) -->
  <g>
    <rect x="60" y="64" width="320" height="62" rx="31" fill="#0b1120" fill-opacity="0.55"/>
    <circle cx="98" cy="95" r="17" fill="url(#accent)"/>
    <text x="128" y="105" font-size="28" font-weight="800" fill="#ffffff" font-family="'Plus Jakarta Sans','Inter',sans-serif">TripPilot Guides</text>
  </g>

  <!-- Destination (eyebrow) -->
  <text x="84" y="${titleStartY - 118}" font-size="30" font-weight="800" fill="#a7f3d0" font-family="'Plus Jakarta Sans','Inter',sans-serif" letter-spacing="4">${dest}</text>
  <rect x="80" y="${titleStartY - 92}" width="64" height="6" rx="3" fill="url(#accent)"/>

  <!-- Titre principal -->
  ${titleSvg}

  <!-- Footer -->
  <text x="80" y="1380" font-size="27" font-weight="700" fill="#ffffff" font-family="'Plus Jakarta Sans','Inter',sans-serif" opacity="0.92">Itinéraire · Budget · Checklist</text>
  <text x="80" y="1428" font-size="23" font-weight="600" fill="#cbd5e1" font-family="'Inter',sans-serif">${escapeXml(
    (pin.url || "trippilotguides.com").replace(/^https?:\/\//, "")
  )}</text>
</svg>`;
}

/** Fond dégradé (repli quand aucune photo de ville n'est disponible). */
function renderPinFallbackBackgroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 ${PIN_WIDTH} ${PIN_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#312e81"/>
      <stop offset="0.55" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect width="${PIN_WIDTH}" height="${PIN_HEIGHT}" fill="url(#bg)"/>
  <circle cx="820" cy="240" r="220" fill="#ffffff" opacity="0.06"/>
  <circle cx="160" cy="1240" r="260" fill="#ffffff" opacity="0.05"/>
</svg>`;
}

export async function writePinAssets({ outputDir, socialMarkdown, context, backgroundImage = null }) {
  const extracted = extractPinterestPins(socialMarkdown, context);
  const pins = extracted.length ? extracted : buildFallbackPins(context);
  const selected = pins.slice(0, 10);
  await fs.mkdir(outputDir, { recursive: true });

  let sharp = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    sharp = null;
  }

  // Prépare le fond commun (photo de ville recadrée en 1000x1500, sinon dégradé).
  let baseBackground = null;
  if (sharp) {
    try {
      if (backgroundImage) {
        baseBackground = await sharp(backgroundImage)
          .resize(PIN_WIDTH, PIN_HEIGHT, { fit: "cover", position: "attention" })
          .toBuffer();
      } else {
        baseBackground = await sharp(Buffer.from(renderPinFallbackBackgroundSvg()))
          .png()
          .toBuffer();
      }
    } catch {
      baseBackground = await sharp(Buffer.from(renderPinFallbackBackgroundSvg()))
        .png()
        .toBuffer();
    }
  }

  const files = [];
  for (const [index, pin] of selected.entries()) {
    const number = String(index + 1).padStart(2, "0");
    const overlaySvg = renderPinOverlaySvg(pin);

    if (sharp && baseBackground) {
      const pngPath = path.join(outputDir, `pin-${number}.png`);
      await sharp(baseBackground)
        .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
        .png()
        .toFile(pngPath);
      files.push(pngPath);
    } else {
      // Pas de sharp : on stocke au moins l'overlay SVG.
      const svgPath = path.join(outputDir, `pin-${number}.svg`);
      await fs.writeFile(svgPath, overlaySvg, "utf8");
      files.push(svgPath);
    }
  }

  await fs.writeFile(
    path.join(outputDir, "pins.json"),
    JSON.stringify(selected, null, 2),
    "utf8"
  );
  files.push(path.join(outputDir, "pins.json"));

  return { pins: selected, files };
}

