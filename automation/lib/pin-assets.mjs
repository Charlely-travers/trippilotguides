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
  const overlay = overlayLines
    .map(
      (line, index) =>
        `<text x="80" y="${560 + index * 92}" font-size="78" font-weight="800" fill="#ffffff">${escapeXml(line)}</text>`
    )
    .join("\n");
  const title = titleLines
    .map(
      (line, index) =>
        `<text x="80" y="${1050 + index * 42}" font-size="34" font-weight="700" fill="#eef2ff">${escapeXml(line)}</text>`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_WIDTH}" height="${PIN_HEIGHT}" viewBox="0 0 ${PIN_WIDTH} ${PIN_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="0.55" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#0f766e"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.22" cy="0.08" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${PIN_WIDTH}" height="${PIN_HEIGHT}" fill="url(#bg)"/>
  <rect width="${PIN_WIDTH}" height="${PIN_HEIGHT}" fill="url(#glow)"/>
  <rect x="54" y="54" width="892" height="1392" rx="46" fill="none" stroke="#ffffff" stroke-opacity="0.38" stroke-width="3"/>
  <text x="80" y="160" font-size="36" font-weight="800" fill="#ffffff" opacity="0.9">TripPilot Guides</text>
  <text x="80" y="246" font-size="48" font-weight="800" fill="#d1fae5">${escapeXml(pin.destination || "Voyage")}</text>
  ${overlay}
  <rect x="80" y="910" width="210" height="8" rx="4" fill="#ffffff" opacity="0.8"/>
  ${title}
  <text x="80" y="1308" font-size="30" font-weight="700" fill="#ffffff" opacity="0.9">Itinéraire · budget · checklist</text>
  <text x="80" y="1370" font-size="24" font-weight="600" fill="#e0e7ff">${escapeXml(pin.url || "trippilotguides.com")}</text>
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

