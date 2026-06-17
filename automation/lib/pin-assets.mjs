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

export function renderPinSvg(pin) {
  const overlayLines = svgTextLines(pin.overlayText || pin.title);
  const titleLines = svgTextLines(pin.title, 28).slice(0, 2);
  const dest = escapeXml(pin.destination || "Voyage");
  const overlay = overlayLines
    .map(
      (line, index) =>
        `<text x="500" y="${620 + index * 100}" font-size="82" font-weight="800" fill="#ffffff" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif">${escapeXml(line)}</text>`
    )
    .join("\n");
  const title = titleLines
    .map(
      (line, index) =>
        `<text x="500" y="${1080 + index * 44}" font-size="32" font-weight="600" fill="#f1f5f9" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif">${escapeXml(line)}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 ${PIN_WIDTH} ${PIN_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#1e1b4b"/>
      <stop offset="0.5" stop-color="#312e81"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#818cf8"/>
      <stop offset="1" stop-color="#34d399"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.6">
      <stop offset="0" stop-color="#818cf8" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#818cf8" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Fond principal -->
  <rect width="${PIN_WIDTH}" height="${PIN_HEIGHT}" fill="url(#bg)"/>
  <rect width="${PIN_WIDTH}" height="${PIN_HEIGHT}" fill="url(#glow)"/>

  <!-- Éléments décoratifs -->
  <circle cx="850" cy="200" r="180" fill="#818cf8" opacity="0.08"/>
  <circle cx="150" cy="1300" r="220" fill="#34d399" opacity="0.06"/>
  <rect x="70" y="440" width="860" height="520" rx="32" fill="#ffffff" fill-opacity="0.05" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5"/>

  <!-- Logo & branding (haut) -->
  <rect x="70" y="70" width="180" height="44" rx="22" fill="#ffffff" fill-opacity="0.15"/>
  <text x="110" y="100" font-size="22" font-weight="700" fill="#ffffff" font-family="system-ui,-apple-system,sans-serif" opacity="0.95">TripPilot</text>

  <!-- Destination badge -->
  <rect x="70" y="160" width="${Math.min(dest.length * 28 + 60, 500)}" height="64" rx="32" fill="url(#accent)" opacity="0.9"/>
  <text x="100" y="202" font-size="36" font-weight="800" fill="#ffffff" font-family="system-ui,-apple-system,sans-serif">${dest}</text>

  <!-- Texte principal (overlay) -->
  ${overlay}

  <!-- Séparateur -->
  <rect x="380" y="980" width="240" height="5" rx="3" fill="url(#accent)" opacity="0.7"/>

  <!-- Sous-titre -->
  ${title}

  <!-- Footer -->
  <rect x="70" y="1280" width="860" height="140" rx="24" fill="#ffffff" fill-opacity="0.08"/>
  <text x="500" y="1340" font-size="28" font-weight="700" fill="#e0e7ff" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif">Itinéraire · Budget · Checklist</text>
  <text x="500" y="1388" font-size="22" font-weight="600" fill="#94a3b8" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif">${escapeXml(pin.url || "trippilotguides.com")}</text>
</svg>`;
}

export async function writePinAssets({ outputDir, socialMarkdown, context }) {
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

  const files = [];
  for (const [index, pin] of selected.entries()) {
    const number = String(index + 1).padStart(2, "0");
    const svg = renderPinSvg(pin);
    const svgPath = path.join(outputDir, `pin-${number}.svg`);
    await fs.writeFile(svgPath, svg, "utf8");
    files.push(svgPath);
    if (sharp) {
      const pngPath = path.join(outputDir, `pin-${number}.png`);
      await sharp(Buffer.from(svg)).png().toFile(pngPath);
      files.push(pngPath);
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

